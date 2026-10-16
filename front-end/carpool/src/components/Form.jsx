import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TfiExchangeVertical } from "react-icons/tfi";
import { Navigation } from "lucide-react";
import styles from "./Form.module.css";
import axios from "../api/axios";
import { getToken } from "../api/auth";
import { formatDeparture } from "../api/format";

const Form = () => {
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [rides,setRides]=useState(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const [busyRide,setBusyRide]=useState(null);
  const [notice,setNotice]=useState("");
  const navigate=useNavigate();

  const loadRides=useCallback(async(params={})=>{
    setLoading(true);
    setError("");
    try {
      const response=await axios.get("/Rides",{params});
      setRides(response.data.rides);
    } catch (err) {
      setError(err.response?.data?.message || "Ride search is unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{
    loadRides();
  },[loadRides]);

  const searchRides=(event)=>{
    event.preventDefault();
    setNotice("");
    loadRides({from,to});
  };

  const toggleBooking=async(ride)=>{
    if (!getToken()) {
      navigate("/login",{state:{from:"/form"}});
      return;
    }
    setBusyRide(ride.id);
    setError("");
    setNotice("");
    try {
      const response=ride.isBooked
        ? await axios.delete(`/Rides/${ride.id}/book`)
        : await axios.post(`/Rides/${ride.id}/book`);
      const updated=response.data.ride;
      setRides((current)=>current.map((item)=>item.id === updated.id ? updated : item));
      setNotice(ride.isBooked ? "Booking cancelled." : `Seat booked with ${ride.driverName}. See it under My Rides.`);
    } catch (err) {
      if (err.response?.status === 401) {
        navigate("/login",{state:{from:"/form"}});
        return;
      }
      setError(err.response?.data?.message || "Unable to update booking. Please try again.");
    } finally {
      setBusyRide(null);
    }
  };

  const swapLocations=()=>{
    setFrom(to);
    setTo(from);
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.cardheader}>
          <div className={styles.cardicon}>
            <Navigation size={32} />
          </div>
          <h2>Find Your Route</h2>
          <p>Enter your journey details</p>
        </div>
        <div className={styles.cardbody}>
          <form className={styles.form} onSubmit={searchRides}>
            <div className={styles.formgroup}>
              <label htmlFor="from" className={styles.formlabel}>
                Starting Point
              </label>
              <input
                type="text"
                id="from"
                className={styles.forminput}
                placeholder="Where are you now?"
                value={from}
                onChange={(event)=>setFrom(event.target.value)}
              />
            </div>

            <button type="button" className={styles.btn1} onClick={swapLocations} aria-label="Swap locations">
              <TfiExchangeVertical />
            </button>

            <div className={styles.formgroup}>
              <label htmlFor="to" className={styles.formlabel}>
                Destination
              </label>
              <input
                type="text"
                id="to"
                className={styles.forminput}
                placeholder="Where do you want to go?"
                value={to}
                onChange={(event)=>setTo(event.target.value)}
              />
            </div>

            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? "Searching..." : "Find Rides"}
            </button>
          </form>
          {error && <p className={styles.searchMessage} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {rides && (
            <section className={styles.results} aria-live="polite">
              <h3>{rides.length ? `${rides.length} ride${rides.length === 1 ? "" : "s"} available` : "No rides found"}</h3>
              {rides.map((ride)=>(
                <article className={styles.ride} key={ride.id}>
                  <h4>{ride.location} to {ride.destination}</h4>
                  <p>Driver: {ride.driverName}</p>
                  {ride.departureTime && <p>Departs: {formatDeparture(ride.departureTime)}</p>}
                  <p>{ride.carType} · {ride.carNumber}</p>
                  <p>{ride.availableSeats} of {ride.totalSeats} seats available</p>
                  {ride.conditions && <p>{ride.conditions}</p>}
                  {ride.isDriver ? (
                    <p className={styles.ownRide}>This is your ride</p>
                  ) : (
                    <button
                      type="button"
                      className={ride.isBooked ? styles.cancelBtn : styles.bookBtn}
                      onClick={()=>toggleBooking(ride)}
                      disabled={busyRide === ride.id}
                    >
                      {busyRide === ride.id ? "Please wait..." : ride.isBooked ? "Cancel booking" : "Book a seat"}
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default Form;
