/**
 * The review ledger (review/ledger.json, tools/review.mjs), offline: every PF2e slug the scripts name has an entry, so
 * a new special case can't land unrecorded. No packs needed: a name counts as a slug when it has a hyphen (quoted), or
 * when the snapshot lists it as one of PF2e's (review/snapshot.json: its creature abilities, character options,
 * glossary entries, spells, conditions, classes, ancestries, heritages and backgrounds). A run of tools/review.mjs
 * with PF2e's packs checks the rest (a single word only another kind of item has).
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NO_FIGHT_EFFECT, PLAYED_ELSEWHERE, GLOSSARY_SLUGS } from "../scripts/glossary.js";
import { CONDITION_ITEMS, GLOSSARY_AURAS } from "../scripts/auras.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ledger = JSON.parse(readFileSync(join(REPO, "review", "ledger.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(REPO, "review", "snapshot.json"), "utf8"));
// (The core's shared review pieces, beside its scripts: the same core the tests run against.)
const core = process.env.FASTFIGHTING_CORE ?? join(REPO, "..", "FastFighting", "scripts");
const { namesIn } = await import(pathToFileURL(join(core, "..", "tools", "review", "index.mjs")).href);
const scripts = readdirSync(join(REPO, "scripts")).filter(f => f.endsWith(".js")).sort().map(f => readFileSync(join(REPO, "scripts", f), "utf8")).join("\n");

const entries = ledger.entries ?? {};
const known = new Set([...Object.keys(entries), ...(ledger.notSlugs ?? []), ...Object.keys(ledger.ignore ?? {})]);
const vocabulary = new Set([...Object.keys(snapshot.generic ?? {}), ...Object.keys(snapshot.others ?? {})]);

describe("the review ledger", () => {
  test("every slug the scripts name has a ledger entry", () => {
    const { hyphenated, words, keys } = namesIn(scripts);
    const missing = [...new Set([...hyphenated, ...[...words, ...keys].filter(w => vocabulary.has(w))])].filter(n => !known.has(n)).sort();
    const how = "A PF2e slug the code handles: add its entry (node tools/review.mjs --accept <slug> --note \"what's special, and where\"). "
      + "Only a name that looks like one: add it to review/ledger.json's notSlugs (not PF2e's) or ignore (PF2e's, but the code means something else).";
    expect(missing, `Named in scripts/ with no review ledger entry: ${missing.join(", ")}. ${how}`).toEqual([]);
  });

  test("each entry says how, what's special, and when it was reviewed against which PF2e", () => {
    const bad = Object.entries(entries).filter(([, e]) => !["special", "no-fight", "elsewhere"].includes(e.how) || !String(e.note ?? "").trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(e.reviewed ?? "") || !/^\d+(?:\.\d+)+$/.test(e.system ?? "") || !("rules" in e) || !("text" in e)).map(([slug]) => slug);
    expect(bad).toEqual([]);
    expect(ledger.checked).toMatch(/^\d+(?:\.\d+)+$/);
  });

  test("its how agrees with glossary.js, and the standard abilities and auras are in it", () => {
    for ( const slug of NO_FIGHT_EFFECT ) expect(entries[slug]?.how, slug).toBe("no-fight");
    for ( const slug of PLAYED_ELSEWHERE ) expect(entries[slug]?.how, slug).toBe("elsewhere");
    for ( const slug of [...GLOSSARY_SLUGS, ...Object.keys(GLOSSARY_AURAS)] ) expect(entries[slug]?.how, slug).toBe("special");
    const wrong = Object.entries(entries).filter(([slug, e]) => (e.how === "no-fight") !== NO_FIGHT_EFFECT.has(slug) || (e.how === "elsewhere") !== PLAYED_ELSEWHERE.has(slug));
    expect(wrong.map(([slug]) => slug)).toEqual([]);
  });

  test("the conditions auras.js knows by their items' ids are in it", () => {
    expect(Object.values(CONDITION_ITEMS).filter(slug => !entries[slug])).toEqual([]);
  });

  test("only slugs, fingerprints and our own notes: no PF2e text", () => {
    for ( const e of Object.values(entries) ) {
      for ( const k of ["rules", "text"] ) expect(e[k] === null || /^[0-9a-f]{12}$/.test(e[k])).toBe(true);
      expect(e.note.length).toBeLessThan(400);
      expect(e.note).not.toMatch(/<\/?(?:p|strong|em|hr|span|a|ul|ol|li|h\d)\b[^>]*>|@(?:UUID|Check|Damage|Localize|Template)\[/);
    }
    for ( const g of Object.values(snapshot.generic ?? {}) ) expect(Object.keys(g).sort()).toEqual(["built", "count"]);
  });
});
