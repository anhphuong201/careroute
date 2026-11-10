/**
 * Links to get to an appointment. Nothing is booked: each link opens the other app with the
 * trip filled in, and the person confirms there.
 */
import { zonedParts } from "../data/tz";

export interface TravelPlace {
  name: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  /** Demo only: the real place used as a stand-in destination (shown on screen). */
  standIn?: string;
}

const hasStreet = (a: string) => /\d/.test(a.split(",")[0] ?? "");
const destText = (p: TravelPlace) =>
  hasStreet(p.address) || (!p.lat && p.address) ? [p.name, p.address, p.city].filter(Boolean).join(", ") : `${p.lat},${p.lng}`;

/** Arrive this many minutes before the appointment. */
export const ARRIVE_EARLY_MIN = 15;

export function arriveBy(appointment: Date): Date {
  return new Date(appointment.getTime() - ARRIVE_EARLY_MIN * 60000);
}

/**
 * Google Maps public-transit directions with "arrive by" set (Google's long-standing
 * saddr/daddr link format, which keeps the arrival time; the Maps app may ignore the time,
 * so the screen also shows "arrive by").
 */
export function transitArriveByUrl(place: TravelPlace, appointment: Date, timeZone: string, from?: { lat: number; lng: number } | null): string {
  const t = zonedParts(arriveBy(appointment), timeZone);
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const time = `${h12}:${String(t.minute).padStart(2, "0")}${t.hour < 12 ? "am" : "pm"}`;
  const date = `${String(t.month).padStart(2, "0")}/${String(t.day).padStart(2, "0")}/${String(t.year).slice(2)}`;
  const q = new URLSearchParams({
    saddr: from ? `${from.lat},${from.lng}` : "My Location",
    daddr: destText(place),
    dirflg: "r", // public transit
    ttype: "arr", // arrive by
    date,
    time,
  });
  return `https://maps.google.com/maps?${q.toString()}`;
}

/** Uber universal link with pickup (GPS if shared, else current location) and drop-off filled in. */
export function uberRideUrl(place: TravelPlace, from?: { lat: number; lng: number } | null): string | null {
  if (place.lat == null || place.lng == null) return null;
  const q = new URLSearchParams({ action: "setPickup" });
  if (from) {
    q.set("pickup[latitude]", String(from.lat));
    q.set("pickup[longitude]", String(from.lng));
  } else q.set("pickup", "my_location");
  q.set("dropoff[latitude]", String(place.lat));
  q.set("dropoff[longitude]", String(place.lng));
  q.set("dropoff[nickname]", place.name);
  q.set("dropoff[formatted_address]", [place.address, place.city].filter(Boolean).join(", ") || place.name);
  return `https://m.uber.com/ul/?${q.toString()}`;
}
