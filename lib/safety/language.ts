/**
 * Tiny, deterministic language guess (NOT AI) for the emergency screen, which appears before any model call.
 * Covers the languages of the red-flag keyword lists. Returns null when unsure – the UI language is used then.
 */
export type SafetyLang = "en" | "fr" | "es" | "zh" | "zh-hant" | "vi" | "pa" | "tl" | "ar";

/** Common traditional-only characters (their simplified forms differ). */
const TRADITIONAL = /[們這會說來時對點國學體麼還過嗎氣臟為與當發燒頭醫護請開車嚴難]/;
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

const WORDS: Record<"en" | "fr" | "es" | "tl", string[]> = {
  en: ["the", "i", "my", "and", "is", "have", "has", "pain", "can't", "he", "she", "with", "it", "in"],
  fr: ["je", "j'ai", "mon", "ma", "mes", "est", "pas", "une", "le", "la", "les", "avec", "et", "il", "elle", "douleur", "mal"],
  es: ["yo", "tengo", "mi", "el", "la", "los", "con", "y", "que", "dolor", "puedo", "no", "está", "esta", "pecho"],
  tl: ["ang", "ng", "sa", "ako", "ko", "may", "hindi", "siya", "na", "mga", "po", "sakit", "akin"],
};

export function detectLanguage(text: string): SafetyLang | null {
  const t = (text ?? "").normalize("NFC");
  if (!t.trim()) return null;
  if (/\p{Script=Arabic}/u.test(t)) return "ar";
  if (/\p{Script=Gurmukhi}/u.test(t)) return "pa";
  if (/\p{Script=Han}/u.test(t)) return TRADITIONAL.test(t) ? "zh-hant" : "zh";
  if (VIETNAMESE.test(t)) return "vi";
  const words = t.toLowerCase().replace(/[’‘`]/g, "'").match(/[\p{L}']+/gu) ?? [];
  let best: SafetyLang | null = null;
  let top = 0;
  let tie = false;
  for (const [lang, list] of Object.entries(WORDS) as [SafetyLang, string[]][]) {
    const score = words.filter((w) => list.includes(w)).length;
    if (score > top) [best, top, tie] = [lang, score, false];
    else if (score === top && score > 0) tie = true;
  }
  return top > 0 && !tie ? best : null;
}
