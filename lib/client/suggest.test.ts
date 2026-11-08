import { describe, expect, it } from "vitest";
import { googleCalendarUrl, pickSuggestions, suggestSlots } from "./suggest";
import { zonedDate, zonedParts } from "../data/tz";

const TZ = "America/Edmonton";
const hm = (d: Date) => { const p = zonedParts(d, TZ); return [p.dow, p.hour, p.minute]; };

describe("suggestSlots", () => {
  // Saturday 2026-11-07 08:00 in Edmonton (whatever the device's zone is)
  const now = zonedDate(2026, 11, 7, 8, 0, TZ);
  it("intersects free windows with opening hours in the province's zone, one per day", () => {
    const s = suggestSlots("Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", ["wd-eve", "we-am"], now, 3, TZ);
    expect(s).toHaveLength(3);
    expect(hm(s[0])).toEqual([5, 10, 0]); // Saturday 10:00 (free 9–12, opens 10)
    expect(hm(s[1])).toEqual([0, 17, 0]); // Sunday closed → Monday 17:00
  });
  it("returns nothing when hours are unknown or no free times are set", () => {
    expect(suggestSlots("", ["wd-am"], now, 3, TZ)).toEqual([]);
    expect(suggestSlots("24/7", [], now, 3, TZ)).toEqual([]);
  });
  it("keeps at least 2 hours from now", () => {
    const s = suggestSlots("24/7", ["we-am"], now, 3, TZ);
    expect(hm(s[0])[1]).toBe(10);
  });
});

describe("pickSuggestions", () => {
  it("prefers slots inside the free windows, judged in the province's zone", () => {
    const slots = [zonedDate(2026, 11, 9, 9, 0, TZ), zonedDate(2026, 11, 9, 17, 30, TZ), zonedDate(2026, 11, 10, 18, 0, TZ)];
    const s = pickSuggestions(slots, ["wd-eve"], 3, TZ);
    expect(s.map(hm)).toEqual([[0, 17, 30], [1, 18, 0]]);
  });
});

describe("googleCalendarUrl", () => {
  it("builds an add-event link", () => {
    const u = googleCalendarUrl({ title: "Pharmacist", start: new Date("2026-11-09T17:00:00Z"), location: "Calgary", details: "x" });
    expect(u).toContain("action=TEMPLATE");
    expect(u).toContain("dates=20261109T170000Z%2F20261109T173000Z");
  });
});
