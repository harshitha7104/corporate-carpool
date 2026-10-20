// Demo rides on common Bangalore office-commute routes, so a fresh install
// looks like a busy carpool board. Drivers are fictional; every ride is
// flagged isDemo so the UI can label it. Departure times are generated
// relative to `now`, spread over the next few weekday mornings and evenings.
const DRIVERS = [
  { name: "arjun_k", rating: 4.9, trips: 212 },
  { name: "priya.s", rating: 4.8, trips: 157 },
  { name: "rahul_m", rating: 4.7, trips: 94 },
  { name: "sneha_r", rating: 5.0, trips: 63 },
  { name: "vikram_n", rating: 4.6, trips: 301 },
  { name: "ananya_b", rating: 4.9, trips: 128 },
  { name: "karthik_v", rating: 4.8, trips: 176 },
  { name: "divya_p", rating: 4.7, trips: 45 },
  { name: "rohan_d", rating: 4.5, trips: 88 },
  { name: "meera_j", rating: 4.9, trips: 239 },
  { name: "aditya_g", rating: 4.8, trips: 67 },
  { name: "kavya_t", rating: 4.6, trips: 112 },
];

// [from, to, car, colour, seats, price per seat (INR), notes]
const ROUTES = [
  ["Whitefield (Phoenix Marketcity)", "Manyata Tech Park", "Hyundai Creta", "White", 4, 180, "AC on. Pickup at the mall's main gate."],
  ["Electronic City Phase 1", "Koramangala 5th Block", "Maruti Swift Dzire", "Silver", 4, 120, "No smoking. Small bags only."],
  ["HSR Layout Sector 2", "Bellandur (Outer Ring Road)", "Tata Nexon EV", "Blue", 4, 70, "Electric car. Quiet ride, music on request."],
  ["Marathahalli Bridge", "MG Road Metro", "Honda City", "Grey", 4, 140, "Leaving sharp on time."],
  ["Indiranagar 100 Ft Road", "ITPL Whitefield", "Kia Seltos", "Red", 4, 130, "Pet friendly. AC on."],
  ["Hebbal Flyover", "Electronic City Infosys Gate", "Toyota Innova Crysta", "White", 6, 220, "Spacious, good for laptop bags."],
  ["Jayanagar 4th Block", "Bagmane Tech Park", "Hyundai i20", "Black", 4, 110, "Women-only ride."],
  ["Yelahanka New Town", "Embassy Golf Links", "Mahindra XUV700", "Grey", 6, 200, "Highway route via Hebbal."],
  ["BTM Layout 2nd Stage", "Whitefield EPIP Zone", "Maruti Baleno", "Blue", 4, 150, "Pickup near Udupi Garden signal."],
  ["Sarjapur Road (Wipro Gate)", "Manyata Tech Park", "MG ZS EV", "White", 4, 190, "Electric car. Phone charger available."],
  ["Banashankari Bus Stand", "Global Village Tech Park", "Honda Amaze", "Silver", 4, 90, "Fixed pickup, no detours."],
  ["Kalyan Nagar", "RMZ Ecospace Bellandur", "Hyundai Venue", "Orange", 4, 120, "AC on. Light music."],
  ["Rajajinagar Metro", "Prestige Tech Park, Kadubeesanahalli", "Tata Punch", "Green", 4, 160, "Quiet ride, no calls please."],
  ["Bannerghatta Road (IIM-B)", "Electronic City Phase 2", "Maruti Ertiga", "Brown", 6, 80, "Daily commuter, same time every weekday."],
  ["KR Puram Railway Station", "Bagmane Tech Park", "Kia Sonet", "Black", 4, 60, "Short hop, happy to share."],
  ["Malleshwaram 18th Cross", "Outer Ring Road (Ecoworld)", "Skoda Slavia", "Blue", 4, 170, "Pickup outside the temple."],
  ["Koramangala Forum Mall", "Manyata Tech Park", "Volkswagen Virtus", "White", 4, 160, "No food in the car please."],
  ["Whitefield (Hope Farm)", "Electronic City Phase 1", "Toyota Hyryder", "Silver", 4, 210, "Hybrid. Via Sarjapur Road."],
];

const PLATES = ["KA 01", "KA 03", "KA 04", "KA 05", "KA 51", "KA 53"];

const buildDemoRides = (now = new Date()) =>
  ROUTES.map(([location, destination, carType, carColor, totalSeats, pricePerSeat, conditions], index) => {
    const driver = DRIVERS[index % DRIVERS.length];
    const evening = index % 3 === 2;
    // Work in India time (UTC+5:30) whatever timezone the server runs in.
    const IST_OFFSET_MS = 330 * 60 * 1000;
    const day = new Date(now.getTime() + IST_OFFSET_MS);
    day.setUTCDate(day.getUTCDate() + 1 + (index % 4));
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
      day.setUTCDate(day.getUTCDate() + 1);
    }
    const hour = (evening ? 17 : 7) + (index % 2) + (index % 5 === 4 ? 1 : 0);
    const minute = [0, 10, 15, 20, 30, 40, 45, 50][index % 8];
    const departure = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute) - IST_OFFSET_MS
    );
    const booked = index % 3;
    const letters = String.fromCharCode(65 + (index % 26), 65 + ((index * 7) % 26));
    return {
      demoKey: `demo-${index + 1}`,
      driverName: driver.name,
      driverRating: driver.rating,
      driverTrips: driver.trips,
      location,
      destination,
      departureTime: departure.toISOString(),
      carNumber: `${PLATES[index % PLATES.length]} ${letters} ${String(1000 + ((index * 1373) % 9000))}`,
      carType,
      carColor,
      totalSeats,
      availableSeats: Math.max(1, totalSeats - 1 - booked),
      pricePerSeat,
      conditions,
      isDemo: true,
    };
  });

module.exports = { buildDemoRides };
