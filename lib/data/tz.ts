/**
 * Time-zone helpers: show and compute times in the PROVINCE's time zone
 * (Alberta = America/Edmonton, B.C. = America/Vancouver), not the device's.
 */
export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0 = Monday … 6 = Sunday
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function zonedParts(d: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour: +get("hour") % 24, minute: +get("minute"), dow: DOW.indexOf(get("weekday")) };
}

/** Offset (ms) of the zone from UTC at that instant (negative west of Greenwich). */
function offsetMs(d: Date, timeZone: string): number {
  const p = zonedParts(d, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60000) * 60000;
}

/** The instant whose wall-clock time in `timeZone` is y-m-d h:min (day may overflow, like Date.UTC). */
export function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone); // second pass handles DST edges
  return new Date(t);
}

export const dayKey = (d: Date, timeZone: string) => {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
};

/** "2026-11-09T17:30" wall time in the zone, for <input type="datetime-local">. */
export function toZonedInput(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

export function fromZonedInput(v: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? zonedDate(+m[1], +m[2], +m[3], +m[4], +m[5], timeZone) : null;
}

/** Short abbreviation like "MST" / "PDT" for labels. */
export function tzLabel(timeZone: string, locale = "en-CA", at = new Date()): string {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}
