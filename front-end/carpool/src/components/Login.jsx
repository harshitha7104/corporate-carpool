import styles from "./Login.module.css";
import { User } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import axios from "../api/axios";
import { saveSession } from "../api/auth";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");

  const handleSubmit=async(event)=>{
    event.preventDefault();
    setError("");
    try {
      const response=await axios.post("/Login",{email,pwd:password});
      saveSession(response.data.token,response.data.user);
      navigate(location.state?.from || "/form");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to sign in. Please try again.");
    }
  };

  return (
    <>
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.cardheader}>
            <div className={styles.cardicon}>
              <User size={32} />
            </div>
            <h2>Welcome Back</h2>
            <p>Please Login in to continue</p>
          </div>
          <div className={styles.cardbody}>
            <form onSubmit={handleSubmit}>
              {error && <p className={styles.errorMessage} role="alert">{error}</p>}
              <div className={styles.formgroup}>
                <label htmlFor="email" className={styles.formlabel}>
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  className={styles.forminput}
                  placeholder="your@email.com"
                  autoComplete="email"
                  value={email}
                  onChange={(event)=>setEmail(event.target.value)}
                  required
                />
              </div>
              <div className={styles.formgroup}>
                <label htmlFor="password" className={styles.formlabel}>
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  className={styles.forminput}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event)=>setPassword(event.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className={styles.btn}
              >
                Sign In
              </button>
              <div className={styles.link}>
                Need an account? <Link to="/Signup">Sign Up</Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;
