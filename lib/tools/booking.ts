/**
 * book_appointment – MOCK SERVICE. Nothing is sent anywhere.
 * Only called from /api/book after the user tapped "Yes, book it" (never by the model).
 */
import type { Facility } from "./facilities";

export interface Booking {
  simulated: true;
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

export function bookAppointment(f: Facility, memberName: string, now = new Date()): Booking {
  const code = "SIM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const slot = nextSlot(now);
  return {
    simulated: true,
    confirmation_code: code,
    facility_id: f.id,
    facility_name: f.name,
    facility_address: f.city && !f.address.toLowerCase().includes(f.city.toLowerCase()) ? [f.address, f.city].filter(Boolean).join(", ") : f.address,
    for_member: memberName,
    slot: slot.toISOString(),
    instructions:
      f.kind === "pharmacy"
        ? "Bring your health card and your medicine bottle or list."
        : "Bring your health card, your medicine list and your CareRoute summary.",
  };
}
