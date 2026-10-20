import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "../api/axios";
import { getToken } from "../api/auth";
import { formatDeparture } from "../api/format";
import Header from "./Header.jsx";
import styles from "./MyRides.module.css";

const RideDetails = ({ ride }) => (
  <>
    <h4>{ride.location} to {ride.destination}</h4>
    {ride.departureTime && <p>Departs: {formatDeparture(ride.departureTime)}</p>}
    <p>{ride.carType} · {ride.carNumber}</p>
    <p>{ride.availableSeats} of {ride.totalSeats} seats available</p>
  </>
);

const MyRides = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      const response = await axios.get("/MyRides");
      setData(response.data);
    } catch (err) {
      if (err.response?.status === 401) {
        navigate("/login", { state: { from: "/my-rides" } });
        return;
      }
      setError(err.response?.data?.message || "Unable to load your rides.");
    }
  };

  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { state: { from: "/my-rides" } });
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id, request) => {
    setBusy(id);
    setError("");
    try {
      await request();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const [confirming, setConfirming] = useState(null);

  const removeRide = (ride) => {
    if (confirming !== ride.id) {
      setConfirming(ride.id);
      return;
    }
    setConfirming(null);
    act(ride.id, () => axios.delete(`/Rides/${ride.id}`));
  };

  const cancelBooking = (ride) =>
    act(ride.id, () => axios.delete(`/Rides/${ride.id}/book`));

  return (
    <>
    <Header />
    <main className={styles.page}>
      <h1>My Rides</h1>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!data && !error && <p>Loading...</p>}
      {data && (
        <div className={styles.columns}>
          <section>
            <h2>Rides I'm offering</h2>
            {data.offered.length === 0 && (
              <p className={styles.empty}>
                You haven't offered any rides. <Link to="/ride">Offer one</Link>
              </p>
            )}
            {data.offered.map((ride) => (
              <article className={styles.ride} key={ride.id}>
                <RideDetails ride={ride} />
                <p>
                  Passengers:{" "}
                  {ride.passengers.length
                    ? ride.passengers.map((p) => `${p.username} (${p.email})`).join(", ")
                    : "none yet"}
                </p>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy === ride.id}
                  onClick={() => removeRide(ride)}
                >
                  {confirming === ride.id ? "Click again to remove" : "Remove ride"}
                </button>
                {confirming === ride.id && (
                  <button type="button" className={styles.secondary} onClick={() => setConfirming(null)}>
                    Keep ride
                  </button>
                )}
              </article>
            ))}
          </section>
          <section>
            <h2>Seats I've booked</h2>
            {data.booked.length === 0 && (
              <p className={styles.empty}>
                No bookings yet. <Link to="/form">Find a ride</Link>
              </p>
            )}
            {data.booked.map((ride) => (
              <article className={styles.ride} key={ride.id}>
                <RideDetails ride={ride} />
                <p>Driver: {ride.driverName}</p>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy === ride.id}
                  onClick={() => cancelBooking(ride)}
                >
                  Cancel booking
                </button>
              </article>
            ))}
          </section>
        </div>
      )}
    </main>
    </>
  );
};

export default MyRides;
