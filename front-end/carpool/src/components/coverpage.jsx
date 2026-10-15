import React from "react";
import styles from "./coverpage.module.css";
import Header from "./Header.jsx";
import Signup from "./Signup.jsx";
import ProcessCard from "./Process.jsx";
import coverImage from "../assets/signupbackground.jpg";
import Rule from "./Rule.jsx";
import Contact from "./contact.jsx";

const CoverPage = () => {
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
          <button type="submit" className={styles.btn}>
            <a href="/login" className={styles.btntext}>
              Start Carpooling
            </a>
          </button>
        </div>
        <div className={styles.sidepic}>
          <h3>
            {" "}
            Car Pool
            <br /> Using Green Way
          </h3>
          <img
            src="/images/sidepic.jpg"
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
