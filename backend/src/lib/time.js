// Bengaluru runs on India Standard Time (UTC+05:30, no daylight saving), so
// local schedule maths can use a fixed offset safely.
export const IST_OFFSET_MINUTES = 330;
const OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

// "YYYY-MM-DD" for the IST calendar date of an instant.
export const istDate = (date = new Date()) => new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);

// Day of week (0 = Sunday) for an IST calendar date string.
export const istWeekday = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

// The UTC instant for an IST calendar date and "HH:MM[:SS]" wall-clock time.
export const istToInstant = (isoDate, time) => {
  const [h, m, s = "0"] = time.split(":");
  const utc = Date.parse(`${isoDate}T00:00:00Z`) + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  return new Date(utc - OFFSET_MS);
};

export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Minutes since IST midnight for an instant.
export const istMinutesOfDay = (date) => {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

export const minutesBetween = (a, b) => (b.getTime() - a.getTime()) / 60000;
