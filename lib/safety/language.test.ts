import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

describe("detectLanguage (emergency screen, no AI)", () => {
  it.each([
    ["أعاني من ألم في الصدر", "ar"],
    ["ਮੇਰੀ ਛਾਤੀ ਵਿੱਚ ਦਰਦ ਹੈ", "pa"],
    ["我胸口痛", "zh"],
    ["我胸口很痛，這樣正常嗎", "zh-hant"],
    ["Tôi bị đau ngực", "vi"],
    ["I have chest pain", "en"],
    ["J'ai mal à la poitrine", "fr"],
    ["Tengo dolor de pecho", "es"],
    ["May sakit ako sa dibdib", "tl"],
  ])("%s → %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
  it("returns null when unsure", () => {
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("xyz qwerty")).toBeNull();
  });
});
