import { describe, expect, it } from "vitest";
import { flattenMessages } from "./flatten";
import { en } from "./messages/en";
import { PACKS } from "./packs";
import { UI_LANGS, isHandwritten } from "./uiLangs";

const machineLangs = UI_LANGS.filter((code) => !isHandwritten(code));
const enFlat = flattenMessages(en);
const placeholders = (value: string) =>
  [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join(",");

describe("UI packs", () => {
  it("ships a pack for every picker language", () => {
    for (const code of machineLangs) {
      expect(PACKS[code], code).toBeTypeOf("function");
    }
  });

  it("covers every English key and keeps placeholders", async () => {
    const keys = Object.keys(enFlat).sort();
    for (const code of machineLangs) {
      const pack = await PACKS[code]!();
      expect(Object.keys(pack).sort(), code).toEqual(keys);
      for (const key of keys) {
        const source = enFlat[key]!;
        const value = pack[key] ?? "";
        // A few strings are intentionally empty in `en`; the rest must be translated.
        expect(value.trim() === "" && source.trim() !== "", `${code}:${key}`).toBe(false);
        expect(placeholders(value), `${code}:${key}`).toBe(placeholders(source));
      }
    }
  });
});
