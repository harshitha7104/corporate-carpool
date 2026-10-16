import { useRef, useState, useEffect } from "react";
import { Check, X, Info, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import styles from "./Signup.module.css";
import axios from "../api/axios";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const USER_REGEX = /^[a-zA-Z][a-zA-Z0-9-_]{3,23}$/;
const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%]).{8,24}$/;
const REGISTER_URL = "/Signup";

const Signup = () => {
  const userRef = useRef(null);
  const errRef = useRef(null);
  const navigate = useNavigate();

  const [user, setUser] = useState("");
  const [validName, setValidName] = useState(false);
  const [userFocus, setUserFocus] = useState(false);

  const [pwd, setPwd] = useState("");
  const [validPwd, setValidPwd] = useState(false);
  const [pwdFocus, setPwdFocus] = useState(false);

  const [email, setEmail] = useState("");
  const [validEmail, setValidEmail] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);

  const [errMsg, setErrMsg] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  useEffect(() => {
    const result = USER_REGEX.test(user);
    setValidName(result);
  }, [user]);

  useEffect(() => {
    const result = PWD_REGEX.test(pwd);
    setValidPwd(result);
  }, [pwd]);

  useEffect(() => {
    const result = EMAIL_REGEX.test(email);
    setValidEmail(result);
  }, [email]);

  useEffect(() => {
    setErrMsg("");
  }, [user, pwd, email]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const v1 = USER_REGEX.test(user);
    const v2 = PWD_REGEX.test(pwd);
    const v3 = EMAIL_REGEX.test(email);

    if (!v1 || !v2 || !v3) {
      setErrMsg("Invalid Entry");
      return;
    }

    try {
      await axios.post(
        REGISTER_URL,
        JSON.stringify({ user, pwd, email }),
        {
          headers: { "Content-Type": "application/json" },
          withCredentials: true,
        }
      );
      setSuccess(true);
      setUser("");
      setPwd("");
      setEmail("");
    } catch (err) {
      errRef.current?.focus();
      if (!err?.response) {
        setErrMsg("No Server Response");
      } else if (err.response?.status === 409) {
        setErrMsg("That username or email is already registered");
      } else {
        setErrMsg(err.response?.data?.message || "Registration Failed");
      }
    }
  };

  return (
    <div className={styles.container}>
      {success ? (
        <div className={styles.formWrapper}>
          <div className={styles.success}>
            <div className={styles.successIcon}>
              <Check />
            </div>
            <h1 className={styles.title}>Success!</h1>
            <p className={styles.subtitle}>
              Your account has been created successfully.
            </p>
            <button
              onClick={() => {
                navigate("/login");
              }}
              className={styles.button}
            >
              Sign In
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.formWrapper}>
          {errMsg && (
            <div className={styles.errorMessage}>
              <AlertCircle />
              <p
                ref={errRef}
                className={styles.errorText}
                aria-live="assertive"
              >
                {errMsg}
              </p>
            </div>
          )}

          <div className={styles.header}>
            <h1 className={styles.title}>Create Account</h1>
            <p className={styles.subtitle}>Sign up to get started</p>
          </div>

          <form
            action="/Signup"
            method="post"
            onSubmit={handleSubmit}
            className={styles.form}
          >
            <div className={styles.formGroup}>
              <div className={styles.labelWrapper}>
                <label htmlFor="username" className={styles.label}>
                  Username
                </label>
                <div>
                  {user &&
                    (validName ? (
                      <Check
                        className={`${styles.validationIcon} ${styles.validIcon}`}
                      />
                    ) : (
                      <X
                        className={`${styles.validationIcon} ${styles.invalidIcon}`}
                      />
                    ))}
                </div>
              </div>

              <input
                type="text"
                id="username"
                ref={userRef}
                autoComplete="off"
                onChange={(e) => setUser(e.target.value)}
                required
                value={user}
                aria-invalid={validName ? "false" : "true"}
                aria-describedby="uidnote"
                onFocus={() => setUserFocus(true)}
                onBlur={() => setUserFocus(false)}
                className={styles.input}
                placeholder="Enter username"
              />

              {userFocus && user && !validName && (
                <div id="uidnote" className={styles.validationMessage}>
                  <Info />
                  <span>
                    4 to 24 characters.
                    <br />
                    Must begin with a letter.
                    <br />
                    Letters, numbers, underscores, hyphens allowed.
                  </span>
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <div className={styles.labelWrapper}>
                <label htmlFor="password" className={styles.label}>
                  Password
                </label>
                <div>
                  {pwd &&
                    (validPwd ? (
                      <Check
                        className={`${styles.validationIcon} ${styles.validIcon}`}
                      />
                    ) : (
                      <X
                        className={`${styles.validationIcon} ${styles.invalidIcon}`}
                      />
                    ))}
                </div>
              </div>

              <input
                type="password"
                id="password"
                onChange={(e) => setPwd(e.target.value)}
                required
                value={pwd}
                aria-invalid={validPwd ? "false" : "true"}
                aria-describedby="pwdnote"
                onFocus={() => setPwdFocus(true)}
                onBlur={() => setPwdFocus(false)}
                className={styles.input}
                placeholder="Enter password"
              />

              {pwdFocus && !validPwd && (
                <div id="pwdnote" className={styles.validationMessage}>
                  <Info />
                  <span>
                    8 to 24 characters.
                    <br />
                    Must include uppercase and lowercase letters, a number and a
                    special character.
                    <br />
                    Allowed special characters:{" "}
                    <span aria-label="exclamation mark">!</span>{" "}
                    <span aria-label="at symbol">@</span>{" "}
                    <span aria-label="hashtag">#</span>{" "}
                    <span aria-label="dollar sign">$</span>{" "}
                    <span aria-label="percent">%</span>
                  </span>
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <div className={styles.labelWrapper}>
                <label htmlFor="email" className={styles.label}>
                  Email Address
                </label>
                <div>
                  {email &&
                    (validEmail ? (
                      <Check
                        className={`${styles.validationIcon} ${styles.validIcon}`}
                      />
                    ) : (
                      <X
                        className={`${styles.validationIcon} ${styles.invalidIcon}`}
                      />
                    ))}
                </div>
              </div>

              <input
                type="email"
                id="email"
                autoComplete="off"
                onChange={(e) => setEmail(e.target.value)}
                required
                value={email}
                aria-invalid={validEmail ? "false" : "true"}
                aria-describedby="emailnote"
                onFocus={() => setEmailFocus(true)}
                onBlur={() => setEmailFocus(false)}
                className={styles.input}
                placeholder="Enter email address"
              />

              {emailFocus && email && !validEmail && (
                <div id="emailnote" className={styles.validationMessage}>
                  <Info />
                  <span>Please enter a valid email address.</span>
                </div>
              )}
            </div>

            <button
              disabled={!validName || !validPwd || !validEmail}
              className={styles.button}
            >
              Create Account
            </button>

            <div className={styles.link}>
              Already have an account? <Link to="/login">Sign in</Link>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Signup;
