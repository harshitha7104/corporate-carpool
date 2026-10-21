// Colours come from CSS variables in src/index.css so light and dark share one set of names.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        sunken: v("sunken"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        brand: { DEFAULT: v("brand"), strong: v("brand-strong"), soft: v("brand-soft"), ink: v("brand-ink") },
        signal: { DEFAULT: v("signal"), soft: v("signal-soft") },
        good: { DEFAULT: v("good"), soft: v("good-soft") },
        warn: { DEFAULT: v("warn"), soft: v("warn-soft") },
        bad: { DEFAULT: v("bad"), soft: v("bad-soft") },
        info: { DEFAULT: v("info"), soft: v("info-soft") },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"Figtree"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "18px" },
      boxShadow: {
        card: "0 1px 2px rgb(16 32 26 / 0.06), 0 1px 1px rgb(16 32 26 / 0.04)",
        lift: "0 10px 30px -12px rgb(16 32 26 / 0.25)",
      },
    },
  },
  plugins: [],
};
