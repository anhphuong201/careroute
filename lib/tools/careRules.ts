/** search_care_rules – reads /rules/<province>/*.md (front-matter + Markdown body). */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PROVINCES, type ProvinceCode } from "../provinces";
import type { CareRoute } from "../types";
import { isFactId, type FactId } from "../facts";

export type NeedType = "prescription_renewal" | "lab_followup" | "minor_symptom" | "find_doctor" | "other";

export interface CareRule {
  id: string;
  province: ProvinceCode;
  route: CareRoute;
  needs: NeedType[];
  title: string;
  source_url: string;
  sources: { title: string; url: string }[];
  status: string;
  /** Facts that can change whether this route fits (optional `required_facts` in front-matter). */
  required_facts: FactId[];
  body: string;
}

const parseList = (v: string) => v.replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);

/** Tiny parser for the front-matter shape used in /rules (not a general YAML parser). */
export function parseRule(text: string): CareRule {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("rule file has no front-matter");
  const [, fm, body] = m;
  const get = (k: string) => new RegExp(`^${k}:\\s*(.*?)\\s*(#.*)?$`, "m").exec(fm)?.[1] ?? "";
  const sources: { title: string; url: string }[] = [];
  const re = /- title:\s*"([^"]*)"\s*\n\s*url:\s*(\S+)/g;
  for (let s; (s = re.exec(fm)); ) sources.push({ title: s[1], url: s[2] });
  const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? get("id");
  return {
    id: get("id"),
    province: get("province") as ProvinceCode,
    route: get("route") as CareRoute,
    needs: parseList(get("needs")) as NeedType[],
    title,
    source_url: get("source_url"),
    sources: sources.length ? sources : [{ title, url: get("source_url") }],
    status: get("status"),
    required_facts: parseList(get("required_facts")).map((f) => {
      if (!isFactId(f)) throw new Error(`unknown fact id in required_facts: ${f}`);
      return f;
    }),
    body: body.replace(/^#\s+.+\n/m, "").trim(),
  };
}

const cache = new Map<ProvinceCode, CareRule[]>();

export function loadRules(province: ProvinceCode): CareRule[] {
  const hit = cache.get(province);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "rules", PROVINCES[province].dir);
  const rules = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseRule(readFileSync(path.join(dir, f), "utf8")));
  cache.set(province, rules);
  return rules;
}

export function getRule(province: ProvinceCode, id: string): CareRule | undefined {
  return loadRules(province).find((r) => r.id === id);
}

export interface SearchCareRulesInput {
  province: ProvinceCode;
  need_type: NeedType;
  need_summary_en: string;
  age_group: "infant" | "child" | "adult";
  has_family_doctor: "yes" | "no" | "hard_to_access";
}

/**
 * Returns the rules relevant to the need. The province has only a handful of
 * rules, so we return all matching ones (not top-k) and let the model choose
 * with the full text in front of it.
 */
export function searchCareRules(input: SearchCareRulesInput) {
  const rules = loadRules(input.province);
  const relevant = rules.filter(
    (r) =>
      r.needs.includes(input.need_type) ||
      (r.route === "registry" && input.has_family_doctor !== "yes") ||
      (r.route === "family_doctor" && input.has_family_doctor !== "no") ||
      input.need_type === "other",
  );
  return {
    province: input.province,
    rules: relevant.map((r) => ({
      rule_id: r.id,
      route: r.route,
      title: r.title,
      source_url: r.source_url,
      required_facts: r.required_facts,
      text: r.body,
    })),
  };
}
