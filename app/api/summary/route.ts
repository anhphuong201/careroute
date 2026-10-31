import { buildSummaryPdf, type VisitContext } from "@/lib/summary/buildSummary";
import { loadPersona } from "@/lib/summary/personas";

export const runtime = "nodejs";

/** POST /api/summary – returns the one-page PDF. Generated on the fly; nothing is stored. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { persona_id?: string; visit?: Partial<VisitContext> };
  const persona = loadPersona(String(b.persona_id ?? ""));
  if (!persona) return Response.json({ error: "unknown_persona" }, { status: 404 });
  const v = b.visit ?? {};
  const s = (x: unknown, n = 400) => (typeof x === "string" ? x.slice(0, n) : undefined);
  const pdf = await buildSummaryPdf(persona, {
    date: new Date().toISOString().slice(0, 10),
    province: s(v.province, 2) ?? "",
    needSummaryEn: s(v.needSummaryEn),
    routeTitle: s(v.routeTitle, 120),
    routeSourceUrl: s(v.routeSourceUrl, 300),
    booking: v.booking && {
      facility_name: s(v.booking.facility_name, 120) ?? "",
      slot: s(v.booking.slot, 40) ?? "",
      confirmation_code: s(v.booking.confirmation_code, 20) ?? "",
    },
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="careroute-summary-${persona.id}.pdf"`, "cache-control": "no-store" },
  });
}
