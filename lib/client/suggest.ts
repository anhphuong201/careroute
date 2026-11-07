/**
 * Suggest appointment times: the person's usual free windows ∩ the place's opening hours.
 * We cannot see the provider's real free slots, so these are starting points to look for
 * on the booking page. Times are local to the device (the person is in the province).
 */
import { parseHours } from "../data/hours";

export const FREE_WINDOWS: Record<string, { weekend: boolean; from: number; to: number }> = {
  "wd-am": { weekend: false, from: 9 * 60, to: 12 * 60 },
  "wd-pm": { weekend: false, from: 12 * 60, to: 17 * 60 },
  "wd-eve": { weekend: false, from: 17 * 60, to: 20 * 60 },
  "we-am": { weekend: true, from: 9 * 60, to: 12 * 60 },
  "we-pm": { weekend: true, from: 12 * 60, to: 17 * 60 },
};

export function suggestSlots(hoursRaw: string, freeKeys: string[], now = new Date(), count = 3): Date[] {
  const parsed = parseHours(hoursRaw);
  const out: Date[] = [];
  const earliest = now.getTime() + 2 * 3600 * 1000;
  for (let i = 0; i < 8 && out.length < count; i++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + i);
    const dow = (day.getDay() + 6) % 7; // 0 = Monday
    const weekend = dow >= 5;
    const open = parsed.always ? [[0, 1440] as [number, number]] : parsed.week[dow];
    if (!open || open.length === 0) continue; // closed or hours unknown
    for (const key of freeKeys) {
      const w = FREE_WINDOWS[key];
      if (!w || w.weekend !== weekend) continue;
      for (const [o, c] of open) {
        let start = Math.max(w.from, o);
        const end = Math.min(w.to, c);
        // round up to the next :00 / :30 and respect "at least 2 hours from now"
        start = Math.ceil(start / 30) * 30;
        while (start + 30 <= end) {
          const t = new Date(day.getTime() + start * 60000);
          if (t.getTime() >= earliest) {
            if (!out.some((x) => x.toDateString() === t.toDateString())) out.push(t);
            break;
          }
          start += 30;
        }
        if (out.length >= count) break;
      }
      if (out.length >= count) break;
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Google Calendar "add event" link (no API, no sign-in from CareRoute). */
export function googleCalendarUrl(opts: { title: string; start: Date; minutes?: number; location: string; details: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(opts.start.getTime() + (opts.minutes ?? 30) * 60000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: opts.title, dates: `${fmt(opts.start)}/${fmt(end)}`, location: opts.location, details: opts.details });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Pick up to `count` suggestions from open slots: prefer the person's free windows, one per day, earliest first. */
export function pickSuggestions(slots: Date[], freeKeys: string[], count = 3): Date[] {
  const inWindow = (d: Date) => {
    const dow = (d.getDay() + 6) % 7;
    const min = d.getHours() * 60 + d.getMinutes();
    return freeKeys.some((k) => {
      const w = FREE_WINDOWS[k];
      return w && w.weekend === dow >= 5 && min >= w.from && min < w.to;
    });
  };
  const preferred = freeKeys.length ? slots.filter(inWindow) : slots;
  const pool = preferred.length ? preferred : slots;
  const out: Date[] = [];
  for (const s of pool) {
    if (out.some((x) => x.toDateString() === s.toDateString())) continue;
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}
