/**
 * The core's own conditions in PF2e: fascinated is PF2e's (-2 to its skill checks; it can still act), not the core's
 * (which takes its turn); the core's others PF2e's sheets show but its rules don't play (dazzled, concealed ...) keep
 * the core's meaning.
 */
import { describe, expect, test } from "vitest";
import { pf2eRules } from "../scripts/rules.js";
import { conditionSetup } from "../../FastFighting/scripts/engine/conditions.js";

describe("the core's conditions, in PF2e's terms", () => {
  test("fascinated is PF2e's: -2 to its checks, and its turn its own", () => {
    const { owned } = conditionSetup(pf2eRules);
    expect(owned).toContain("fascinated");
    expect(owned).not.toContain("dazzled");
    expect(pf2eRules.modifiers.check({ unit: { conds: { fascinated: 1 } } }).bonus).toBe(-2);
    expect(pf2eRules.modifiers.check({ unit: { conds: {} } }).bonus).toBe(0);
  });
});
