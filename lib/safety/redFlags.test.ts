import { describe, expect, it } from "vitest";
import { checkRedFlags, type RedFlagCategory } from "./redFlags";

function cats(text: string, ageMonths?: number): RedFlagCategory[] {
  return checkRedFlags({ text, ageMonths }).matches.map((m) => m.category);
}

describe("checkRedFlags – no red flags", () => {
  it.each([
    "I need a refill of my birth control pills",
    "My son has a mild rash on his arm for 2 days",
    "I have a sore throat and runny nose",
    "Need a form signed for work",
    "Tôi cần mua thuốc dị ứng", // vi: I need allergy medicine
    "Tôi đi từ từ thôi", // vi: "slowly" — must NOT match "tự tử"
    "J'ai besoin d'un renouvellement d'ordonnance",
    "我需要续药", // zh: I need a refill
    "",
  ])("does not trigger: %s", (text) => {
    const r = checkRedFlags({ text });
    expect(r.triggered).toBe(false);
    expect(r.action).toBeNull();
  });

  it("handles missing input", () => {
    expect(checkRedFlags({}).triggered).toBe(false);
  });
});

describe("checkRedFlags – chest pain → 911", () => {
  it.each([
    "I have chest pain",
    "my dad has CHEST PRESSURE and is sweating",
    "there is a squeezing pain in my chest",
    "I think I'm having a heart attack",
    "J'ai une douleur à la poitrine",
    "douleur thoracique depuis 1 heure",
    "Tengo dolor en el pecho",
    "我胸口痛",
    "胸悶很久了",
    "Tôi bị đau ngực",
    "toi bi dau that nguc", // vi without diacritics
    "ਮੇਰੀ ਛਾਤੀ ਵਿੱਚ ਦਰਦ ਹੈ",
    "May sakit sa dibdib ako",
    "عندي ألم في الصدر",
  ])("%s", (text) => {
    const r = checkRedFlags({ text });
    expect(r.triggered).toBe(true);
    expect(r.action).toBe("call_911");
    expect(cats(text)).toContain("chest_pain");
  });
});

describe("checkRedFlags – trouble breathing → 911", () => {
  it.each([
    "my baby is having trouble breathing",
    "I can't breathe",
    "I cant breathe properly",
    "shortness of breath when lying down",
    "his lips are turning blue",
    "she is choking",
    "J'ai de la difficulté à respirer",
    "Mon fils a du mal à respirer",
    "No puedo respirar",
    "呼吸困難",
    "con tôi khó thở",
    "Hirap huminga ang anak ko",
    "ضيق في التنفس",
  ])("%s", (text) => {
    expect(cats(text)).toContain("breathing");
    expect(checkRedFlags({ text }).action).toBe("call_911");
  });
});

describe("checkRedFlags – stroke signs → 911", () => {
  it.each([
    "I think my mom is having a stroke",
    "his face is drooping on one side",
    "her speech is slurred suddenly",
    "sudden weakness on one side of the body",
    "he can't lift his arm",
    "Je pense que c'est un AVC",
    "Creo que es un derrame cerebral",
    "我爸爸可能中風了",
    "bà tôi bị méo miệng",
    "có thể bị đột quỵ",
  ])("%s", (text) => {
    expect(cats(text)).toContain("stroke_signs");
    expect(checkRedFlags({ text }).action).toBe("call_911");
  });
});

describe("checkRedFlags – severe bleeding → 911", () => {
  it.each([
    "severe bleeding from a cut",
    "heavy bleeding that won't stop",
    "the bleeding will not stop",
    "he is vomiting blood",
    "blood is gushing from his leg",
    "hémorragie après une chute",
    "sangrado abundante",
    "流血不止",
    "chảy máu không cầm được",
    "نزيف شديد",
  ])("%s", (text) => {
    expect(cats(text)).toContain("severe_bleeding");
    expect(checkRedFlags({ text }).action).toBe("call_911");
  });

  it("does not trigger on minor bleeding", () => {
    expect(checkRedFlags({ text: "small paper cut, bled a little" }).triggered).toBe(false);
  });
});

describe("checkRedFlags – suicidal thoughts → 911 or 988", () => {
  it.each([
    "I have been having suicidal thoughts",
    "I want to kill myself",
    "I don't want to live anymore",
    "I want to die",
    "thinking about ending my life",
    "I've been hurting myself",
    "Je veux me tuer",
    "J'ai envie de mourir",
    "Quiero quitarme la vida",
    "我想自杀",
    "我不想活了",
    "Tôi muốn tự tử",
    "Gusto ko nang mamatay",
    "ਮੈਂ ਖੁਦਕੁਸ਼ੀ ਬਾਰੇ ਸੋਚ ਰਿਹਾ ਹਾਂ",
  ])("%s", (text) => {
    expect(cats(text)).toContain("suicidal_thoughts");
    expect(checkRedFlags({ text }).action).toBe("call_911_or_988");
  });

  it("smart quotes are normalised", () => {
    expect(cats("I don’t want to live")).toContain("suicidal_thoughts");
  });
});

describe("checkRedFlags – infant fever (<3 months) → 811", () => {
  it("triggers for a 6-week-old with fever", () => {
    const r = checkRedFlags({ text: "my baby has a fever", ageMonths: 1.5 });
    expect(r.triggered).toBe(true);
    expect(r.action).toBe("call_811");
    expect(r.matches[0].category).toBe("infant_fever");
  });

  it("works in other languages", () => {
    expect(cats("bé bị sốt", 1)).toContain("infant_fever");
    expect(cats("宝宝发烧了", 2)).toContain("infant_fever");
    expect(cats("mon bébé fait de la fièvre", 0)).toContain("infant_fever");
  });

  it("does not trigger for older children (handled by care rules instead)", () => {
    expect(checkRedFlags({ text: "my toddler has a fever", ageMonths: 24 }).triggered).toBe(false);
  });

  it("does not trigger when age is unknown", () => {
    expect(checkRedFlags({ text: "fever since yesterday" }).triggered).toBe(false);
  });
});

describe("checkRedFlags – checklist & priority", () => {
  it("checklist answers trigger even with no text (language-independent path)", () => {
    const r = checkRedFlags({ checklist: { breathing: true } });
    expect(r.triggered).toBe(true);
    expect(r.action).toBe("call_911");
    expect(r.matches).toEqual([{ category: "breathing", matched: "checklist" }]);
  });

  it("checklist false does not suppress a text match", () => {
    const r = checkRedFlags({ text: "chest pain", checklist: { chest_pain: false } });
    expect(r.triggered).toBe(true);
  });

  it("911 outranks 988 and 811 when several match", () => {
    const r = checkRedFlags({ text: "I want to die and I have chest pain", ageMonths: 1 });
    expect(r.action).toBe("call_911");
    expect(r.matches.map((m) => m.category).sort()).toEqual(["chest_pain", "suicidal_thoughts"]);
  });

  it("is conservative: negated mentions still trigger", () => {
    expect(checkRedFlags({ text: "rash, but no trouble breathing" }).triggered).toBe(true);
  });
});
