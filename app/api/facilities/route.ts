import { NextResponse } from "next/server";
import { checkErWaits, findFacilities, type FacilityKind } from "@/lib/tools/facilities";
import { PROVINCES, type ProvinceCode } from "@/lib/provinces";

export const runtime = "nodejs";

/**
 * POST /api/facilities – places for an alternative route the user tapped. No AI involved.
 * Wait times are attached only for urgent care / emergency sites (red flags were already excluded
 * before any route was shown).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const province = String(b.province) as ProvinceCode;
  const kind = String(b.kind) as FacilityKind;
  if (!(province in PROVINCES) || !["pharmacy", "walk_in", "urgent_care", "virtual"].includes(kind)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const lat = Number((b.location as { lat?: unknown } | null)?.lat);
  const lng = Number((b.location as { lng?: unknown } | null)?.lng);
  const out = findFacilities({ province, kind, lat: Number.isFinite(lat) ? lat : undefined, lng: Number.isFinite(lng) ? lng : undefined, limit: 5 });
  const waits = kind === "walk_in" || kind === "urgent_care" ? checkErWaits(province, out.facilities.map((f) => f.id)) : null;
  const byId = new Map((waits?.sites ?? []).map((s) => [s.id, s.wait_minutes]));
  return NextResponse.json({
    location_needed: !out.location_used,
    facilities: out.facilities.map((f) => (byId.has(f.id) ? { ...f, wait_minutes: byId.get(f.id) } : f)),
    er_waits_source: waits?.available ? { name: waits.source_name, url: waits.source_url, refreshed_at: waits.refreshed_at } : undefined,
  });
}
