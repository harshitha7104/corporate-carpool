import styles from "./Process.module.css";
import { FiSearch } from "react-icons/fi";
import { FaCarRear } from "react-icons/fa6";
import { LuLeaf } from "react-icons/lu";
const ProcessCard = () => {
  return (
    <>
      <div className={styles.outer}>
        <div className={styles.sidepic}>
          <h3>Find the Ride</h3>
          <img
            src={`${import.meta.env.BASE_URL}images/secondpage.jpg`}
            alt="sidepic"
            className={styles.pic}
          />
        </div>
        <div className={styles.inner}>
          <div className={styles.matter}>
            <h1 className={styles.heading}>Effortless Carpool Connections</h1>
            <div className={styles.subheading}>
              <h3>
                <FiSearch /> Match
              </h3>
              <p>
                Match Find compatible riders and drivers along your route with
                our smart matching algorithm.
              </p>
            </div>
            <div className={styles.subheading}>
              <h3>
                <FaCarRear /> Ride
              </h3>
              <p>
                Share comfortable, affordable journeys with verified community
                members.
              </p>
            </div>
            <div className={styles.subheading}>
              <h3>
                <LuLeaf /> Save
              </h3>
              <p>
                Cut costs, reduce emissions, and earn rewards with every shared
                trip.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
export default ProcessCard;
