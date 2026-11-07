import { NextResponse } from "next/server";
import { DEMO_CLINIC, demoMode, fetchSlots, offlineSlots } from "@/lib/demoClinic";

export const runtime = "nodejs";

/** GET /api/demo-clinic/slots?tz=America/Edmonton&days=7 – open slots at the DEMO clinic. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tz = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(url.searchParams.get("tz") ?? "") ? url.searchParams.get("tz")! : "America/Edmonton";
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 14);
  const start = new Date();
  const end = new Date(start.getTime() + days * 86400000);
  const mode = demoMode();
  try {
    const slots =
      mode === "calcom"
        ? await fetchSlots(start.toISOString(), end.toISOString(), tz)
        : offlineSlots(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())), days, tz === "America/Vancouver" ? 480 : 420);
    return NextResponse.json({ clinic: DEMO_CLINIC, mode, slots });
  } catch (e) {
    console.error("demo slots", e instanceof Error ? e.message : e);
    return NextResponse.json({ clinic: DEMO_CLINIC, mode, slots: [], error: "slots_unavailable" }, { status: 502 });
  }
}
