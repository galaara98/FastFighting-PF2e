/**
 * The patterns reading/en.json reads PF2e's text by run on every action of every actor in the GM's browser, a player's
 * own character's too, whose text is theirs to write. Each must finish quickly whatever the text: a pattern that
 * backtracks without end (a quantified group whose own words can be split many ways, "(?:[\w'-]+ ?){1,6}") would hang
 * the GM's browser on one long word. And the readers run them only on as much text as real lines have (READ_MOST).
 */
import { beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { setReading } from "../scripts/reading.js";
import { readRequirement } from "../scripts/requirements.js";
import { classifyLine, READ_MOST } from "../scripts/trigger-lines.js";
import { readTrigger } from "../scripts/reactions-read.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
beforeEach(() => setReading(english));

/** Every pattern in the file, by where it is: each section's `pattern`s, and the "self" words' replacements. */
function patterns(reading) {
  const out = [];
  const walk = (v, path) => {
    if ( Array.isArray(v) ) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if ( v && typeof v === "object" ) for ( const [k, x] of Object.entries(v) ) walk(x, `${path}.${k}`);
    else if ( typeof v === "string" && path.endsWith(".pattern") ) out.push([path, v]);
  };
  walk(reading, "");
  for ( const [i, pair] of (reading.self?.replace ?? []).entries() ) out.push([`.self.replace[${i}]`, pair[0]]);
  return out;
}

/** The most a pattern may take on one text (ms), and the longest text tried. */
const LIMIT = 50;
const LONGEST = 3000;
const SIZES = [25, 50, 100, 200, 400, 800, 1600, LONGEST];

/** What leads up to the part of a line a pattern reads freely (a creature's name, at the end of a requirement or a trigger). */
const PREFIXES = ["", "you ", "a creature ", "an enemy ", "the ", "a creature is grabbed by ", "an off-guard creature is within reach of ",
  "an enemy is under a fear effect within 30 feet of ", "a creature within 30 feet of you ", "you are hit by a ", "a creature you can see "];

/** What a text is made of to slow a pattern down: one long word, runs of spaces, apostrophes and hyphens, words and commas. */
const UNITS = ["a", " ", "'", "’", "-", "a ", "a'", "a-", "you ", "a, ", "x or ", "the ", "a  ", "' ", "-a "];

const fill = (unit, size) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

/** The slowest of a pattern's runs over the adversarial texts ({ms, at}), growing each text until LIMIT or LONGEST. */
function slowest(source) {
  const once = new RegExp(source, "i");
  const all = new RegExp(source, "gi");
  // (Its own words over and over: what it looks for, never quite there.)
  const own = `${[...new Set(source.match(/[a-z]{2,}/gi) ?? [])].join(" ")} `;
  let worst = { ms: 0, at: "" };
  for ( const prefix of PREFIXES ) {
    for ( const unit of [...UNITS, own] ) {
      for ( const end of ["!", "", " ."] ) {
        for ( const size of SIZES ) {
          const text = `${prefix}${fill(unit, size)}${end}`;
          const t = performance.now();
          once.exec(text);
          for ( const m of text.matchAll(all) ) void m;
          const ms = performance.now() - t;
          if ( ms > worst.ms ) worst = { ms, at: `${JSON.stringify(prefix)} + ${JSON.stringify(unit.slice(0, 12))} x${size} + ${JSON.stringify(end)}` };
          // (Slow already: no longer text needed to say so, and none tried, which could take hours.)
          if ( ms > LIMIT ) return worst;
        }
      }
    }
  }
  return worst;
}

describe("reading/en.json's patterns", () => {
  test(`each finishes in under ${LIMIT} ms on ${LONGEST} characters made to slow it`, () => {
    const slow = [];
    for ( const [path, source] of patterns(english) ) {
      let worst = slowest(source);
      // (A pause of the test's own, the garbage collector's, once: tried again.)
      if ( worst.ms > LIMIT ) worst = slowest(source);
      if ( worst.ms > LIMIT ) slow.push(`${path}: ${worst.ms.toFixed(0)} ms on ${worst.at}`);
    }
    expect(slow).toEqual([]);
  }, 120000);

  test("none has a quantified group whose words can be split many ways", () => {
    // ("(?:[\w'-]+ ?){1,4}", "(\w+)*": a word and an optional separator, repeated; or a repeat of a repeat. A word
    // with a separator it must have, "(?: [\w-]+){0,3}" or "(?:[\w-]+ ){1,4}", splits only one way.)
    const ambiguous = /\((?:\?:|\?<\w+>)?(?:\[[^\]]+\]|\\[wsdS]|\.)[+*](?: \?|\\s[?*]| \*|,\?|-\?)?\)(?:\{\d+,?\d*\}|[*+])/;
    const bad = patterns(english).filter(([, source]) => ambiguous.test(source)).map(([path]) => path);
    expect(bad).toEqual([]);
    expect(ambiguous.test("(?:[\\w'’-]+ ?){1,4}$")).toBe(true);
    expect(ambiguous.test("(?:\\w+\\s?)+")).toBe(true);
    expect(ambiguous.test("(\\w+)*")).toBe(true);
    expect(ambiguous.test("[\\w'’-]+(?: [\\w'’-]+){0,3}$")).toBe(false);
    expect(ambiguous.test("^(?:[\\w'’-]+ ){1,4}?is prone$")).toBe(false);
    expect(ambiguous.test("[\\w-]+(?:, [\\w-]+)*")).toBe(false);
  });

  test("rewritten without the ambiguity, they still read the lines they read", () => {
    expect(readRequirement("a creature is grabbed by the giant crab")).toEqual({ holding: true });
    expect(readRequirement("an off-guard creature is within reach of the dragon")).toEqual({ target: ["offGuard"] });
    expect(readRequirement("an enemy is under a fear effect within 30 feet of the ghost")).toEqual({ target: ["frightened", "unconscious"] });
  });
});

describe("how much text is read", () => {
  test("a Requirements or a Trigger line longer than any real one isn't read", () => {
    const long = `a creature is grabbed by ${"giant ".repeat(60)}crab`;
    expect(long.length).toBeGreaterThan(READ_MOST.line);
    expect(readRequirement(long)).toBeNull();
    expect(readRequirement("a creature is grabbed by the giant crab")).toEqual({ holding: true });
    const trigger = `a creature within your reach uses a manipulate action${" or a move action".repeat(20)}`;
    expect(trigger.length).toBeGreaterThan(READ_MOST.line);
    expect(classifyLine(trigger, english.triggers)).toBeNull();
    expect(readTrigger(trigger, { reading: english })).toBeNull();
  });
});
