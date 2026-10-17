/**
 * The Lore-Collector's payoff for sizing a foe up in PF2e: how much likelier its next rolls are to succeed, a
 * world setting from 1.25× to 3×. The default: Recall Knowledge costs one action of three, and the payoff covers the rest of that turn, so it needs less to be worth it.
 */
import { numberSetting } from "./core.js";

export const LORE_BOOST = Object.freeze({ min: 1.25, max: 3, step: 0.05, default: 2 });

const setting = numberSetting("fast-fighting-pf2e", "loreBoost", {
  ...LORE_BOOST, name: "FFPF2E.Settings.loreBoost.Name", hint: "FFPF2E.Settings.loreBoost.Hint"
});

/** Register the setting (on init). */
export const registerLoreBoost = setting.register;

/** The world's setting, within its bounds (the default if there's none to read). */
export const loreBoost = setting.read;
