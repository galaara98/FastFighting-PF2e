import { afterEach, describe, expect, test } from "vitest";
import { LORE_BOOST, loreBoost } from "../scripts/lore.js";

const withSetting = value => { globalThis.game = { settings: { get: () => value } }; };
afterEach(() => { delete globalThis.game; });

describe("the Lore-Collector advantage setting", () => {
  test("1.25× to 3×, defaulting to 2× for this system", () => {
    expect(LORE_BOOST).toMatchObject({ min: 1.25, max: 3, default: 2 });
    expect(loreBoost()).toBe(2); // (no settings to read)
    withSetting(1.8);
    expect(loreBoost()).toBe(1.8);
    withSetting(9);
    expect(loreBoost()).toBe(3);
    withSetting(1);
    expect(loreBoost()).toBe(1.25);
    withSetting("nonsense");
    expect(loreBoost()).toBe(2);
  });
});
