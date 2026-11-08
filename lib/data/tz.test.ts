import { describe, expect, it } from "vitest";
import { fromZonedInput, toZonedInput, tzLabel, zonedDate, zonedParts } from "./tz";

describe("time zones", () => {
  // tzdata 2026e: Alberta and B.C. stay on daylight time year-round from 2026 (no fall-back in Nov 2026).
  it("converts wall time in Edmonton and Vancouver to the right instant", () => {
    expect(zonedDate(2026, 1, 15, 9, 0, "America/Edmonton").toISOString()).toBe("2026-01-15T16:00:00.000Z"); // MST (winter 2026)
    expect(zonedDate(2026, 11, 9, 9, 0, "America/Edmonton").toISOString()).toBe("2026-11-09T15:00:00.000Z"); // MDT, permanent
    expect(zonedDate(2026, 11, 9, 9, 0, "America/Vancouver").toISOString()).toBe("2026-11-09T16:00:00.000Z"); // PDT, permanent
    expect(zonedDate(2026, 11, 9, 9, 0, "America/Toronto").toISOString()).toBe("2026-11-09T14:00:00.000Z"); // EST (Ontario still switches)
  });
  it("reads parts and round-trips datetime-local values", () => {
    const d = new Date("2026-11-09T15:30:00Z");
    expect(zonedParts(d, "America/Edmonton")).toMatchObject({ hour: 9, minute: 30, dow: 0 });
    expect(toZonedInput(d, "America/Vancouver")).toBe("2026-11-09T08:30");
    expect(fromZonedInput("2026-11-09T08:30", "America/Vancouver")!.toISOString()).toBe(d.toISOString());
  });
  it("labels the zone", () => {
    expect(tzLabel("America/Edmonton", "en-CA", new Date("2026-01-15T16:00:00Z"))).toBe("MST");
    expect(tzLabel("America/Vancouver", "en-CA", new Date("2026-11-09T16:00:00Z"))).toBe("PDT");
  });
});
