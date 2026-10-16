import { Link } from "react-router-dom";
import { CheckCircle2, Home, CarFront } from "lucide-react";
import styles from "./confirm.module.css";

const Confirm = () => {
  return (
    <main className={styles.page}>
      <section className={styles.confirmation}>
        <div className={styles.icon} aria-hidden="true"><CheckCircle2 size={36} /></div>
        <p className={styles.eyebrow}>Ride shared</p>
        <h1>Your ride is now offered</h1>
        <p className={styles.message}>Your trip details have been saved to your account.</p>
        <div className={styles.actions}>
          <Link to="/my-rides"><CheckCircle2 size={18} /> View my rides</Link>
          <Link to="/ride"><CarFront size={18} /> Offer another ride</Link>
          <Link to="/"><Home size={18} /> Back to home</Link>
        </div>
      </section>
    </main>
  );
};

export default Confirm;
