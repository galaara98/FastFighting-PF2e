/**
 * PF2e's conditions as the engine's keys, both ways: every PF2e condition read as its key (and what it also means to
 * the engine), written back as the same condition; the engine's own (losing a turn to Command) kept by the core.
 */
import { afterEach, describe, expect, test } from "vitest";
import { engineKey, conditionSlug } from "../scripts/commit.js";
import { Pf2eAdapter } from "../scripts/adapter.js";

const before = { pf2e: globalThis.game?.pf2e, CONFIG: globalThis.CONFIG };
afterEach(() => {
  game.pf2e = before.pf2e;
  globalThis.CONFIG = before.CONFIG;
});

/** PF2e's condition list, as its ConditionManager and CONFIG.PF2E.conditionTypes have it. */
const SLUGS = ["blinded", "clumsy", "dazzled", "frightened", "grabbed", "immobilized", "off-guard", "persistent-damage", "prone", "restrained", "unconscious", "dying"];
const VALUED = new Set(["clumsy", "frightened", "dying"]);
function system() {
  game.pf2e = { ConditionManager: { getCondition: slug => (SLUGS.includes(slug) ? { system: { value: { isValued: VALUED.has(slug) } } } : null) } };
  globalThis.CONFIG = { PF2E: { conditionTypes: Object.fromEntries(SLUGS.map(s => [s, `PF2E.ConditionType.${s}`])) } };
}

describe("PF2e's conditions, both ways", () => {
  test("a slug and its key: the same condition each way", () => {
    system();
    for ( const slug of SLUGS ) expect(conditionSlug(engineKey(slug))).toBe(slug);
    expect(engineKey("off-guard")).toBe("offGuard");
    expect(conditionSlug("incapacitated")).toBeNull();
  });

  test("its sheets carry its own conditions; the engine's own the core keeps", () => {
    system();
    const adapter = new Pf2eAdapter();
    for ( const key of ["prone", "offGuard", "frightened", "grabbed", "immobilized", "unconscious", "dazzled"] ) expect(adapter.sheetCarries(key)).toBe(true);
    for ( const key of ["incapacitated", "dazed", "controlledBy"] ) expect(adapter.sheetCarries(key)).toBe(false);
  });

  test("every PF2e condition offered (the counted ones marked), not its dying and persistent damage; then the core's", () => {
    system();
    const choices = new Pf2eAdapter().conditionChoices();
    const own = choices.slice(0, SLUGS.length - 2);
    expect(own.map(c => c.key)).toEqual(["blinded", "clumsy", "dazzled", "frightened", "grabbed", "immobilized", "offGuard", "prone", "restrained", "unconscious"]);
    expect(own.find(c => c.key === "frightened").valued).toBe(true);
    expect(choices.some(c => c.key === "incapacitated")).toBe(true);
  });
});
