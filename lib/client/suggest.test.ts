import { describe, expect, it } from "vitest";
import { googleCalendarUrl, suggestSlots } from "./suggest";

describe("suggestSlots", () => {
  // Saturday 2026-11-07 08:00 local
  const now = new Date(2026, 10, 7, 8, 0);
  it("intersects free windows with opening hours, one per day", () => {
    const s = suggestSlots("Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", ["wd-eve", "we-am"], now);
    expect(s).toHaveLength(3);
    // Saturday: free 9–12, open from 10 → 10:00
    expect([s[0].getDay(), s[0].getHours(), s[0].getMinutes()]).toEqual([6, 10, 0]);
    // Sunday closed → next is Monday evening 17:00
    expect([s[1].getDay(), s[1].getHours()]).toEqual([1, 17]);
  });
  it("returns nothing when hours are unknown or no free times are set", () => {
    expect(suggestSlots("", ["wd-am"], now)).toEqual([]);
    expect(suggestSlots("24/7", [], now)).toEqual([]);
  });
  it("keeps at least 2 hours from now", () => {
    const s = suggestSlots("24/7", ["we-am"], now);
    expect(s[0].getHours()).toBe(10);
  });
});

describe("googleCalendarUrl", () => {
  it("builds an add-event link", () => {
    const u = googleCalendarUrl({ title: "Pharmacist", start: new Date("2026-11-09T17:00:00Z"), location: "Calgary", details: "x" });
    expect(u).toContain("action=TEMPLATE");
    expect(u).toContain("dates=20261109T170000Z%2F20261109T173000Z");
  });
});
