import { NextResponse } from "next/server";
import { bookAppointment } from "@/lib/tools/booking";
import { getFacility } from "@/lib/tools/facilities";
import { PROVINCES, type ProvinceCode } from "@/lib/provinces";

export const runtime = "nodejs";

/** POST /api/book – SIMULATED. Requires the explicit approval the user gave on screen. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.approved !== true) return NextResponse.json({ error: "approval_required" }, { status: 400 });
  const province = String(b.province) as ProvinceCode;
  if (!(province in PROVINCES)) return NextResponse.json({ error: "bad_province" }, { status: 400 });
  const f = getFacility(province, String(b.facility_id ?? ""));
  if (!f) return NextResponse.json({ error: "unknown_facility" }, { status: 404 });
  const slot = typeof b.slot === "string" ? b.slot : undefined;
  return NextResponse.json(bookAppointment(f, String(b.member_name ?? "").slice(0, 80) || "Patient", new Date(), slot));
}
