/**
 * book_appointment – MOCK SERVICE. Nothing is sent anywhere.
 * Only called from /api/book after the user tapped "Yes, book it" (never by the model).
 */
import type { Facility } from "./facilities";

export interface Booking {
  /** true = mock booking made by CareRoute; false = a real booking the user made on the provider's site. */
  simulated: boolean;
  confirmation_code: string;
  facility_id: string;
  facility_name: string;
  facility_address: string;
  for_member: string;
  slot: string;
  instructions: string;
}

/** Next half-hour slot ≥ 2 h from now, within 8:00–20:00, in the facility's local wall-clock (approximate). */
function nextSlot(now: Date): Date {
  const d = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  if (d.getHours() < 8) d.setHours(8, 0);
  if (d.getHours() >= 20) {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0);
  }
  return d;
}

/** A user-chosen slot must be in the future and within the next 7 days; otherwise we pick the next free one. */
export function validSlot(iso: string | undefined, now = new Date()): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t) || t < now.getTime() || t > now.getTime() + 7 * 24 * 3600 * 1000) return null;
  return d;
}

export function bookAppointment(f: Facility, memberName: string, now = new Date(), requested?: string): Booking {
  const code = "SIM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const slot = validSlot(requested, now) ?? nextSlot(now);
  return {
    simulated: true,
    confirmation_code: code,
    facility_id: f.id,
    facility_name: f.name,
    facility_address: f.kind === "virtual" ? (f.modes ?? []).join(" / ") : f.city && !f.address.toLowerCase().includes(f.city.toLowerCase()) ? [f.address, f.city].filter(Boolean).join(", ") : f.address,
    for_member: memberName,
    slot: slot.toISOString(),
    instructions:
      f.kind === "virtual"
        ? "Be somewhere quiet with your phone charged. Have your health card, medicine list and CareRoute summary ready. In real life, book on the service's own website or by phone."
        : f.kind === "pharmacy"
          ? "Bring your health card and your medicine bottle or list."
          : "Bring your health card, your medicine list and your CareRoute summary.",
  };
}
