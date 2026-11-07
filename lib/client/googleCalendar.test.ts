import { describe, expect, it } from "vitest";
import { freeOf } from "./googleCalendar";

describe("freeOf", () => {
  it("drops slots that overlap a busy block", () => {
    const slots = ["2026-11-09T16:00:00Z", "2026-11-09T16:30:00Z", "2026-11-09T17:00:00Z"].map((s) => new Date(s));
    const busy = [{ start: new Date("2026-11-09T16:15:00Z"), end: new Date("2026-11-09T16:45:00Z") }];
    expect(freeOf(slots, busy).map((d) => d.toISOString())).toEqual(["2026-11-09T17:00:00.000Z"]);
  });
});
