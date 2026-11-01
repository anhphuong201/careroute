/**
 * symptom_guide – looks up HealthLink BC's public symptom guide (B.C. Ministry of Health,
 * content by Healthwise) and returns the "Check your symptoms" questions: the extra
 * symptoms that change what kind of care is needed. Used to build "if you also have …"
 * alternatives with a real source. Educational content valid for any province.
 *
 * Network: https://www.healthlinkbc.ca (search + topic page). Results cached in memory.
 */

const BASE = "https://www.healthlinkbc.ca";
const cache = new Map<string, SymptomGuide | null>();

export interface SymptomGuide {
  found: true;
  title: string;
  url: string;
  /** Questions from the guide, e.g. "Do you have other symptoms, such as a fever, shaking chills, or vomiting?" */
  questions: string[];
  /** The guide's possible outcomes, e.g. "Seek Care Today", "Try Home Treatment". */
  outcomes: string[];
}

function htmlToLines(html: string): string[] {
  const t = html
    .replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|li|h[1-6]|div|a|label|legend|button)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"');
  return t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Pure parser (tested): pull the triage questions and outcomes out of a Healthwise topic page. */
export function parseGuide(html: string): { title: string; questions: string[]; outcomes: string[] } {
  const title = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const lines = htmlToLines(html);
  const start = lines.findIndex((l, i) => l === "Check Your Symptoms" && lines[i + 1] !== "Self-Care" && /\?$/.test(lines[i + 1] ?? ""));
  const from = start >= 0 ? start + 1 : lines.findIndex((l) => /\?$/.test(l));
  const end = lines.findIndex((l, i) => i > from && /^Many things can affect how your body responds/.test(l));
  const section = lines.slice(Math.max(0, from), end > 0 ? end : from + 400);
  const questions = [...new Set(section.filter((l) => /\?$/.test(l) && l.length > 12 && !/^Why do we ask/.test(l) && !/^Are you (male|female)/i.test(l) && !/^How old are you/i.test(l)))].slice(0, 40);
  const outcomes = [...new Set(lines.filter((l) => /^(Call 911 Now|Seek Care Now|Seek Care Today|Make an Appointment|Call Your Doctor|Try Home Treatment)$/i.test(l)))];
  return { title, questions, outcomes };
}

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "CareRoute/0.1 (prototype)" }, signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function symptomGuide(query: string, ageGroup: "infant" | "child" | "adult" = "adult"): Promise<SymptomGuide | { found: false }> {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (!q) return { found: false };
  const key = `${ageGroup}:${q}`;
  if (cache.has(key)) return cache.get(key) ?? { found: false };

  const search = await get(`${BASE}/search?kw=${encodeURIComponent(q)}`);
  const slugs = [...new Set([...(search ?? "").matchAll(/href="(\/healthwise\/[a-z0-9-]+)"/g)].map((m) => m[1]))]
    .filter((s) => s !== "/healthwise/check-your-symptoms")
    // Age-specific guides: keep the version that matches the person.
    .filter((s) => (ageGroup === "adult" ? !/(11-and-younger|younger-than-|baby|babies|infant|diaper|child)/.test(s) : !/12-and-older/.test(s)))
    .slice(0, 6);
  // Use the first result that is an interactive symptom guide (has triage outcomes) and is about
  // the query: one of its words (first 5 letters, so "urinating" ~ "urinary") is in the title or slug.
  const stems = q.split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const relevant = (title: string, slug: string) => {
    const hay = `${title} ${slug}`.toLowerCase();
    return stems.length === 0 || stems.some((st) => hay.includes(st));
  };
  for (const slug of slugs) {
    const page = await get(BASE + slug);
    if (!page) continue;
    const g = parseGuide(page);
    if (g.outcomes.length && g.questions.length >= 3 && relevant(g.title, slug)) {
      const result: SymptomGuide = { found: true, title: g.title || slug, url: BASE + slug, questions: g.questions, outcomes: g.outcomes };
      cache.set(key, result);
      return result;
    }
  }
  cache.set(key, null);
  return { found: false };
}
