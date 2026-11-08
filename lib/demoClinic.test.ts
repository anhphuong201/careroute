import { describe, expect, it } from "vitest";
import { demoMode, offlineSlots } from "./demoClinic";

describe("demo clinic", () => {
  it("runs offline unless both Cal.com settings are present", () => {
    expect(demoMode({})).toBe("offline");
    expect(demoMode({ CALCOM_API_KEY: "cal_x" })).toBe("offline");
    expect(demoMode({ CALCOM_API_KEY: "cal_x", CALCOM_EVENT_TYPE_ID: "1" })).toBe("calcom");
  });
  it("offline slots follow the clinic's time zone, open days only", async () => {
    const { zonedParts } = await import("./data/tz");
    const tz = "America/Edmonton";
    const s = offlineSlots(new Date("2030-01-07T12:00:00Z"), 7, tz, Date.parse("2030-01-01T00:00:00Z")).map((x) => new Date(x));
    expect(s.length).toBeGreaterThan(20);
    const parts = s.map((d) => zonedParts(d, tz));
    expect(parts.some((p) => p.dow === 6)).toBe(false); // closed Sunday
    expect(parts.every((p) => p.hour >= 9 && p.hour < 17)).toBe(true); // local opening hours
  });
});
