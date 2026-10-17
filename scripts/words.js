/**
 * Words for the table, in its language: PF2e's own names where the system has them (its actions, conditions, traits
 * and coins: in Spanish, French ... when a translation of PF2e is installed), a character's feats and items by their
 * own names (a translated compendium's), and this module's words (FFPF2E in languages/) for the rest. The words are
 * in the language files, never here: where PF2e has no word for a trait, condition or coin, its identifier stands in.
 */
import { localize, hasWords, wordList as coreWordList } from "./core.js";

/** This module's words. */
export const t = (key, data = null) => localize(`FFPF2E.${key}`, data);

/**
 * A word list of this module's (FFPF2E.<key>, comma-separated), in the reader's language and in English: what a name
 * may say in either (a compendium is often in English whatever the table reads). Lower case (the core's wordList).
 */
export const wordList = key => coreWordList(`FFPF2E.${key}`);

/**
 * A modifier as PF2e writes it, always with its sign: "+2", "-1", "+0" (the core's signedNumber writes 0 bare, and
 * a sheet says "+0").
 */
export const modifier = n => `${n >= 0 ? "+" : ""}${n}`;

/** The system's word for a key, if it has one (else `otherwise`). */
const sys = (key, otherwise) => (hasWords(key) ? localize(key) : otherwise);

/** A PF2e action's name ("Demoralize"), as the system calls it (its title, or its short title: this module's word without them). */
export const actionName = key => sys(`PF2E.Actions.${key}.Title`, sys(`PF2E.Actions.${key}.ShortTitle`, t(`Action.${key}`)));

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
