import { Link, NavLink, useNavigate } from "react-router-dom";
import styles from "./Header.module.css";
import { clearSession, useSession } from "../api/auth";

const Header = () => {
  const user = useSession();
  const navigate = useNavigate();
  const navClass = ({ isActive }) => `nav-link${isActive ? " active" : ""}`;

  const logout = () => {
    clearSession();
    navigate("/");
  };

  return (
    <>
      <nav
        className={`navbar navbar-expand-lg border-bottom shadow-sm ${styles.nav}`}
      >
        <div className={`container-fluid  ${styles.title}`}>
          <Link className="navbar-brand " to="/">
            <img
              src="/images/logo.jpg"
              alt="logo"
              className="logo-icon "
            />
            Green Way
          </Link>
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbarNavAltMarkup"
            aria-controls="navbarNavAltMarkup"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className="collapse navbar-collapse" id="navbarNavAltMarkup">
            <div className="navbar-nav">
              <NavLink className={navClass} to="/" end>
                Home
              </NavLink>
              <NavLink className={navClass} to="/ride">
                Offer Ride
              </NavLink>
              <NavLink className={navClass} to="/form">
                Find ride
              </NavLink>
              {user ? (
                <>
                  <NavLink className={navClass} to="/my-rides">
                    My Rides
                  </NavLink>
                  <button type="button" className="nav-link btn btn-link" onClick={logout}>
                    Logout ({user.username})
                  </button>
                </>
              ) : (
                <>
                  <NavLink className={navClass} to="/login">
                    Login
                  </NavLink>
                  <NavLink className={navClass} to="/Signup">
                    Sign Up
                  </NavLink>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
};
export default Header;
