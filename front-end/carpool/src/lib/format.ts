// India-first formatting: rupees from integer paise, IST clock times.
const TZ = "Asia/Kolkata";

export const rupees = (paise: number | null | undefined, { free = "Free" } = {}) => {
  if (paise === null || paise === undefined) return "—";
  if (paise === 0) return free;
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

export const time = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

export const day = (iso: string | Date) => {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (key(d) === key(today)) return "Today";
  if (key(d) === key(tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
};

export const dateTime = (iso: string | Date) => `${day(iso)}, ${time(iso)}`;

export const fullDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });

export const relative = (iso: string | Date) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return day(iso);
};

// "in 3 h" / "in 25 min" for a future instant.
export const until = (iso: string | Date) => {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 60) return "in a moment";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `on ${day(iso)}`;
};

export const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

export const duration = (s: number) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};

// IST calendar date "YYYY-MM-DD" for an offset in days from today.
export const istDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });

// "YYYY-MM-DD" + "HH:MM" (IST wall clock) -> ISO instant.
export const istToIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

export const istHHMM = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

export const maskPhone = (p: string | null | undefined) => (p ? `${p.slice(0, 3)} ${p.slice(3, 8)} ${p.slice(8)}` : "");

export const plate = (p: string | null | undefined) => {
  if (!p) return "";
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(p);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ") : p;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const pluralise = (n: number, word: string, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
