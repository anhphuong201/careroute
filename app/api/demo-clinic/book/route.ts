import { NextResponse } from "next/server";
import { createBooking, DEMO_CLINIC, demoMode } from "@/lib/demoClinic";

export const runtime = "nodejs";

/**
 * POST /api/demo-clinic/book – books the DEMO clinic after the user approved on screen.
 * The person's details are passed straight to Cal.com and are not stored or logged here.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.approved !== true) return NextResponse.json({ error: "approval_required" }, { status: 400 });
  const start = new Date(String(b.start ?? ""));
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) return NextResponse.json({ error: "bad_start" }, { status: 400 });
  const name = String(b.name ?? "").trim().slice(0, 100);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const str = (x: unknown, n: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);
  const tz = typeof b.timeZone === "string" && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(b.timeZone) ? b.timeZone : "America/Edmonton";

  if (demoMode() === "offline") {
    return NextResponse.json({ clinic: DEMO_CLINIC, mode: "offline", uid: "DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase(), start: start.toISOString() });
  }
  try {
    const r = await createBooking({ start: start.toISOString(), name, email: str(b.email, 200), phone: str(b.phone, 30), timeZone: tz, note: str(b.note, 300) });
    return NextResponse.json({ clinic: DEMO_CLINIC, mode: "calcom", uid: r.uid, start: start.toISOString() });
  } catch (e) {
    console.error("demo booking failed", e instanceof Error ? e.message : e); // message only – no personal data
    return NextResponse.json({ error: "booking_failed" }, { status: 502 });
  }
}
