/**
 * check_red_flags — HARD-CODED SAFETY RULES. NOT AI.
 *
 * This runs before any LLM call. If it returns `triggered: true`, the app must
 * stop the care-navigation flow and show the emergency screen (911 / 988 / 811).
 * ER wait times must NEVER be shown when this triggers.
 *
 * Design choices (deliberately conservative):
 *  - Over-triggering is acceptable; missing an emergency is not.
 *  - Negation is NOT handled: "no chest pain" still triggers. The user can go
 *    back and rephrase, but the app never talks itself out of an emergency.
 *  - Keyword coverage: English, French, Spanish, Chinese (simplified +
 *    traditional), Vietnamese, Punjabi (Gurmukhi), Tagalog, Arabic. Keyword
 *    lists are a safety net, not a guarantee; the UI also shows a
 *    language-independent yes/no checklist (`checklist` input), and the agent
 *    re-runs this function on its English translation of the message.
 *    Results can only ADD red flags, never remove them.
 *  - This function never names a condition to the user; categories are
 *    internal codes, and the UI shows plain-language instructions only.
 */

export type RedFlagCategory =
  | "chest_pain"
  | "breathing"
  | "stroke_signs"
  | "severe_bleeding"
  | "suicidal_thoughts"
  | "infant_fever";

export type RedFlagAction = "call_911" | "call_911_or_988" | "call_811";

export interface RedFlagInput {
  /** Free text in any language. */
  text?: string;
  /** Answers from the language-independent checklist screen. */
  checklist?: Partial<Record<RedFlagCategory, boolean>>;
  /** Age of the person who needs care, in months (from the household profile). */
  ageMonths?: number;
}

export interface RedFlagMatch {
  category: RedFlagCategory;
  /** "checklist", "age" or the text fragment that matched. */
  matched: string;
}

export type RedFlagResult =
  | { triggered: false; action: null; matches: [] }
  | { triggered: true; action: RedFlagAction; matches: RedFlagMatch[] };

/** Which action each category requires. */
export const CATEGORY_ACTION: Record<RedFlagCategory, RedFlagAction> = {
  chest_pain: "call_911",
  breathing: "call_911",
  stroke_signs: "call_911",
  severe_bleeding: "call_911",
  suicidal_thoughts: "call_911_or_988",
  infant_fever: "call_811",
};

/** Lower number = more urgent. */
const ACTION_PRIORITY: Record<RedFlagAction, number> = {
  call_911: 0,
  call_911_or_988: 1,
  call_811: 2,
};

/**
 * Patterns are tested against BOTH the NFC-lowercased text (keeps accents and
 * non-Latin vowel signs) and an accent-folded copy (so "difficulte a respirer"
 * matches "difficulté à respirer"). Write Latin-script patterns WITHOUT accents.
 */
const PATTERNS: Record<Exclude<RedFlagCategory, "infant_fever">, RegExp[]> = {
  chest_pain: [
    // en
    /\bchest\s*(pain|pains|tight|tightness|pressure|hurt|hurts|hurting|ache|aches|discomfort|squeez\w*)/,
    /\b(pain|pressure|tightness|squeezing|heaviness)\s+(in|on|across)\s+(my|his|her|their|the|our)\s+chest/,
    /\bheart\s*attack/,
    // fr
    /\bdouleurs?\s+(thoracique|a\s+la\s+poitrine|dans\s+la\s+poitrine)/,
    /\bmal\s+(a|dans)\s+la\s+poitrine/,
    /\b(oppression|serrement)\s+(thoracique|a\s+la\s+poitrine|dans\s+la\s+poitrine)/,
    /\bcrise\s+cardiaque/,
    // es
    /\bdolor\s+(de|en\s+el)\s+pecho/,
    /\bpresion\s+en\s+el\s+pecho/,
    /\b(ataque\s+al\s+corazon|infarto)/,
    // zh
    /胸痛|胸口[痛疼]|胸[闷悶]|心[脏臟]病[发發]作/,
    // vi
    /đau\s*(thắt\s*)?ngực|tức\s*ngực|\bdau\s*(that\s*)?nguc\b|\btuc\s*nguc\b/,
    // pa
    /ਛਾਤੀ.{0,20}ਦਰਦ/,
    // tl
    /\bsakit\s+(sa|ng)\s+dibdib/,
    // ar
    /ألم\s*(في\s*)?الصدر/,
  ],
  breathing: [
    // en
    /\b(trouble|difficulty|difficult|hard|problems?)\s+(to\s+)?(breath|breathe|breathing)/,
    /\b(can'?t|cannot|can\s+not|unable\s+to|struggling\s+to|not\s+able\s+to)\s+(breath|breathe)/,
    /\bshort(ness)?\s+of\s+breath/,
    /\b(not|stopped)\s+breathing/,
    /\b(choking|gasping)/,
    /\b(lips?|face)\s+((is|are|turning|turned|going|look|looks)\s+){0,2}(blue|purple|grey|gray)/,
    // fr
    /\b(difficulte|mal|peine)\s+a\s+respirer/,
    /\b(peux|peut|pouvons)\s+pas\s+respirer|\bne\s+(peux|peut)\s+(plus\s+|pas\s+)respirer|\bne\s+respire\s+plus/,
    /\bessouffl\w*|\bs'etouffe|\betouff\w*/,
    // es
    /\bdificultad\s+para\s+respirar|\bno\s+(puedo|puede)\s+respirar|\bfalta\s+de\s+aire|\bse\s+(esta\s+)?ahoga/,
    // zh
    /呼吸困[难難]|喘不[过過]气|喘不[过過]氣|不能呼吸|无法呼吸|無法呼吸|透不[过過]气|透不[過过]氣/,
    // vi
    /khó\s*thở|không\s*thở\s*được|ngộp\s*thở|\bkho\s*tho\b|\bkhong\s*tho\s*duoc\b/,
    // pa
    /ਸਾਹ.{0,25}(ਤਕਲੀਫ|ਮੁਸ਼ਕਲ|ਮੁਸ਼ਕਿਲ|ਔਖ|ਨਹੀਂ)/,
    // tl
    /\bhirap\s+(huminga|sa\s+paghinga)|\bhindi\s+makahinga/,
    // ar
    /(ضيق|صعوبة)\s*(في\s*)?التنفس|لا\s*أستطيع\s*التنفس/,
  ],
  stroke_signs: [
    // en
    /\bstroke\b/,
    /\b(face|mouth|smile)\s+(is\s+)?(droop\w*|drooping|lopsided|uneven|sagging)/,
    /\bdroop\w*\s+(face|mouth|smile)/,
    /\bslurr\w*|\bspeech\s+(is\s+)?(slurred|garbled|jumbled)/,
    /\b(numb|numbness|weak|weakness|paraly\w*)\s+(on|in|down)\s+one\s+side/,
    /\bone\s+side\s+of\s+(my|his|her|their|the)\s+(face|body)/,
    /\b(can'?t|cannot|unable\s+to)\s+(lift|raise|move)\s+(my|his|her|their|one)\s+(arm|leg)/,
    // fr
    /\bavc\b|\baccident\s+vasculaire/,
    /\bvisage\s+(qui\s+)?(s'affaisse|affaisse|tombe|paralyse)|\bbouche\s+de\s+travers/,
    /\b(paralysie|faiblesse|engourdissement)\s+(d'un|d'une|du|sur\s+un)\s*(seul\s+)?cote/,
    /\b(trouble|troubles|difficulte)\s+(de\s+la\s+parole|a\s+parler)/,
    // es
    /\bderrame\s+cerebral|\baccidente\s+cerebrovascular|\bictus\b/,
    /\bcara\s+(caida|torcida)|\bboca\s+torcida|\barrastra\s+las\s+palabras/,
    // zh
    /中[风風]|[脑腦]卒中|口[齿齒]不清|半身(无力|無力|麻木)|[脸臉]歪|嘴歪/,
    // vi
    /đột\s*quỵ|tai\s*biến|méo\s*miệng|\bdot\s*quy\b|\btai\s*bien\b/,
    // pa
    /ਅਧਰੰਗ|ਸਟ੍ਰੋਕ/,
    // tl
    /\bna-?stroke|\bistrok/,
    // ar
    /سكتة\s*دماغية|جلطة\s*دماغية/,
  ],
  severe_bleeding: [
    // en
    /\b(severe|heavy|heavily|lots\s+of|a\s+lot\s+of|uncontroll\w*|spurting|gushing|pouring)\s+.{0,20}bleed/,
    /\b(severe|heavy|heavily|uncontroll\w*)\s+(blood|bleed)/,
    /\bbleed\w*\s+.{0,25}(won'?t|wont|can'?t|cannot|doesn'?t|does\s+not|not|isn'?t|is\s+not)\s+(stop|stopping)/,
    /\bblood\s+(is\s+)?(everywhere|spurting|gushing|pouring)/,
    /\b(coughing|vomiting|throwing)\s+(up\s+)?blood/,
    // fr
    /\bsaignement\w*\s+(abondant|important|grave|qui\s+ne\s+s'arrete\s+pas)/,
    /\bhemorragie|\bsaigne\s+(beaucoup|abondamment|enormement)/,
    /\b(vomit|vomis|vomir|crache|cracher)\w*\s+du\s+sang/,
    // es
    /\bsangrado\s+(abundante|fuerte|grave|que\s+no\s+para)|\bhemorragia|\bno\s+(para|deja)\s+de\s+sangrar|\bsangra\s+mucho/,
    /\b(vomit|tos)\w*\s+(con\s+)?sangre/,
    // zh
    /大出血|出血不止|血流不止|流血不止|吐血|咳血/,
    // vi
    /chảy\s*máu\s*(nhiều|không\s*(cầm|ngừng|dừng))|\bchay\s*mau\s*(nhieu|khong\s*(cam|ngung|dung))\b|nôn\s*ra\s*máu|ho\s*ra\s*máu/,
    // pa
    /(ਬਹੁਤ|ਜ਼ਿਆਦਾ|ਜਿਆਦਾ).{0,15}ਖੂਨ|ਖੂਨ.{0,20}(ਨਹੀਂ\s*ਰੁਕ|ਬੰਦ\s*ਨਹੀਂ)/,
    // tl
    /\b(maraming|malakas\s+na)\s+(dugo|pagdurugo)|\bhindi\s+tumitigil\s+ang\s+(dugo|pagdurugo)/,
    // ar
    /نزيف\s*(شديد|حاد|لا\s*يتوقف)/,
  ],
  suicidal_thoughts: [
    // en (also catches "suicide", "suicidal")
    /\bsuicid\w*/,
    /\bkill(ing)?\s+(myself|himself|herself|themselves|themself)/,
    /\bend(ing)?\s+(my|his|her|their)\s+(own\s+)?life/,
    /\b(want|wanna|wants|going|planning)\s+(to\s+)?die\b/,
    /\b(don'?t|doesn'?t|do\s+not|does\s+not)\s+want\s+to\s+(live|be\s+alive|be\s+here\s+anymore)/,
    /\bself[-\s]?harm\w*|\b(hurt|hurting|harm|harming|cut|cutting)\s+(myself|himself|herself|themselves)/,
    /\bno\s+reason\s+to\s+live|\bbetter\s+off\s+dead/,
    // fr
    /\b(me|se)\s+tuer\b|\bmettre\s+fin\s+a\s+(mes|ses)\s+jours|\ben\s+finir\s+avec\s+la\s+vie|\benvie\s+de\s+mourir|\bveux\s+mourir/,
    // es
    /\bmatarme|\bquitarme\s+la\s+vida|\bquiero\s+morir(me)?|\bno\s+quiero\s+vivir/,
    // zh
    /自[杀殺]|想死|不想活|[轻輕]生|自[残殘]|[结結]束(自己的)?生命/,
    // vi (diacritics required: "tu tu" without accents also means "slowly")
    /tự\s*tử|tự\s*sát|muốn\s*chết|không\s*muốn\s*sống|tự\s*làm\s*hại/,
    // pa
    /ਖੁਦਕੁਸ਼ੀ|ਖ਼ੁਦਕੁਸ਼ੀ|ਆਤਮਹੱਤਿਆ|ਮਰਨਾ\s*ਚਾਹ/,
    // tl
    /\bmagpakamatay|\bpatayin\s+ang\s+(sarili|aking\s+sarili)|\bgusto\s+ko\s+(nang\s+|na\s+)?mamatay/,
    // ar
    /انتحار|أقتل\s*نفسي|أريد\s*أن\s*أموت/,
  ],
};

/** Fever words, used only together with age < 3 months. */
const FEVER_PATTERNS: RegExp[] = [
  /\b(fever|feverish|high\s+temp\w*|temperature)\b/,
  /\bfievre|\bfiebre|\bcalentura/,
  /[发發]([烧燒]|[热熱])|高[烧燒]/,
  /\bsốt\b|\bsot\b/,
  /ਬੁਖਾਰ|ਬੁਖ਼ਾਰ/,
  /\blagnat\b|\bnilalagnat/,
  /حمى|حرارة/,
];

const INFANT_FEVER_MAX_MONTHS = 3;

function normalize(text: string): { nfc: string; folded: string } {
  const nfc = text.normalize("NFC").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
  const folded = nfc
    .replace(/đ/g, "d")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
  return { nfc, folded };
}

function firstMatch(patterns: RegExp[], texts: string[]): string | null {
  for (const re of patterns) {
    for (const t of texts) {
      const m = t.match(re);
      if (m) return m[0];
    }
  }
  return null;
}

/** True if the text mentions fever in any supported language (used to require a temperature for under-18s). */
export function mentionsFever(text: string): boolean {
  const { nfc, folded } = normalize(text ?? "");
  return !!nfc && firstMatch(FEVER_PATTERNS, [nfc, folded]) !== null;
}

export function checkRedFlags(input: RedFlagInput): RedFlagResult {
  const matches: RedFlagMatch[] = [];
  const { nfc, folded } = normalize(input.text ?? "");
  const texts = [nfc, folded];

  for (const category of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
    if (input.checklist?.[category]) {
      matches.push({ category, matched: "checklist" });
      continue;
    }
    const hit = nfc ? firstMatch(PATTERNS[category], texts) : null;
    if (hit) matches.push({ category, matched: hit });
  }

  const isYoungInfant =
    typeof input.ageMonths === "number" && input.ageMonths >= 0 && input.ageMonths < INFANT_FEVER_MAX_MONTHS;
  if (input.checklist?.infant_fever) {
    matches.push({ category: "infant_fever", matched: "checklist" });
  } else if (isYoungInfant) {
    const hit = nfc ? firstMatch(FEVER_PATTERNS, texts) : null;
    if (hit) matches.push({ category: "infant_fever", matched: `age<${INFANT_FEVER_MAX_MONTHS}m + ${hit}` });
  }

  if (matches.length === 0) return { triggered: false, action: null, matches: [] };

  const action = matches
    .map((m) => CATEGORY_ACTION[m.category])
    .sort((a, b) => ACTION_PRIORITY[a] - ACTION_PRIORITY[b])[0];
  return { triggered: true, action, matches };
}
