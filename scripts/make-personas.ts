/**
 * Writes demo personas to /data/personas as FHIR R4 Bundles in the same shape
 * Synthea exports (Patient, Condition, MedicationRequest, AllergyIntolerance,
 * Immunization, Observation). Hand-authored + synthetic: no real people.
 * Replace with real Synthea output any time – build_summary reads both.
 *
 * Run: npx tsx scripts/make-personas.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Res = Record<string, unknown> & { resourceType: string; id: string };

interface PersonaSpec {
  id: string;
  given: string;
  family: string;
  gender: "female" | "male";
  birthDate: string;
  city: string;
  province: "AB" | "BC";
  language: { code: string; display: string };
  demoNote: string;
  conditions?: { snomed: string; text: string; onset: string }[];
  meds?: { rxnorm?: string; text: string; dosage: string; authored: string }[];
  allergies?: { snomed?: string; text: string; reaction?: string }[];
  immunizations?: { cvx: string; text: string; date: string }[];
  labs?: { loinc: string; text: string; value: number; unit: string; date: string; low?: number; high?: number }[];
}

const SNOMED = "http://snomed.info/sct";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";
const LOINC = "http://loinc.org";
const CVX = "http://hl7.org/fhir/sid/cvx";

function bundle(p: PersonaSpec) {
  const ref = { reference: `urn:uuid:${p.id}` };
  const res: Res[] = [];
  res.push({
    resourceType: "Patient",
    id: p.id,
    meta: { tag: [{ system: "https://careroute.example/tags", code: "synthetic", display: p.demoNote }] },
    name: [{ use: "official", given: [p.given], family: p.family }],
    gender: p.gender,
    birthDate: p.birthDate,
    address: [{ city: p.city, state: p.province, country: "CA" }],
    communication: [{ language: { coding: [{ system: "urn:ietf:bcp:47", code: p.language.code, display: p.language.display }] } }],
  });
  p.conditions?.forEach((c, i) =>
    res.push({
      resourceType: "Condition",
      id: `${p.id}-cond-${i}`,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      code: { coding: [{ system: SNOMED, code: c.snomed, display: c.text }], text: c.text },
      subject: ref,
      onsetDateTime: c.onset,
    }),
  );
  p.meds?.forEach((m, i) =>
    res.push({
      resourceType: "MedicationRequest",
      id: `${p.id}-med-${i}`,
      status: "active",
      intent: "order",
      medicationCodeableConcept: { ...(m.rxnorm ? { coding: [{ system: RXNORM, code: m.rxnorm, display: m.text }] } : {}), text: m.text },
      subject: ref,
      authoredOn: m.authored,
      dosageInstruction: [{ text: m.dosage }],
    }),
  );
  p.allergies?.forEach((a, i) =>
    res.push({
      resourceType: "AllergyIntolerance",
      id: `${p.id}-alg-${i}`,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      code: { ...(a.snomed ? { coding: [{ system: SNOMED, code: a.snomed, display: a.text }] } : {}), text: a.text },
      patient: ref,
      ...(a.reaction ? { reaction: [{ manifestation: [{ text: a.reaction }] }] } : {}),
    }),
  );
  p.immunizations?.forEach((im, i) =>
    res.push({
      resourceType: "Immunization",
      id: `${p.id}-imm-${i}`,
      status: "completed",
      vaccineCode: { coding: [{ system: CVX, code: im.cvx, display: im.text }], text: im.text },
      patient: ref,
      occurrenceDateTime: im.date,
    }),
  );
  p.labs?.forEach((l, i) =>
    res.push({
      resourceType: "Observation",
      id: `${p.id}-obs-${i}`,
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
      code: { coding: [{ system: LOINC, code: l.loinc, display: l.text }], text: l.text },
      subject: ref,
      effectiveDateTime: l.date,
      valueQuantity: { value: l.value, unit: l.unit },
      ...(l.low !== undefined || l.high !== undefined
        ? { referenceRange: [{ ...(l.low !== undefined ? { low: { value: l.low, unit: l.unit } } : {}), ...(l.high !== undefined ? { high: { value: l.high, unit: l.unit } } : {}) }] }
        : {}),
    }),
  );
  return {
    resourceType: "Bundle",
    type: "collection",
    meta: { tag: [{ code: "synthetic", display: "Synthea-format demo record – not a real person" }] },
    entry: res.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
  };
}

export const PERSONAS: PersonaSpec[] = [
  {
    id: "amira-haddad",
    given: "Amira742",
    family: "Haddad103",
    gender: "female",
    birthDate: "1993-04-12",
    city: "Calgary",
    province: "AB",
    language: { code: "ar", display: "Arabic" },
    demoNote: "Newcomer, no family doctor, prescription runs out in 2 days",
    conditions: [{ snomed: "40930008", text: "Hypothyroidism", onset: "2019-06-03" }],
    meds: [{ text: "Levothyroxine 50 mcg oral tablet", dosage: "1 tablet by mouth every morning", authored: "2025-09-20" }],
    allergies: [{ snomed: "91936005", text: "Penicillin", reaction: "Hives" }],
    immunizations: [
      { cvx: "140", text: "Influenza, seasonal, injectable, preservative free", date: "2025-10-15" },
      { cvx: "115", text: "Tdap", date: "2021-02-10" },
    ],
    labs: [{ loinc: "3016-3", text: "Thyrotropin (TSH) [Units/volume] in Serum or Plasma", value: 2.1, unit: "mIU/L", date: "2025-09-12", low: 0.3, high: 4.2 }],
  },
  {
    id: "lily-haddad",
    given: "Lily58",
    family: "Haddad103",
    gender: "female",
    birthDate: "2019-01-22",
    city: "Calgary",
    province: "AB",
    language: { code: "ar", display: "Arabic" },
    demoNote: "Child in Amira's household",
    conditions: [{ snomed: "195967001", text: "Asthma", onset: "2023-03-01" }],
    meds: [{ rxnorm: "745679", text: "Salbutamol (albuterol) 100 mcg/actuation inhaler", dosage: "2 puffs as needed for wheeze", authored: "2026-02-01" }],
    immunizations: [
      { cvx: "94", text: "MMRV", date: "2023-01-30" },
      { cvx: "20", text: "DTaP", date: "2023-01-30" },
    ],
  },
  {
    id: "noah-haddad",
    given: "Noah301",
    family: "Haddad103",
    gender: "male",
    birthDate: "2026-08-25",
    city: "Calgary",
    province: "AB",
    language: { code: "ar", display: "Arabic" },
    demoNote: "Infant (about 2 months) in Amira's household",
    immunizations: [{ cvx: "08", text: "Hep B, adolescent or pediatric", date: "2026-08-26" }],
  },
  {
    id: "david-tremblay",
    given: "David88",
    family: "Tremblay447",
    gender: "male",
    birthDate: "1968-11-02",
    city: "Edmonton",
    province: "AB",
    language: { code: "fr", display: "French" },
    demoNote: "Has a family doctor who is hard to reach; lab result follow-up",
    conditions: [{ snomed: "44054006", text: "Diabetes mellitus type 2", onset: "2021-05-17" }],
    meds: [{ rxnorm: "860975", text: "Metformin 500 mg extended-release oral tablet", dosage: "1 tablet by mouth with supper", authored: "2026-04-10" }],
    labs: [
      { loinc: "4548-4", text: "Hemoglobin A1c/Hemoglobin.total in Blood", value: 7.4, unit: "%", date: "2026-10-20", high: 7.0 },
      { loinc: "2093-3", text: "Cholesterol [Mass/volume] in Serum or Plasma", value: 5.6, unit: "mmol/L", date: "2026-10-20", high: 5.2 },
    ],
    immunizations: [{ cvx: "140", text: "Influenza, seasonal, injectable, preservative free", date: "2025-10-28" }],
  },
  {
    id: "jun-chen",
    given: "Jun612",
    family: "Chen930",
    gender: "male",
    birthDate: "2001-07-30",
    city: "Vancouver",
    province: "BC",
    language: { code: "zh", display: "Chinese" },
    demoNote: "Young adult, no family doctor, minor new symptom",
    immunizations: [{ cvx: "140", text: "Influenza, seasonal, injectable, preservative free", date: "2025-11-02" }],
  },
];

async function main() {
  const dir = path.join(process.cwd(), "data", "personas");
  await mkdir(dir, { recursive: true });
  for (const p of PERSONAS) {
    await writeFile(path.join(dir, `${p.id}.json`), JSON.stringify(bundle(p), null, 2) + "\n");
  }
  console.log(`${PERSONAS.length} personas written`);
}

if (process.argv[1] && /make-personas/.test(process.argv[1])) main();
