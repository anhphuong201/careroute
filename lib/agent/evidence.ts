/**
 * Grounding check: the model must quote the guideline text that supports its route.
 * We accept the quote only if it really appears in the rule (allowing small differences
 * in punctuation or case). Otherwise the server does not trust the route.
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function evidenceSupported(evidence: string, ruleText: string): boolean {
  const e = norm(evidence);
  const r = norm(ruleText);
  if (e.length < 12) return false;
  if (r.includes(e)) return true;
  // Tolerate light paraphrase: ≥85% of the quote's words (3+ letters) must occur in the rule,
  // and the longest run of consecutive quote words found verbatim must be ≥ 4 words.
  const words = e.split(" ").filter((w) => w.length >= 3);
  if (words.length < 3) return false;
  const ruleWords = new Set(r.split(" "));
  const hit = words.filter((w) => ruleWords.has(w)).length / words.length;
  if (hit < 0.85) return false;
  const all = e.split(" ");
  let best = 0;
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j <= all.length; j++) {
      if (!r.includes(all.slice(i, j).join(" "))) break;
      best = Math.max(best, j - i);
    }
  return best >= 4;
}
