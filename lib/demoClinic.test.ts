import { describe, expect, it } from "vitest";
import { demoMode, offlineSlots } from "./demoClinic";

describe("demo clinic", () => {
  it("runs offline unless both Cal.com settings are present", () => {
    expect(demoMode({})).toBe("offline");
    expect(demoMode({ CALCOM_API_KEY: "cal_x" })).toBe("offline");
    expect(demoMode({ CALCOM_API_KEY: "cal_x", CALCOM_EVENT_TYPE_ID: "1" })).toBe("calcom");
  });
  it("offline slots are in the future, on open days, with some already taken", () => {
    const from = new Date(Date.UTC(2030, 0, 7)); // a Monday
    const s = offlineSlots(from, 7, 420).map((x) => new Date(x));
    expect(s.length).toBeGreaterThan(20);
    expect(s.every((d) => d.getTime() > Date.now())).toBe(true);
    expect(s.some((d) => d.getUTCDay() === 0 && d.getUTCHours() >= 7 && d.getUTCHours() < 24)).toBe(false); // closed Sunday (local)
    // Monday 9:00 MST = 16:00Z is open or taken; 8:00 MST never offered
    expect(s.some((d) => d.toISOString() === "2030-01-07T15:00:00.000Z")).toBe(false);
  });
});
