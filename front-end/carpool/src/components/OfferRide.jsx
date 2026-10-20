import { useState, useEffect } from "react";
import styles from "./OfferRide.module.css";
import { Car, MapPin, CheckCircle, Users, MessageSquare, Clock, IndianRupee } from "lucide-react";
import axios from "../api/axios";
import { useNavigate } from "react-router-dom";
import { getToken } from "../api/auth";

const OfferRide = () => {
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { state: { from: "/ride" } });
    }
  }, [navigate]);
  useEffect(() => {
    if (formSubmitted) {
      const timer = setTimeout(() => {
        navigate("/book");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [formSubmitted, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);

    const departure = formData.get("departure");
    const data = {
      location: formData.get("source"),
      destination: formData.get("destination"),
      departureTime: departure ? new Date(departure).toISOString() : undefined,
      carNumber: formData.get("carnumber"),
      carType: formData.get("cartype"),
      carColor: formData.get("carcolor"),
      pricePerSeat: formData.get("price"),
      totalSeats: formData.get("Totalseats"),
      availableSeats: formData.get("Availableseats"),
      conditions: formData.get("exampleFormControlTextarea1"),
    };

    setErrorMessage("");
    if (Number(data.availableSeats) > Number(data.totalSeats)) {
      setErrorMessage("Available seats cannot be more than total seats.");
      return;
    }

    try {
      const res = await axios.post("/Rides", data);

      if (res.status === 201) {
        setFormSubmitted(true);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        navigate("/login", { state: { from: "/ride" } });
        return;
      }
      setErrorMessage(err.response?.data?.message || "Unable to offer this ride. Please try again.");
    }
  };

  return (
    <div className={styles.outer}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <h1>Offer a Ride</h1>
          <p>Share your journey with others and reduce your carbon footprint</p>
        </div>

        {formSubmitted && (
          <div className={styles.successMessage}>
            <CheckCircle size={20} />
            <span>Your ride has been offered successfully!</span>
          </div>
        )}

        {errorMessage && <p className={styles.errorMessage} role="alert">{errorMessage}</p>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formgroup}>
            <label htmlFor="source" className={styles.label}>
              Location:
            </label>
            <div className={styles.inputWrapper}>
              <MapPin size={18} className={styles.inputIcon} />
              <input
                type="text"
                className={styles.input}
                id="source"
                name="source"
                placeholder="Enter your location"
                required
              />
            </div>
          </div>

          <div className={styles.formgroup}>
            <label htmlFor="destination" className={styles.label}>
              Destination:
            </label>
            <div className={styles.inputWrapper}>
              <MapPin size={18} className={styles.inputIcon} />
              <input
                type="text"
                className={styles.input}
                id="destination"
                name="destination"
                placeholder="Enter your destination"
                required
              />
            </div>
          </div>

          <div className={styles.formgroup}>
            <label htmlFor="departure" className={styles.label}>
              Departure time (optional):
            </label>
            <div className={styles.inputWrapper}>
              <Clock size={18} className={styles.inputIcon} />
              <input
                type="datetime-local"
                className={styles.input}
                id="departure"
                name="departure"
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formgroup}>
              <label htmlFor="carnumber" className={styles.label}>
                Car Number:
              </label>
              <div className={styles.inputWrapper}>
                <Car size={18} className={styles.inputIcon} />
                <input
                  type="text"
                  className={styles.input}
                  id="carnumber"
                  name="carnumber"
                  placeholder="Enter your car number"
                  required
                />
              </div>
            </div>

            <div className={styles.formgroup}>
              <label htmlFor="cartype" className={styles.label}>
                Car Company:
              </label>
              <div className={styles.inputWrapper}>
                <Car size={18} className={styles.inputIcon} />
                <input
                  type="text"
                  className={styles.input}
                  id="cartype"
                  name="cartype"
                  placeholder="Enter your car model or company"
                  required
                />
              </div>
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formgroup}>
              <label htmlFor="carcolor" className={styles.label}>
                Car colour (optional):
              </label>
              <div className={styles.inputWrapper}>
                <Car size={18} className={styles.inputIcon} />
                <input
                  type="text"
                  className={styles.input}
                  id="carcolor"
                  name="carcolor"
                  placeholder="e.g. White"
                  maxLength="30"
                />
              </div>
            </div>

            <div className={styles.formgroup}>
              <label htmlFor="price" className={styles.label}>
                Price per seat in ₹ (optional):
              </label>
              <div className={styles.inputWrapper}>
                <IndianRupee size={18} className={styles.inputIcon} />
                <input
                  type="number"
                  className={styles.input}
                  id="price"
                  name="price"
                  placeholder="e.g. 120"
                  min="0"
                  max="10000"
                />
              </div>
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formgroup}>
              <label htmlFor="Totalseats" className={styles.label}>
                Total number of seats:
              </label>
              <div className={styles.inputWrapper}>
                <Users size={18} className={styles.inputIcon} />
                <input
                  type="number"
                  className={styles.input}
                  id="Totalseats"
                  name="Totalseats"
                  placeholder="Enter total seats"
                  min="1"
                  max="10"
                  required
                />
              </div>
            </div>

            <div className={styles.formgroup}>
              <label htmlFor="Availableseats" className={styles.label}>
                Available seats:
              </label>
              <div className={styles.inputWrapper}>
                <Users size={18} className={styles.inputIcon} />
                <input
                  type="number"
                  className={styles.input}
                  id="Availableseats"
                  name="Availableseats"
                  placeholder="Enter available seats"
                  min="1"
                  max="10"
                  required
                />
              </div>
            </div>
          </div>

          <div className={styles.formgroup}>
            <label
              htmlFor="exampleFormControlTextarea1"
              className={`form-label ${styles.label}`}
            >
              Additional Information
            </label>
            <div className={styles.inputWrapper}>
              <MessageSquare size={18} className={styles.inputIcon} />
              <textarea
                className={`form-control ${styles.input} ${styles.textarea}`}
                id="exampleFormControlTextarea1"
                name="exampleFormControlTextarea1"
                rows="3"
                placeholder="Provide any additional details about your ride (optional)"
              ></textarea>
            </div>
          </div>

          <div className={styles.formActions}>
            <button type="submit" className={styles.submitButton}>
              Offer Ride
            </button>
            <button type="reset" className={styles.resetButton}>
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OfferRide;
