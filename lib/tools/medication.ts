/** lookup_medication – Health Canada Drug Product Database (DPD) API. Facts only, never advice. */

const BASE = "https://health-products.canada.ca/api/drug";
export const DPD_SOURCE = "https://health-products.canada.ca/dpd-bdpp/";

async function getJson<T>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (res.ok) return (await res.json()) as T;
    } catch {
      /* flaky upstream – retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

interface DpdProduct {
  drug_code: number;
  drug_identification_number: string;
  brand_name: string;
  company_name: string;
}
interface DpdSchedule {
  schedule_name: string;
}
interface DpdIngredient {
  ingredient_name: string;
  strength: string;
  strength_unit: string;
}

export async function lookupMedication(query: string) {
  const q = query.trim();
  if (!q) return { found: false, source_url: DPD_SOURCE };
  const isDin = /^\d{8}$/.test(q);
  const products =
    (await getJson<DpdProduct[]>(`${BASE}/drugproduct/?${isDin ? "din" : "brandname"}=${encodeURIComponent(q)}&lang=en&type=json`)) ?? null;
  if (products === null) return { found: false, error: "Drug database did not respond", source_url: DPD_SOURCE };
  const top = products.slice(0, 3);
  const detailed = await Promise.all(
    top.map(async (p) => {
      const [sched, ingr] = await Promise.all([
        getJson<DpdSchedule[]>(`${BASE}/schedule/?id=${p.drug_code}&lang=en&type=json`),
        getJson<DpdIngredient[]>(`${BASE}/activeingredient/?id=${p.drug_code}&lang=en&type=json`),
      ]);
      const schedules = (sched ?? []).map((s) => s.schedule_name);
      return {
        brand_name: p.brand_name,
        din: p.drug_identification_number,
        company: p.company_name,
        schedules,
        prescription_required: schedules.length ? schedules.some((s) => /prescription|narcotic|controlled|targeted|schedule g/i.test(s)) : null,
        active_ingredients: (ingr ?? []).map((i) => `${i.ingredient_name} ${i.strength}${i.strength_unit}`),
      };
    }),
  );
  return { found: products.length > 0, total_matches: products.length, products: detailed, source_url: DPD_SOURCE };
}
