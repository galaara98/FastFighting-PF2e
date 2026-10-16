/**
 * Word lists in the language files (FFPF2E.Innate): what a spell's name says in brackets, read in the reader's
 * language and in English; the words themselves never in the code.
 */
import { describe, expect, test } from "vitest";
import { wordList } from "../scripts/words.js";

const fromFile = key => game.i18n.localize(`FFPF2E.${key}`).split(",").map(w => w.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);

describe("an innate spell's brackets", () => {
  test("at will and constant, as the language file has them, in lower case", () => {
    expect(wordList("Innate.AtWill")).toEqual(fromFile("Innate.AtWill"));
    expect(wordList("Innate.AtWill").length).toBeGreaterThan(1);
    expect(wordList("Innate.Constant")).toEqual(fromFile("Innate.Constant"));
  });
});
