/**
 * A small grammar for the coverage scan (tools/coverage.mjs): a PF2e reaction's Trigger line filed under the core's
 * master list of triggers (FastFighting's scripts/story/master.js REACTION_TRIGGERS, docs/reaction-triggers.md), and the
 * lines it can't file written as a pattern shape with every noun replaced ("<creature> within <range> uses a <trait>
 * action"), never as the text itself. Developer tool, never in the module. Pure.
 *
 * The grammar is the helper's own: reading/en.json's "triggers" (and its "self" words for reading the creature's name
 * as "you"), read through scripts/trigger-lines.js, as reactions-read.js reads it to build reactions. Each entry has a
 * short name of its own (written for this, not the books' words), the master trigger it means, and a regular
 * expression over the normalized line: lower case, the creature's own name made "you" ("the dragon is targeted" reads
 * "you is targeted"), so "you is" and "you are" both occur. The first entry that matches files the line; any later
 * ones that match too are kept as its other triggers (Reactive Strike's: foeOpening, then foeLeavesReach and
 * foeMovesInReach). Order matters: the specific before the general (the whole lines the helper builds from first).
 */
import { readFileSync } from "node:fs";
import { classifyLine, normalizeLine, selfWords } from "../scripts/trigger-lines.js";

const CONDITION = String.raw`(?:blinded|clumsy|confused|controlled|dazzled|deafened|doomed|drained|dying|enfeebled|fascinated|fatigued|fleeing|frightened|grabbed|immobilized|off-guard|paralyzed|persistent|petrified|prone|quickened|restrained|sickened|slowed|stunned|stupefied|unconscious|wounded)`;

/** reading/en.json, the helper's English reading words. */
const READING = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
const ENTRIES = Object.freeze((READING.triggers ?? []).filter(e => e?.pattern && e.trigger));

/**
 * The patterns, in the order they're tried: [name, master trigger, expression]. Names are the entries' own short
 * descriptions of the shape they match.
 */
export const PATTERNS = Object.freeze(ENTRIES.map(e => [e.name ?? "", e.trigger, new RegExp(e.pattern, "i")]));

/**
 * A trigger's words ready for the grammar: plain text, lower case, its own creature's name (or kind) as "you".
 * @param {string} text   the trigger as plain text
 * @param {object} [o]
 * @param {string} [o.name]      the creature's name (none for a character's feat: "you" already)
 * @param {string[]} [o.kinds]   its traits (dragon, devil ...), for "the dragon"
 */
export function normalizeTrigger(text, { name = "", kinds = [] } = {}) {
  return normalizeLine(text, { name, kinds, words: selfWords(READING) });
}

/**
 * The master trigger a normalized line means: {trigger, pattern, also}, `also` the other triggers later patterns find
 * in it; null when nothing matches.
 */
export function classifyTrigger(norm) {
  const filed = classifyLine(norm, ENTRIES);
  return filed ? { trigger: filed.trigger, pattern: filed.pattern, also: filed.also } : null;
}

/**
 * A filing put right by what the reaction does, where its trigger alone can't tell: "reduced to 0 Hit Points" is the
 * moment it would drop (wouldDrop) when the reaction keeps it up at 1 (Ferocity), else the moment it's slain (a death
 * burst).
 * @param {{trigger, pattern, also}|null} filed   classifyTrigger's
 * @param {string} text   the reaction's whole text, plain (read here only)
 */
export function refineTrigger(filed, text) {
  if ( filed?.trigger !== "slain" ) return filed;
  const stays = /\b(?:remains? at 1|at 1 (?:hit point|hp)|avoids? being knocked out|isn'?t knocked out|doesn'?t (?:die|fall unconscious)|stays? (?:up|conscious|alive))\b/i;
  return stays.test(String(text ?? "")) ? { ...filed, trigger: "wouldDrop", pattern: "reduced to 0, stays up" } : filed;
}

/** Words a shape keeps as they are: how a trigger is built, never what it's about. */
const KEEP = new Set(`a an the of to in on at by with within from or and but not if when while during after before as than
  that which who whose it its it's they them their is are was were be been being becomes become would could can can't
  cannot must may has have had does do did no any each every one another other first time times again more less least
  takes take uses use used makes make attempts attempt fails fail critically succeeds succeed success failure hits hit
  damages damage deals deal attack attacks strike strikes spell spells effect effects action actions move turn begins
  starts ends end start reduced points hp save saving throw check roll rolls targeted targets target see sees seen
  observe observed aware adjacent away leaves leave enters enter square space aura reach dies killed casts cast lands
  about yet but either both up down out into onto over under near nearby than same last next previous successful
  successfully triggering triggered trigger condition gains gain loses lose affected area emanation range ranged melee
  physical`.split(/\s+/).filter(Boolean));

/**
 * A line's shape, with every noun replaced: "<creature> within <range> uses a <trait> action". Only the words in KEEP
 * stay; the rest become placeholders (runs of unknown words a single <x>), so no book's wording comes through.
 * @param {string} norm   a normalized line (normalizeTrigger)
 * @param {object} [o]
 * @param {Set<string>} [o.traits]    PF2e's trait words (manipulate, fire ...)
 * @param {Set<string>} [o.actions]   PF2e's action names, one word each (stride, grapple ...)
 * @param {Set<string>} [o.skills]    skills and saves (athletics, fortitude ...)
 */
export function shapeOf(norm, { traits = new Set(), actions = new Set(), skills = new Set() } = {}) {
  const out = [];
  const words = String(norm ?? "").replace(/(\d+)[- ](?:feet|foot|ft)\b/g, " RANGE ").split(/[^a-z0-9'A-Z-]+/).filter(Boolean);
  for ( const raw of words ) {
    const w = raw.replace(/'s$/, "");
    let t;
    if ( raw === "RANGE" || w === "reach" ) t = "<range>";
    else if ( /^\d+$/.test(w) ) t = "<n>";
    else if ( /^(?:you|your|yourself|yours)$/.test(w) ) t = "<self>";
    else if ( /^(?:all(?:y|ies)|companions?|eidolon|minions?)$/.test(w) ) t = "<ally>";
    else if ( /^(?:creatures?|enem(?:y|ies)|foes?|opponents?|attackers?|someone|hazard)$/.test(w) ) t = "<creature>";
    else if ( new RegExp(`^${CONDITION}$`).test(w) ) t = "<condition>";
    else if ( skills.has(w) ) t = "<skill>";
    else if ( actions.has(w) ) t = "<action>";
    else if ( traits.has(w) && !KEEP.has(w) ) t = "<trait>";
    else if ( KEEP.has(w) ) t = w;
    else t = "<x>";
    // (One placeholder for a run of the same: "<x> <x>" is "<x>", "<trait> or <trait>" stays.)
    if ( t.startsWith("<") && out.at(-1) === t ) continue;
    out.push(t);
  }
  return out.slice(0, 16).join(" ");
}
