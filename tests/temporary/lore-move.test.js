/**
 * Temporary: the Lore-Collector's advantage was this module's own setting (fast-fighting-pf2e.loreBoost) up to 0.7.0;
 * the core's took its place (core API 28). A GM's login moves a value set on the old one to the core's. These tests
 * keep that working for the releases that carry it, and fail once this module reaches REMOVE_AT, so it doesn't live on
 * unnoticed. Then remove:
 *  - scripts/lore-move.js, and its import and call in scripts/main.js (the ready hook),
 *  - this file.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { moveLoreBoost } from "../../scripts/lore-move.js";

const ROOT = path.join(import.meta.dirname, "..", "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
/** The release this file, and the move, go with. */
const REMOVE_AT = "0.10.0";
const older = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split(".").map(n => Number(n) || 0));
  for ( let i = 0; i < 3; i++ ) if ( (x[i] ?? 0) !== (y[i] ?? 0) ) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

const was = globalThis.game;
afterEach(() => { globalThis.game = was; });

/** A world with these stored settings ({key: value}), the core's loreBoost registered or not; what got set. */
function world(stored, { isGM = true, core = true } = {}) {
  const set = [];
  globalThis.game = {
    user: { isGM },
    settings: {
      settings: new Map(core ? [["fast-fighting.loreBoost", {}]] : []),
      storage: new Map([["world", { getSetting: key => (key in stored ? { value: stored[key] } : undefined) }]]),
      set: (module, key, value) => set.push([module, key, value])
    }
  };
  return set;
}

describe("moving the old Lore-Collector advantage to the core's", () => {
  test(`is still here: remove it at ${REMOVE_AT}`, () => {
    expect(older(VERSION, REMOVE_AT)).toBe(true);
  });

  test("a GM's value on the old setting goes to the core's", () => {
    const set = world({ "fast-fighting-pf2e.loreBoost": 1.8 });
    moveLoreBoost();
    expect(set).toEqual([["fast-fighting", "loreBoost", 1.8]]);
  });

  test("nothing when the core's has its own, there's none to move, it's a player, or the core is older", () => {
    for ( const [stored, opts] of [
      [{ "fast-fighting-pf2e.loreBoost": 1.8, "fast-fighting.loreBoost": 2.4 }, {}],
      [{}, {}],
      [{ "fast-fighting-pf2e.loreBoost": 1.8 }, { isGM: false }],
      [{ "fast-fighting-pf2e.loreBoost": 1.8 }, { core: false }]
    ] ) {
      const set = world(stored, opts);
      moveLoreBoost();
      expect(set).toEqual([]);
    }
  });
});
