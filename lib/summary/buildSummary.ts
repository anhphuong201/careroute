/**
 * build_summary – one-page PDF patient summary, laid out after the
 * HL7 FHIR International Patient Summary (IPS) sections.
 * The record content is the person's own data (synthetic for the demo);
 * CareRoute adds only today's request and the route it suggested – never a diagnosis.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { PersonaSummary } from "./personas";

export interface VisitContext {
  date: string;
  province: string;
  needSummaryEn?: string;
  routeTitle?: string;
  routeSourceUrl?: string;
  booking?: { facility_name: string; slot: string; confirmation_code: string };
}

/** Standard PDF fonts only support Latin-1 (WinAnsi); replace anything else. */
const latin = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2022]/g, "?");

export async function buildSummaryPdf(p: PersonaSummary, visit: VisitContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Patient summary – ${p.name}`);
  doc.setProducer("CareRoute (prototype)");
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.29, 0.33, 0.39);
  const blue = rgb(0.04, 0.36, 0.68);
  const M = 48;
  const W = 612 - 2 * M;
  let y = 792 - M;

  const text = (s: string, x: number, size: number, f: PDFFont = font, color = ink) => page.drawText(latin(s), { x, y, size, font: f, color });

  const wrap = (s: string, size: number, f: PDFFont, width: number): string[] => {
    const words = latin(s).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };

  const para = (s: string, size = 10, f: PDFFont = font, color = ink, indent = 0) => {
    for (const l of wrap(s, size, f, W - indent)) {
      if (y < M + 40) return;
      page.drawText(l, { x: M + indent, y, size, font: f, color });
      y -= size + 3;
    }
  };

  const section = (title: string, items: string[], empty = "None recorded") => {
    y -= 6;
    if (y < M + 60) return;
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 18, color: rgb(0.93, 0.95, 0.98) });
    text(title, M + 6, 11, bold, blue);
    y -= 20;
    if (!items.length) para(empty, 10, font, muted, 10);
    for (const it of items) para(`• ${it}`, 10, font, ink, 10);
  };

  // Header
  text("Patient Summary", M, 20, bold);
  const stamp = "SYNTHETIC DEMO DATA";
  page.drawText(stamp, { x: M + W - bold.widthOfTextAtSize(stamp, 9), y: y + 6, size: 9, font: bold, color: rgb(0.69, 0, 0.13) });
  y -= 24;
  para(`${p.name}   |   Born ${p.birthDate}   |   ${p.gender}   |   ${[p.city, p.province].filter(Boolean).join(", ")}`, 11, bold);
  para(`Prepared ${visit.date} with CareRoute. Owned by the patient - share it with any provider.`, 9, font, muted);
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: rgb(0.82, 0.84, 0.86) });
  y -= 10;

  // Today's visit
  const today: string[] = [];
  if (visit.needSummaryEn) today.push(`Reason for seeking care (in the patient's words, translated): ${visit.needSummaryEn}`);
  if (visit.routeTitle) today.push(`Suggested route: ${visit.routeTitle}${visit.routeSourceUrl ? ` (source: ${visit.routeSourceUrl})` : ""}`);
  if (visit.booking)
    today.push(`Simulated booking: ${visit.booking.facility_name}, ${new Date(visit.booking.slot).toLocaleString("en-CA")} - code ${visit.booking.confirmation_code} (not a real appointment)`);
  section("Today", today, "No request recorded");

  section("Allergies and intolerances", p.allergies.map((a) => a.text + (a.reaction ? ` - reaction: ${a.reaction}` : "")), "No known allergies recorded");
  section("Current medications", p.medications.map((m) => m.text + (m.dosage ? ` - ${m.dosage}` : "") + (m.since ? ` (since ${m.since})` : "")));
  section("Health problems (from the patient's record)", p.problems.map((c) => c.text + (c.since ? ` (since ${c.since})` : "")));
  section("Immunizations", p.immunizations.map((i) => `${i.text}${i.date ? ` - ${i.date}` : ""}`));
  section(
    "Recent results",
    p.results.map((r) => `${r.text}: ${r.value}${r.flag ? ` (${r.flag === "high" ? "above" : "below"} reference range)` : ""}${r.date ? ` - ${r.date}` : ""}`),
  );

  // Footer
  const foot = "Layout follows the HL7 FHIR International Patient Summary. CareRoute does not diagnose. Prototype - synthetic data only.";
  page.drawText(latin(foot), { x: M, y: M - 10, size: 8, font, color: muted });

  return doc.save();
}
