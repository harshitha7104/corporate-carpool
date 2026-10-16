const mongoose=require("mongoose");
const rideSchema=new mongoose.Schema({
  driver:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User",
    required:true,
    index:true,
  },
  driverName:{
    type:String,
    required:true,
  },
  location:{
    type:String,
    required:true,
    trim:true,
  },
  destination:{
    type:String,
    required:true,
    trim:true,
  },
  departureTime:{
    type:Date,
  },
  carNumber:{
    type:String,
    required:true,
    trim:true,
  },
  carType:{
    type:String,
    required:true,
    trim:true,
  },
  totalSeats:{
    type:Number,
    required:true,
    min:1,
  },
  availableSeats:{
    type:Number,
    required:true,
    min:0,
  },
  conditions:{
    type:String,
    trim:true,
  },
  passengers:[{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User",
  }],
},
{ timestamps:true });

const Ride=mongoose.model("Ride",rideSchema);
module.exports=Ride;
