/**
 * The core's own conditions in PF2e: fascinated is PF2e's (-2 to its skill checks; it can still act), not the core's
 * (which takes its turn); so are stupefied, drained, dazzled, concealed and encumbered (PF2e's own meaning, rules.js);
 * the core's others PF2e has no word of (frozen solid, burning, swallowed ...) keep the core's meaning.
 */
import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";
import { conditionSetup } from "../../FastFighting/scripts/engine/conditions.js";

describe("the core's conditions, in PF2e's terms", () => {
  test("fascinated is PF2e's: -2 to its checks, and its turn its own", () => {
    const { owned } = conditionSetup(pf2eRules);
    expect(owned).toContain("fascinated");
    for ( const key of ["stupefied", "drained", "dazzled", "concealed", "encumbered"] ) expect(owned).toContain(key);
    for ( const key of ["frozen", "burning", "swallowed", "engulfed", "hastened"] ) expect(owned).not.toContain(key);
    expect(pf2eRules.modifiers.check({ unit: { conds: { fascinated: 1 } } }).bonus).toBe(-2);
    expect(pf2eRules.modifiers.check({ unit: { conds: {} } }).bonus).toBe(0);
  });
});

describe("cover from the walls, PF2e's", () => {
  test("standard cover (some of it hidden) +2 to AC and Reflex, greater (most) +4; the core's own none", () => {
    expect(pf2eRules.handlesCover).toBe(true);
    const t = { conds: {}, prone: false };
    const ac = cover => pf2eRules.modifiers.defense({ target: t, cover, grabbed: false, flanked: false, exposedTo: false });
    expect([ac("none"), ac("some"), ac("most")]).toEqual([0, 2, 4]);
    expect(pf2eRules.modifiers.save({ unit: t, type: "reflex", cover: "most" }).bonus).toBe(4);
    expect(pf2eRules.modifiers.save({ unit: t, type: "will", cover: "most" }).bonus).toBeCloseTo(0);
  });
});
