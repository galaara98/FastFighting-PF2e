/**
 * Read PF2e spells that impose conditions into engine crowd-control actions. Pure, unit-tested.
 *
 * A spell's description lists what happens at each degree of the target's save ("Critical Success ... Success ...
 * Failure ... Critical Failure ..."). Each degree's text is scanned for conditions the engine plays out, their
 * values, and how long they last ("for 1 round", "for 1 minute", "until the end of its next turn"), falling back to
 * the spell's own duration.
 */
import { t, conditionLabel } from "./words.js";

/** PF2e condition words -> engine conditions (the engine's own: prone, immobilized, incapacitated). */
const CONDITIONS = {
  frightened: v => ({ frightened: v }),
  slowed: v => ({ slowed: v }),
  stunned: v => ({ stunned: v }),
  sickened: v => ({ sickened: v }),
  clumsy: v => ({ clumsy: v }),
  enfeebled: v => ({ enfeebled: v }),
  "off-guard": () => ({ offGuard: 1 }),
  prone: () => ({ prone: 1 }),
  immobilized: () => ({ immobilized: 1 }),
  restrained: () => ({ immobilized: 1, offGuard: 1 }),
  grabbed: () => ({ immobilized: 1, offGuard: 1 }),
  paralyzed: () => ({ paralyzed: 1 }),
  fleeing: () => ({ fleeing: 1 }),
  unconscious: () => ({ unconscious: 1, incapacitated: 1, offGuard: 1 }),
  // Dominate: it fights for its controller until the spell ends.
  controlled: () => ({ controlled: 1 })
};
const CONDITION_RE = /\b(frightened|slowed|stunned|sickened|clumsy|enfeebled|off-guard|prone|immobilized|restrained|grabbed|paralyzed|fleeing|unconscious|controlled)\b\s*(\d+)?/g;

const DEGREES = ["Critical Failure", "Failure", "Success", "Critical Success"];
const UNIT_ROUNDS = { round: 1, rounds: 1, minute: 10, minutes: 10, hour: 600, hours: 600 };

export function plain(html) {
  return String(html ?? "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rounds from a duration phrase: "1 round", "3 rounds", "1 minute", "until the end of its next turn". */
export function durationRounds(text) {
  const t = String(text ?? "").toLowerCase();
  if ( /until the end of (?:its|the target's|the creature's|your|their) next turn/.test(t) ) return 1;
  const m = /(\d+)\s*(rounds?|minutes?|hours?)\b/.exec(t);
  return m ? Number(m[1]) * UNIT_ROUNDS[m[2]] : null;
}

/** The text for each degree heading in a description (index = degree: 0 critical failure ... 3 critical success). */
function degreeTexts(html) {
  const out = [null, null, null, null];
  const re = /<strong>\s*(Critical Success|Success|Failure|Critical Failure)\s*<\/strong>([\s\S]*?)(?=<strong>\s*(?:Critical Success|Success|Failure|Critical Failure|Heightened)|<hr|$)/g;
  for ( const m of String(html ?? "").matchAll(re) ) out[DEGREES.indexOf(m[1])] = plain(m[2]);
  return out;
}

/** Conditions named in a sentence, with values (frightened 2, slowed 1, prone ...). */
export function conditionsIn(text) {
  const out = {};
  for ( const m of text.toLowerCase().matchAll(CONDITION_RE) ) {
    Object.assign(out, CONDITIONS[m[1]](m[2] ? Number(m[2]) : 1));
  }
  // Losing actions to a compulsion (Command): one action, or the whole turn.
  if ( /must use (?:a single|one) action/.test(text.toLowerCase()) ) out.slowed = Math.max(out.slowed ?? 0, 1);
  if ( /must use all (?:its|of its) actions/.test(text.toLowerCase()) ) out.incapacitated = 1;
  return out;
}

// (Unconscious says it all: not "unconscious, helpless, off-guard".)
const label = conds => (conds.unconscious ? conditionLabel("unconscious")
  : Object.entries(conds).map(([k, v]) => (k === "incapacitated" ? t("Helpless") : conditionLabel(k === "offGuard" ? "off-guard" : k, v > 1 ? v : null))).join(", "));

/**
 * What each degree of the save does, or null if the spell imposes nothing the engine plays out.
 * @param {object} data
 * @param {string} data.description   Spell description HTML
 * @param {string} [data.duration]    Spell duration text ("1 minute", "until the end of the target's next turn")
 * @returns {object[]|null}  onSave: [critFail, fail, success, critSuccess], each null or {conditions, rounds, label, endsOnDamage}
 */
export function parseControl({ description, duration = "" }) {
  const texts = degreeTexts(description);
  if ( texts.every(t => t === null) ) return null;
  const fallback = durationRounds(duration);
  const outcomes = texts.map((text, degree) => {
    if ( !text || /\bunaffected\b/i.test(text) ) return null;
    let conditions = conditionsIn(text);
    // "As failure, plus ..." carries the failure's effects along.
    if ( degree === 0 && /\bas (?:a )?failure\b/i.test(text) && texts[1] ) conditions = { ...conditionsIn(texts[1]), ...conditions };
    if ( !Object.keys(conditions).length ) return null;
    // Frightened wears off a point a turn: it lasts about as many rounds as its value. Control lasts the fight.
    const rounds = durationRounds(text) ?? (conditions.frightened ? conditions.frightened : null) ?? (conditions.stunned ? 1 : null) ?? (conditions.controlled ? 100 : null) ?? fallback ?? 1;
    // "It can attempt a Will save at the end of each of its turns. On a success, the spell ends." (the DC is the caster's)
    const repeat = /save at the end of each of its turns/i.test(text);
    return { conditions, rounds: Math.max(1, rounds), label: label(conditions), endsOnDamage: !!conditions.incapacitated && /unconscious/i.test(text), ...(repeat ? { repeatSave: true } : {}) };
  });
  return outcomes.some(Boolean) ? outcomes : null;
}

/**
 * A rider on a damage spell: "If the target critically fails the save, it is also stunned 1" (Daze), "it's also
 * deafened for 1 minute". Returns an engine effect {kind: "condition", conditions, rounds, critOnly} or null.
 */
export function parseCritRider(description) {
  const text = plain(description);
  const m = /critically fails[^.]*?\b(?:also|is)\b([^.]*)\./i.exec(text);
  if ( !m ) return null;
  const conditions = conditionsIn(m[1]);
  if ( !Object.keys(conditions).length ) return null;
  return { kind: "condition", conditions, rounds: durationRounds(m[1]) ?? 1, label: label(conditions), critOnly: true };
}
