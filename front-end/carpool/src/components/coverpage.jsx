import styles from "./coverpage.module.css";
import { Link, useNavigate } from "react-router-dom";
import Header from "./Header.jsx";
import { getUser } from "../api/auth";
import ProcessCard from "./Process.jsx";
import Rule from "./Rule.jsx";
import Contact from "./contact.jsx";

const CoverPage = () => {
  const navigate = useNavigate();
  const startPath = getUser() ? "/form" : "/login";
  return (
    <>
      <Header />
      <div className={styles.outmatter}>
        <div className={styles.matter}>
          <h1>
            Drive Together.Go
            <br />
            Greener.The Green Way.
          </h1>
          <p>
            Connect with nearby commuters, reduce your carbon footprint, and
            save money— all with a single tap. Green Way makes
            <br /> carpooling simple, safe, and sustainable.
          </p>
          <button type="button" className={styles.btn} onClick={() => navigate(startPath)}>
            <Link to={startPath} className={styles.btntext}>
              Start Carpooling
            </Link>
          </button>
        </div>
        <div className={styles.sidepic}>
          <h3>
            {" "}
            Car Pool
            <br /> Using Green Way
          </h3>
          <img
            src={`${import.meta.env.BASE_URL}images/sidepic.jpg`}
            alt="sidepic"
            className={styles.pic}
          />
        </div>
      </div>
      <ProcessCard />
      <Rule />
      <Contact />
    </>
  );
};

export default CoverPage;
