/**
 * The reading files (reading.js): reading/en.json is sound, every pattern in it compiles, and a translation's entries
 * are tried before the English ones.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { mergeReading } from "../scripts/reading.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));

/** Every "pattern" string anywhere in a section. */
function patterns(value, out = []) {
  if ( Array.isArray(value) ) value.forEach(v => patterns(v, out));
  else if ( value && typeof value === "object" ) {
    for ( const [k, v] of Object.entries(value) ) {
      if ( k === "pattern" && typeof v === "string" ) out.push(v);
      else patterns(v, out);
    }
  }
  return out;
}

describe("reading/en.json", () => {
  test("its sections, and every pattern compiles", () => {
    expect(Array.isArray(english.triggers)).toBe(true);
    expect(Array.isArray(english.requirements)).toBe(true);
    for ( const p of patterns(english) ) expect(() => new RegExp(p, "i"), p).not.toThrow();
  });
});

describe("mergeReading", () => {
  test("a list: the translation's first, then the English; an object: the English with the translation's on top", () => {
    const merged = mergeReading({ triggers: [{ id: "en" }], words: { a: 1, b: 2 }, $comment: "x" }, { triggers: [{ id: "de" }], words: { b: 3 } });
    expect(merged.triggers.map(e => e.id)).toEqual(["de", "en"]);
    expect(merged.words).toEqual({ a: 1, b: 3 });
    expect(merged.$comment).toBeUndefined();
  });

  test("nothing read: nothing to read by", () => {
    expect(mergeReading()).toEqual({});
    expect(mergeReading({ triggers: [] }).triggers).toEqual([]);
  });
});
