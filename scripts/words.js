/**
 * Words for the table, in its language: PF2e's own names where the system has them (its actions, conditions, traits
 * and coins: in Spanish, French ... when a translation of PF2e is installed), a character's feats and items by their
 * own names (a translated compendium's), and this module's words (FFPF2E in languages/) for the rest. English without
 * Foundry (the tests).
 */
import { localize } from "./core.js";

/** This module's words. */
export const t = (key, english, data = null) => localize(`FFPF2E.${key}`, english, data);

/** A PF2e action's name ("Demoralize"), as the system calls it. */
export const actionName = (key, english) => localize(`PF2E.Actions.${key}.Title`, english);

/** A PF2e trait's name ("fire", "finisher"), as the system calls it. */
export function traitName(slug, english = slug) {
  if ( !slug ) return english ?? "";
  const key = String(slug).split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return localize(`PF2E.Trait${key}`, english);
}

/** A condition's name, lower case, with its value ("frightened 1"), as the system calls it. */
export function conditionLabel(slug, value = null) {
  const key = globalThis.CONFIG?.PF2E?.conditionTypes?.[slug];
  const name = (key ? localize(key, slug) : slug).toLocaleLowerCase();
  return value === null || value === undefined || value === true ? name : `${name} ${value}`;
}

/** A coin's abbreviation ("gp"), as the system writes it. */
export const coin = c => localize(`PF2E.CurrencyAbbreviations.${c}`, c);
