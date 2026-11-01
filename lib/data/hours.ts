/**
 * Opening hours: parse the formats found in our data and compute "open now" in the
 * facility's local time. Pure + isomorphic (used by the UI).
 *
 *   OpenStreetMap  "Mo-Fr 09:00-17:00; Sa 10:00-16:00; Su,PH off", "24/7", "Mo-Su 08:00-12:00,13:00-20:00"
 *   HealthLink BC  "Mon 08:00 - 17:00; Tue 08:00 - 17:00; …; Note that hours are subject to …"
 *   AHS notes      "Open 24 hours", "8 am – 8 pm"
 */

/** week[0] = Monday … week[6] = Sunday; each day is a list of [openMinute, closeMinute]. null = unknown. */
export type Week = ([number, number][] | null)[];

const DAY_KEYS: Record<string, number> = {
  mo: 0, mon: 0, monday: 0, tu: 1, tue: 1, tues: 1, tuesday: 1, we: 2, wed: 2, wednesday: 2,
  th: 3, thu: 3, thur: 3, thurs: 3, thursday: 3, fr: 4, fri: 4, friday: 4, sa: 5, sat: 5, saturday: 5, su: 6, sun: 6, sunday: 6,
};

const toMin = (h: number, m: number) => h * 60 + m;

function parse12h(s: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return toMin(h, Number(m[2] ?? 0));
}

function parseRanges(s: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of s.split(",")) {
    const m = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/.exec(part);
    if (!m) return null;
    const o = toMin(Number(m[1]), Number(m[2]));
    let c = toMin(Number(m[3]), Number(m[4]));
    if (c <= o) c += 24 * 60; // past midnight, e.g. 22:00-02:00 or 00:00-24:00
    out.push([o, c]);
  }
  return out;
}

function dayList(spec: string): number[] | null {
  const days: number[] = [];
  for (const piece of spec.toLowerCase().split(",")) {
    const p = piece.trim();
    if (p === "ph" || p === "sh") continue; // public/school holidays: ignored
    const r = /^([a-z]+)\s*-\s*([a-z]+)$/.exec(p);
    if (r) {
      const a = DAY_KEYS[r[1]];
      const b = DAY_KEYS[r[2]];
      if (a === undefined || b === undefined) return null;
      for (let d = a; ; d = (d + 1) % 7) {
        days.push(d);
        if (d === b) break;
      }
    } else if (DAY_KEYS[p] !== undefined) days.push(DAY_KEYS[p]);
    else return null;
  }
  return days;
}

export function parseHours(raw: string | undefined | null): { week: Week; always: boolean } {
  const empty: Week = [null, null, null, null, null, null, null];
  const s = (raw ?? "").trim();
  if (!s) return { week: empty, always: false };
  if (/^24\/7$|open 24 hours|24 hours|^24\/7\b|open 24\/7/i.test(s)) {
    return { week: Array.from({ length: 7 }, () => [[0, 1440]] as [number, number][]), always: true };
  }
  const week: Week = [...empty];
  let matched = false;
  // Non-standard but common: rules separated by ", " before a day name; "||" fallback rules.
  const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const rules = s
    .split("||")[0]
    .replace(new RegExp(`(?<=\\d{2}:\\d{2}|\\boff|\\bclosed)\\s*,\\s*(?=${DAY}\\b)`, "gi"), ";")
    .split(";");
  for (const rule of rules) {
    const r = rule.trim();
    if (!r) continue;
    // "<days> off|closed"
    const off = /^([A-Za-z ,\-]+?)\s+(off|closed)$/i.exec(r);
    if (off) {
      const ds = dayList(off[1]);
      if (ds) {
        ds.forEach((d) => (week[d] = []));
        matched = true;
      }
      continue;
    }
    // "<days> HH:MM-HH:MM[,HH:MM-HH:MM]"  (OSM and HealthLink BC)
    const m = /^([A-Za-z ,\-]+?)\s+(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})*)$/.exec(r);
    if (m) {
      const ds = dayList(m[1]);
      const ranges = parseRanges(m[2]);
      if (ds && ranges) {
        ds.forEach((d) => (week[d] = [...(week[d] ?? []), ...ranges]));
        matched = true;
      }
      continue;
    }
    // "HH:MM-HH:MM" with no days → every day
    const every = /^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})$/.exec(r);
    if (every) {
      const ranges = parseRanges(every[1]);
      if (ranges) {
        for (let d = 0; d < 7; d++) week[d] = ranges;
        matched = true;
      }
    }
  }
  if (!matched) {
    // "8 am – 8 pm" (AHS notes) → every day
    const m = /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i.exec(s);
    if (m) {
      const o = parse12h(m[1]);
      let c = parse12h(m[2]);
      if (o !== null && c !== null) {
        if (c <= o) c += 1440;
        for (let d = 0; d < 7; d++) week[d] = [[o, c]];
      }
    }
  }
  return { week, always: false };
}

/** Local weekday (0=Mon) and minute-of-day in a time zone. */
export function localNow(timeZone: string, now = new Date()): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type OpenStatus =
  | { kind: "unknown" }
  | { kind: "always" }
  | { kind: "open"; closesAt: number }
  | { kind: "closed"; opensAt: number; opensDay: number; opensToday: boolean };

export function openStatus(parsed: { week: Week; always: boolean }, timeZone: string, now = new Date()): OpenStatus {
  if (parsed.always) return { kind: "always" };
  if (parsed.week.every((d) => d === null)) return { kind: "unknown" };
  const { day, minute } = localNow(timeZone, now);
  // Ranges from yesterday that run past midnight count for today.
  const y = parsed.week[(day + 6) % 7] ?? [];
  for (const [o, c] of y) if (c > 1440 && minute < c - 1440) return { kind: "open", closesAt: c - 1440 };
  const today = parsed.week[day];
  if (today === null) return { kind: "unknown" };
  for (const [o, c] of today) if (minute >= o && minute < c) return { kind: "open", closesAt: c % 1440 };
  const later = today.filter(([o]) => o > minute).sort((a, b) => a[0] - b[0])[0];
  if (later) return { kind: "closed", opensAt: later[0], opensDay: day, opensToday: true };
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const r = parsed.week[d];
    if (r && r.length) return { kind: "closed", opensAt: Math.min(...r.map((x) => x[0])), opensDay: d, opensToday: false };
  }
  return { kind: "unknown" };
}

/** "9:00 a.m." / "9 h 00" etc. via Intl. */
export function fmtMinute(min: number, locale: string): string {
  const d = new Date(Date.UTC(2026, 0, 5, Math.floor(min / 60) % 24, min % 60));
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}

export function fmtWeekday(day: number, locale: string, style: "short" | "long" = "short"): string {
  // 2026-01-05 is a Monday
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5 + day, 12)));
}

/** Weekly lines like "Mon  9:00 a.m. – 5:00 p.m." (consecutive identical days are merged). */
export function weekLines(week: Week, locale: string, closedLabel: string): string[] {
  const fmtDay = (r: [number, number][] | null) =>
    r === null ? "" : r.length === 0 ? closedLabel : r.map(([o, c]) => `${fmtMinute(o, locale)} – ${fmtMinute(c % 1440, locale)}`).join(", ");
  const lines: string[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && fmtDay(week[j + 1]) === fmtDay(week[i])) j++;
    const label = i === j ? fmtWeekday(i, locale) : `${fmtWeekday(i, locale)}–${fmtWeekday(j, locale)}`;
    const v = fmtDay(week[i]);
    if (v) lines.push(`${label}  ${v}`);
    i = j + 1;
  }
  return lines;
}
