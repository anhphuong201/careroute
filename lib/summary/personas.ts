/** Read Synthea-style FHIR R4 Bundles from /data/personas into an IPS-like summary. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Resource = Record<string, any> & { resourceType: string };

export interface PersonaSummary {
  id: string;
  name: string;
  birthDate: string;
  gender: string;
  city: string;
  province: string;
  note: string;
  allergies: { text: string; reaction?: string }[];
  medications: { text: string; dosage?: string; since?: string }[];
  problems: { text: string; since?: string }[];
  immunizations: { text: string; date?: string }[];
  results: { text: string; value: string; date?: string; flag?: "high" | "low" }[];
}

const DIR = () => path.join(process.cwd(), "data", "personas");
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

const cc = (c: any): string => c?.text ?? c?.coding?.[0]?.display ?? "";
const stripName = (s: string) => s.replace(/\d+/g, ""); // Synthea appends numbers to names
const isActive = (r: Resource) => {
  const code = r.clinicalStatus?.coding?.[0]?.code;
  return !code || code === "active";
};

export function listPersonas(): { id: string; name: string; note: string; birthDate: string; province: string }[] {
  if (!existsSync(DIR())) return [];
  return readdirSync(DIR())
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadPersona(f.replace(/\.json$/, "")))
    .filter((p): p is PersonaSummary => !!p)
    .map(({ id, name, note, birthDate, province }) => ({ id, name, note, birthDate, province }));
}

export function loadPersona(id: string): PersonaSummary | null {
  if (!SAFE_ID.test(id)) return null;
  const file = path.join(DIR(), `${id}.json`);
  if (!existsSync(file)) return null;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const res: Resource[] = (bundle.entry ?? []).map((e: any) => e.resource).filter(Boolean);
  const patient = res.find((r) => r.resourceType === "Patient");
  if (!patient) return null;
  const name = patient.name?.[0];
  const byDateDesc = (k: string) => (a: Resource, b: Resource) => String(b[k] ?? "").localeCompare(String(a[k] ?? ""));

  return {
    id,
    name: stripName([...(name?.given ?? []), name?.family].filter(Boolean).join(" ")),
    birthDate: patient.birthDate ?? "",
    gender: patient.gender ?? "",
    city: patient.address?.[0]?.city ?? "",
    province: patient.address?.[0]?.state ?? "",
    note: patient.meta?.tag?.[0]?.display ?? "",
    allergies: res
      .filter((r) => r.resourceType === "AllergyIntolerance" && isActive(r))
      .map((r) => ({ text: cc(r.code), reaction: r.reaction?.[0]?.manifestation?.map(cc).join(", ") })),
    medications: res
      .filter((r) => r.resourceType === "MedicationRequest" && r.status === "active")
      .map((r) => ({ text: cc(r.medicationCodeableConcept), dosage: r.dosageInstruction?.[0]?.text, since: r.authoredOn?.slice(0, 10) })),
    problems: res
      .filter((r) => r.resourceType === "Condition" && isActive(r) && !r.abatementDateTime)
      .map((r) => ({ text: cc(r.code), since: r.onsetDateTime?.slice(0, 10) })),
    immunizations: res
      .filter((r) => r.resourceType === "Immunization")
      .sort(byDateDesc("occurrenceDateTime"))
      .slice(0, 6)
      .map((r) => ({ text: cc(r.vaccineCode), date: r.occurrenceDateTime?.slice(0, 10) })),
    results: res
      .filter((r) => r.resourceType === "Observation" && r.category?.some((c: any) => c.coding?.some((x: any) => x.code === "laboratory")) && r.valueQuantity)
      .sort(byDateDesc("effectiveDateTime"))
      .slice(0, 6)
      .map((r) => {
        const v = r.valueQuantity.value;
        const rr = r.referenceRange?.[0];
        const flag = rr?.high && v > rr.high.value ? "high" : rr?.low && v < rr.low.value ? "low" : undefined;
        return { text: cc(r.code), value: `${v} ${r.valueQuantity.unit ?? ""}`.trim(), date: r.effectiveDateTime?.slice(0, 10), flag };
      }),
  };
}

/** Age in whole months (for the infant red-flag rule). */
export function ageInMonths(birthDate: string, now = new Date()): number | undefined {
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return undefined;
  let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) m -= 1;
  return Math.max(0, m);
}
