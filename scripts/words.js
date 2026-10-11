/**
 * Words for the table, in its language: PF2e's own names where the system has them (its actions, conditions, traits
 * and coins: in Spanish, French ... when a translation of PF2e is installed), a character's feats and items by their
 * own names (a translated compendium's), and this module's words (FFPF2E in languages/) for the rest. The words are
 * in the language files, never here: where PF2e has no word for a trait, condition or coin, its identifier stands in.
 */
import { localize, hasWords } from "./core.js";

/** This module's words. */
export const t = (key, data = null) => localize(`FFPF2E.${key}`, data);

/** The system's word for a key, if it has one (else `otherwise`). */
const sys = (key, otherwise) => (hasWords(key) ? localize(key) : otherwise);

/** A PF2e action's name ("Demoralize"), as the system calls it (this module's word without it). */
export const actionName = key => sys(`PF2E.Actions.${key}.Title`, t(`Action.${key}`));

/** A PF2e trait's name ("fire", "finisher"), as the system calls it. */
export function traitName(slug) {
  if ( !slug ) return "";
  const key = String(slug).split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return sys(`PF2E.Trait${key}`, slug);
}

/** A feature's name: the character's own item's (as its compendium names it), else this module's word for it. */
export const featureName = (names, slug) => names?.[slug] ?? t(`Feature.${slug}`);

/** A condition's name, lower case, with its value ("frightened 1"), as the system calls it. */
export function conditionLabel(slug, value = null) {
  const key = globalThis.CONFIG?.PF2E?.conditionTypes?.[slug];
  const name = sys(key, slug).toLocaleLowerCase();
  return value === null || value === undefined || value === true ? name : `${name} ${value}`;
}

/** A coin's abbreviation ("gp"), as the system writes it. */
export const coin = c => sys(`PF2E.CurrencyAbbreviations.${c}`, c);

/*
 * In a translated world (a Babele translation of PF2e's compendiums: pf2e-es and the like), an item taken from a
 * compendium reads in the table's language, and the rules it states are worded that way. The rules are read here from
 * the English (what Babele keeps of the original), so they're understood whatever the language. Without Babele, or for
 * an item it didn't translate: the item as it is.
 */

/** An item's name as the English books have it. */
export const englishName = item => item?.flags?.babele?.originalName ?? item?.name ?? "";

/** An item's description as the English books have it. */
export function englishDescription(item) {
  const original = item?.flags?.babele?.originalPayload?.description;
  return typeof original === "string" && original ? original : item?.system?.description?.value ?? "";
}
