import { describe, expect, it } from "vitest";
import { duration, istHHMM, istToIso, km, plate, rupees } from "./format";

describe("money and units", () => {
  it("formats integer paise as Indian rupees", () => {
    expect(rupees(12000)).toBe("₹120");
    expect(rupees(12050)).toBe("₹120.50");
    expect(rupees(12345600)).toBe("₹1,23,456");
    expect(rupees(0)).toBe("Free");
    expect(rupees(null)).toBe("—");
  });

  it("formats distances and durations", () => {
    expect(km(640)).toBe("640 m");
    expect(km(9_840)).toBe("9.8 km");
    expect(km(23_400)).toBe("23 km");
    expect(duration(45 * 60)).toBe("45 min");
    expect(duration(95 * 60)).toBe("1 h 35 min");
  });

  it("formats Karnataka number plates for reading", () => {
    expect(plate("KA01MJ4821")).toBe("KA 01 MJ 4821");
    expect(plate("KA53P6618")).toBe("KA 53 P 6618");
  });
});

describe("India Standard Time", () => {
  it("converts an IST wall-clock time to the right instant", () => {
    expect(istToIso("2026-11-02", "08:30")).toBe("2026-11-02T03:00:00.000Z");
    expect(istHHMM("2026-11-02T03:00:00.000Z")).toBe("08:30");
  });
});
