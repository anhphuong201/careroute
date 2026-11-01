import { describe, expect, it } from "vitest";
import { openStatus, parseHours, weekLines } from "./hours";

const TZ = "America/Edmonton";
// Wed 2026-11-04 10:30 in Edmonton (UTC-7) = 17:30Z
const WED_1030 = new Date("2026-11-04T17:30:00Z");
const WED_2130 = new Date("2026-11-05T04:30:00Z");

describe("parseHours", () => {
  it("parses OpenStreetMap opening_hours with split days and off", () => {
    const p = parseHours("Mo-Fr 09:00-12:00,13:00-17:00; Sa,Su,PH off");
    expect(p.week[0]).toEqual([[540, 720], [780, 1020]]);
    expect(p.week[5]).toEqual([]);
    expect(openStatus(p, TZ, WED_1030)).toEqual({ kind: "open", closesAt: 720 });
  });
  it("parses HealthLink BC format and ignores the note", () => {
    const p = parseHours("Mon 08:00 - 17:00; Tue 08:00 - 17:00; Wed 08:00 - 17:00; Thu 08:00 - 17:00; Fri 08:00 - 17:00; Sat 09:00 - 15:00; Note that hours are subject to physician availability");
    expect(p.week[2]).toEqual([[480, 1020]]);
    expect(p.week[6]).toBeNull();
  });
  it("handles 24/7 and AHS notes", () => {
    expect(parseHours("Open 24 hours for patients 17 & under").always).toBe(true);
    expect(parseHours("24/7").always).toBe(true);
    const p = parseHours("8 am – 10 pm");
    expect(p.week[3]).toEqual([[480, 1320]]);
  });
  it("accepts commas between day rules and the || fallback", () => {
    const p = parseHours("Mo-Fr 09:00-19:00, Sa 10:00-16:00, Su closed");
    expect(p.week[4]).toEqual([[540, 1140]]);
    expect(p.week[5]).toEqual([[600, 960]]);
    expect(p.week[6]).toEqual([]);
    expect(parseHours("Mo-Tu,Th 09:30-17:30, Fr 09:30-14:00, We,Sa-Su closed").week[2]).toEqual([]);
    expect(parseHours("Mo-Fr 08:30-17:00 || off").week[0]).toEqual([[510, 1020]]);
  });
  it("returns unknown for free text", () => {
    expect(openStatus(parseHours("Call for hours"), TZ, WED_1030)).toEqual({ kind: "unknown" });
  });
});

describe("openStatus", () => {
  it("says when it opens next", () => {
    const p = parseHours("Mo-Fr 09:00-17:00; Sa,Su off");
    expect(openStatus(p, TZ, WED_2130)).toEqual({ kind: "closed", opensAt: 540, opensDay: 3, opensToday: false });
  });
  it("handles ranges past midnight", () => {
    const p = parseHours("Mo-Su 18:00-02:00");
    // Thu ~00:30–01:30 Edmonton
    expect(openStatus(p, TZ, new Date("2026-11-05T07:30:00Z"))).toEqual({ kind: "open", closesAt: 120 });
  });
});

describe("weekLines", () => {
  it("merges identical days", () => {
    const lines = weekLines(parseHours("Mo-Fr 09:00-17:00; Sa,Su off").week, "en-CA", "Closed");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Mon–Fri/);
    expect(lines[1]).toMatch(/Closed$/);
  });
});
