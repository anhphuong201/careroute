/** Pure helpers for assisted booking (no network, no storage). */
import type { BookingContact } from "../types";

/** "1234-56789" → "••••••6789" */
export function maskCard(card: string | undefined): string {
  const d = (card ?? "").replace(/\s/g, "");
  if (d.length <= 4) return d;
  return "•".repeat(Math.min(d.length - 4, 8)) + d.slice(-4);
}

export function callScript(opts: { place: string; name?: string; reason: string; lang: "en" | "fr" }): string {
  const who = opts.name?.trim();
  if (opts.lang === "fr")
    return `Bonjour, j'aimerais prendre rendez-vous avec un pharmacien${who ? ` pour ${who}` : ""}. Raison : ${opts.reason} Quelle est la première disponibilité?`;
  return `Hi, I'd like to book an appointment with a pharmacist${who ? ` for ${who}` : ""}. The reason is: ${opts.reason} When is the next available time?`;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** iCalendar file text for "Add to calendar". 30-minute event. */
export function icsFor(opts: { title: string; start: Date; location: string; description: string; uid?: string }): string {
  const end = new Date(opts.start.getTime() + 30 * 60 * 1000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareRoute//prototype//EN",
    "BEGIN:VEVENT",
    `UID:${opts.uid ?? `${icsDate(opts.start)}-careroute`}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(opts.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `LOCATION:${icsEscape(opts.location)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(opts.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function hasContact(c: BookingContact | undefined): boolean {
  return !!c && Object.values(c).some((v) => typeof v === "string" && v.trim());
}
