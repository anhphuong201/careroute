/**
 * CareRoute Demo Pharmacy – a DEMO provider with real bookable slots on Cal.com.
 * Shows what one-tap booking looks like once a pharmacy exposes a booking API.
 *
 * Env (server only): CALCOM_API_KEY (cal_...), CALCOM_EVENT_TYPE_ID (number).
 * Without them the clinic runs in "offline demo" mode: generated slots, simulated booking.
 * Docs: https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type
 *       https://cal.com/docs/api-reference/v2/bookings/create-a-booking
 */
const API = "https://api.cal.com/v2";

export const DEMO_CLINIC = {
  id: "demo-clinic",
  name: "CareRoute Demo Pharmacy",
  note: "DEMO provider for the prototype – not a real pharmacy.",
};

export type DemoMode = "calcom" | "offline";

export function demoMode(env: Record<string, string | undefined> = process.env): DemoMode {
  return env.CALCOM_API_KEY && env.CALCOM_EVENT_TYPE_ID ? "calcom" : "offline";
}

/** Offline demo: weekdays 9:00–17:00 and Saturday 10:00–14:00 local, 30-minute slots, some already "taken". */
export function offlineSlots(from: Date, days: number, timeZoneOffsetMin = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const dow = d.getUTCDay();
    const open = dow === 0 ? null : dow === 6 ? [10, 14] : [9, 17];
    if (!open) continue;
    for (let h = open[0]; h < open[1]; h++)
      for (const m of [0, 30]) {
        if ((h * 2 + m / 30 + i) % 3 === 0) continue; // pretend a third are booked
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) + timeZoneOffsetMin * 60000;
        if (t > Date.now() + 3600000) out.push(new Date(t).toISOString());
      }
  }
  return out;
}

export async function fetchSlots(startISO: string, endISO: string, timeZone: string): Promise<string[]> {
  const q = new URLSearchParams({ eventTypeId: String(process.env.CALCOM_EVENT_TYPE_ID), start: startISO, end: endISO, timeZone });
  const res = await fetch(`${API}/slots?${q}`, {
    headers: { Authorization: `Bearer ${process.env.CALCOM_API_KEY}`, "cal-api-version": "2024-09-04" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Cal.com slots → HTTP ${res.status}`);
  const json = (await res.json()) as { status: string; data: Record<string, { start: string }[]> };
  return Object.values(json.data ?? {})
    .flat()
    .map((s) => new Date(s.start).toISOString())
    .sort();
}

export interface DemoBookingInput {
  start: string;
  name: string;
  email?: string;
  phone?: string;
  timeZone: string;
  note?: string;
}

export async function createBooking(b: DemoBookingInput): Promise<{ uid: string }> {
  const attendee: Record<string, string> = { name: b.name, timeZone: b.timeZone };
  if (b.email) attendee.email = b.email;
  if (b.phone) attendee.phoneNumber = b.phone;
  const res = await fetch(`${API}/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CALCOM_API_KEY}`, "cal-api-version": "2026-02-25", "content-type": "application/json" },
    body: JSON.stringify({
      start: b.start,
      eventTypeId: Number(process.env.CALCOM_EVENT_TYPE_ID),
      attendee,
      ...(b.note ? { bookingFieldsResponses: { notes: b.note } } : {}),
      metadata: { source: "CareRoute prototype" },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; data?: { uid?: string }; error?: { message?: string } };
  if (!res.ok || json.status !== "success" || !json.data?.uid) throw new Error(json.error?.message || `Cal.com booking → HTTP ${res.status}`);
  return { uid: json.data.uid };
}
