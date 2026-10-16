const express=require("express");
const path=require("path");
const fs=require("fs");
const mongoose=require("mongoose");
const cors=require("cors");
const crypto=require("crypto");
const {promisify}=require("util");

const scrypt=promisify(crypto.scrypt);

const allowedOrigins=[
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  process.env.RENDER_EXTERNAL_URL,
  process.env.CLIENT_URL,
  undefined
];

const User=require("./models/user");
const Ride=require("./models/ride");

const app=express();
const PORT=process.env.PORT || 4000;
const isProduction=process.env.NODE_ENV === "production";
const mongoUri=process.env.MONGO_URI || (isProduction ? null : "mongodb://127.0.0.1:27017/user");
const authSecret=process.env.AUTH_SECRET || (isProduction ? null : "local-development-only-secret");

if (!mongoUri || !authSecret) {
  throw new Error("MONGO_URI and AUTH_SECRET must be configured in production");
}

const corsOptions={
  origin:(origin,callback)=>{
    if(allowedOrigins.includes(origin)||!origin){
      callback(null,true);
    }else{
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials:true,
  optionSuccessStatus:200,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use("/api",(req,res,next)=>{
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database is not connected. Configure MONGO_URI and ensure MongoDB is reachable." });
  }
  return next();
});

const hashPassword=async(password)=>{
  const salt=crypto.randomBytes(16).toString("hex");
  const hash=await scrypt(password,salt,64);
  return `${salt}:${hash.toString("hex")}`;
};

const verifyPassword=async(password,storedPassword)=>{
  const [salt,storedHash]=String(storedPassword).split(":");
  if (!storedHash) {
    const supplied=Buffer.from(password);
    const stored=Buffer.from(String(storedPassword));
    return supplied.length === stored.length && crypto.timingSafeEqual(supplied,stored);
  }

  const expected=Buffer.from(storedHash,"hex");
  const actual=await scrypt(password,salt,expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual,expected);
};

const escapeRegex=(value)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

const createToken=(user)=>{
  const payload=Buffer.from(JSON.stringify({
    email:user.Email,
    exp:Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  const signature=crypto.createHmac("sha256",authSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

const verifyToken=(token)=>{
  const [payload,signature]=String(token || "").split(".");
  if (!payload || !signature) {
    return { error:"Invalid session" };
  }

  const expected=crypto.createHmac("sha256",authSecret).update(payload).digest();
  const received=Buffer.from(signature,"base64url");
  if (received.length !== expected.length || !crypto.timingSafeEqual(received,expected)) {
    return { error:"Invalid session" };
  }

  let auth;
  try {
    auth=JSON.parse(Buffer.from(payload,"base64url").toString());
  } catch {
    return { error:"Invalid session" };
  }
  if (!auth.email || auth.exp <= Date.now()) {
    return { error:"Session expired" };
  }
  return { auth };
};

const bearerToken=(req)=>req.headers.authorization?.replace(/^Bearer\s+/i,"");

const requireAuth=(req,res,next)=>{
  const token=bearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "Please sign in to continue" });
  }
  const { auth,error }=verifyToken(token);
  if (error) {
    return res.status(401).json({ message: error });
  }
  req.auth=auth;
  return next();
};

const optionalAuth=(req,res,next)=>{
  const token=bearerToken(req);
  if (token) {
    req.auth=verifyToken(token).auth;
  }
  return next();
};

const buildPath = path.resolve(__dirname, "../front-end/carpool/dist");
const distExists = fs.existsSync(buildPath) && fs.existsSync(path.join(buildPath, "index.html"));

if (distExists) {
  app.use(express.static(buildPath));
}

app.post("/api/Signup",async(req,res)=>{
  try {
    const {user,pwd,email}=req.body;
    if (!user || !pwd || !email) {
      return res.status(400).json({ message: "Username, password, and email are required" });
    }
    const username=String(user).trim();
    const password=String(pwd);
    const normalizedEmail=String(email).trim().toLowerCase();
    if (!/^[a-zA-Z][a-zA-Z0-9-_]{3,23}$/.test(username) ||
        !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%]).{8,24}$/.test(password) ||
        !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide valid signup details" });
    }
    const existingUser=await User.findOne({
      $or:[{Username:username},{Email:normalizedEmail}],
    });
    if (existingUser) {
      return res.status(409).json({ message: "Username or email is already registered" });
    }
    await User.create({
      Username:username,
      Password:await hashPassword(password),
      Email:normalizedEmail,
    });
    return res.status(201).json({ message: "User created" });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Username or email is already registered" });
    }
    console.error("Signup error:",err.message);
    return res.status(500).json({ message: "Unable to create account" });
  }
});

app.post("/api/Login",async(req,res)=>{
  try {
    const {email,pwd}=req.body;
    if (!email || !pwd) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const user=await User.findOne({Email:email.trim().toLowerCase()});
    if (!user || !await verifyPassword(pwd,user.Password)) {
      return res.status(401).json({ message: "Email or password is incorrect" });
    }
    if (!String(user.Password).includes(":")) {
      user.Password=await hashPassword(pwd);
      await user.save();
    }
    return res.json({
      token:createToken(user),
      user:{ username:user.Username,email:user.Email },
    });
  } catch (err) {
    console.error("Login error:",err.message);
    return res.status(500).json({ message: "Unable to sign in" });
  }
});

const RIDE_FIELDS="driverName location destination departureTime carNumber carType totalSeats availableSeats conditions createdAt";

const toRide=(ride,userId)=>({
  id:ride._id,
  driverName:ride.driverName,
  location:ride.location,
  destination:ride.destination,
  departureTime:ride.departureTime,
  carNumber:ride.carNumber,
  carType:ride.carType,
  totalSeats:ride.totalSeats,
  availableSeats:ride.availableSeats,
  conditions:ride.conditions,
  isDriver:userId ? String(ride.driver) === String(userId) : false,
  isBooked:userId ? (ride.passengers || []).some((id)=>String(id) === String(userId)) : false,
});

const currentUser=async(req,res)=>{
  const user=await User.findOne({Email:req.auth.email});
  if (!user) {
    res.status(401).json({ message: "Account not found. Please sign in again." });
  }
  return user;
};

const isValidId=(id)=>mongoose.isValidObjectId(id);

app.post("/api/Rides",requireAuth,async(req,res)=>{
  try {
    const {
      location,
      destination,
      departureTime,
      carNumber,
      carType,
      totalSeats,
      availableSeats,
      conditions,
    }=req.body;
    const total=Number(totalSeats);
    const available=Number(availableSeats);
    const departure=departureTime ? new Date(departureTime) : undefined;
    const text=(value)=>String(value || "").trim();
    if (!text(location) || !text(destination) || !text(carNumber) || !text(carType) ||
        !Number.isInteger(total) || !Number.isInteger(available) ||
        total < 1 || total > 10 || available < 1 || available > total ||
        (departure && Number.isNaN(departure.getTime()))) {
      return res.status(400).json({ message: "Please provide valid ride details" });
    }

    const user=await currentUser(req,res);
    if (!user) return;
    const ride=await Ride.create({
      driver:user._id,
      driverName:user.Username,
      location:text(location).slice(0,120),
      destination:text(destination).slice(0,120),
      departureTime:departure,
      carNumber:text(carNumber).slice(0,20),
      carType:text(carType).slice(0,60),
      totalSeats:total,
      availableSeats:available,
      conditions:text(conditions).slice(0,500),
    });
    return res.status(201).json({ message: "Ride offered", ride:toRide(ride,user._id) });
  } catch (err) {
    console.error("Ride create error:",err.message);
    return res.status(500).json({ message: "Unable to offer ride" });
  }
});

app.get("/api/Rides",optionalAuth,async(req,res)=>{
  try {
    const from=String(req.query.from || "").trim();
    const to=String(req.query.to || "").trim();
    const filter={ availableSeats:{ $gt:0 } };
    if (from) filter.location={ $regex:escapeRegex(from),$options:"i" };
    if (to) filter.destination={ $regex:escapeRegex(to),$options:"i" };
    const user=req.auth ? await User.findOne({Email:req.auth.email}).select("_id").lean() : null;
    const rides=await Ride.find(filter)
      .select(`${RIDE_FIELDS} driver passengers`)
      .sort({ departureTime:1,createdAt:-1 })
      .limit(50)
      .lean();
    return res.json({ rides:rides.map((ride)=>toRide(ride,user?._id)) });
  } catch (err) {
    console.error("Ride search error:",err.message);
    return res.status(500).json({ message: "Unable to search rides" });
  }
});

app.get("/api/MyRides",requireAuth,async(req,res)=>{
  try {
    const user=await currentUser(req,res);
    if (!user) return;
    const [offered,booked]=await Promise.all([
      Ride.find({ driver:user._id }).sort({ createdAt:-1 }).populate("passengers","Username Email").lean(),
      Ride.find({ passengers:user._id }).sort({ createdAt:-1 }).lean(),
    ]);
    return res.json({
      offered:offered.map((ride)=>({
        ...toRide({ ...ride,passengers:ride.passengers.map((p)=>p._id) },user._id),
        passengers:ride.passengers.map((p)=>({ username:p.Username,email:p.Email })),
      })),
      booked:booked.map((ride)=>toRide(ride,user._id)),
    });
  } catch (err) {
    console.error("My rides error:",err.message);
    return res.status(500).json({ message: "Unable to load your rides" });
  }
});

app.post("/api/Rides/:id/book",requireAuth,async(req,res)=>{
  try {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: "Ride not found" });
    }
    const user=await currentUser(req,res);
    if (!user) return;
    const ride=await Ride.findOneAndUpdate(
      {
        _id:req.params.id,
        driver:{ $ne:user._id },
        passengers:{ $ne:user._id },
        availableSeats:{ $gt:0 },
      },
      { $inc:{ availableSeats:-1 },$push:{ passengers:user._id } },
      { new:true },
    );
    if (!ride) {
      const existing=await Ride.findById(req.params.id).lean();
      if (!existing) return res.status(404).json({ message: "Ride not found" });
      if (String(existing.driver) === String(user._id)) return res.status(400).json({ message: "You cannot book your own ride" });
      if (existing.passengers.some((id)=>String(id) === String(user._id))) return res.status(409).json({ message: "You have already booked this ride" });
      return res.status(409).json({ message: "This ride is full" });
    }
    return res.json({ message: "Seat booked", ride:toRide(ride,user._id) });
  } catch (err) {
    console.error("Ride booking error:",err.message);
    return res.status(500).json({ message: "Unable to book ride" });
  }
});

app.delete("/api/Rides/:id/book",requireAuth,async(req,res)=>{
  try {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: "Ride not found" });
    }
    const user=await currentUser(req,res);
    if (!user) return;
    const ride=await Ride.findOneAndUpdate(
      { _id:req.params.id,passengers:user._id },
      { $inc:{ availableSeats:1 },$pull:{ passengers:user._id } },
      { new:true },
    );
    if (!ride) {
      return res.status(404).json({ message: "Booking not found" });
    }
    return res.json({ message: "Booking cancelled", ride:toRide(ride,user._id) });
  } catch (err) {
    console.error("Booking cancel error:",err.message);
    return res.status(500).json({ message: "Unable to cancel booking" });
  }
});

app.delete("/api/Rides/:id",requireAuth,async(req,res)=>{
  try {
    if (!isValidId(req.params.id)) {
      return res.status(404).json({ message: "Ride not found" });
    }
    const user=await currentUser(req,res);
    if (!user) return;
    const ride=await Ride.findOneAndDelete({ _id:req.params.id,driver:user._id });
    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }
    return res.json({ message: "Ride removed" });
  } catch (err) {
    console.error("Ride delete error:",err.message);
    return res.status(500).json({ message: "Unable to remove ride" });
  }
});


app.get("/health", (req, res) => {
  const ready=mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status:ready ? "ok" : "database unavailable" });
});

app.use("/api",(req,res)=>{
  res.status(404).json({ message: "Not found" });
});

app.use((req, res, next) => {
  if (req.path === "/health") {
    return next();
  }

  if (!distExists) {
    return res.status(404).json({ message: "Frontend build not found" });
  }

  return res.sendFile(path.join(buildPath, "index.html"));
});

app.use((err,req,res,next)=>{
  if (res.headersSent) {
    return next(err);
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "Origin not allowed" });
  }
  console.error("Unhandled error:",err.message);
  return res.status(500).json({ message: "Something went wrong" });
});

let connectionAttempt;
let databaseErrorReported=false;
const connectDatabase=()=>{
  if (mongoose.connection.readyState === 1 || connectionAttempt) {
    return connectionAttempt;
  }

  connectionAttempt=mongoose.connect(mongoUri,{ serverSelectionTimeoutMS:5000 })
    .then(()=>{
      databaseErrorReported=false;
      console.log("Connected to MongoDB");
    })
    .catch((err)=>{
      if (!databaseErrorReported) {
        console.error("MongoDB connection error; will retry:",err.message);
        databaseErrorReported=true;
      }
    })
    .finally(()=>{
      connectionAttempt=undefined;
    });
  return connectionAttempt;
};

const databaseRetry=setInterval(()=>{
  if (mongoose.connection.readyState !== 1) {
    connectDatabase();
  }
},10000);
databaseRetry.unref();

app.listen(PORT,()=>console.log(`server running on port ${PORT}`));
connectDatabase();