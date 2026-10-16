/**
 * Breaking free in PF2e, as the core asks it (its engine/behavior/holds.js). Pure, unit-tested.
 *
 * Escape is one action with the attack trait: a check with the best of the creature's unarmed attack modifier,
 * Acrobatics or Athletics, against the DC of what holds it. That's the Athletics DC of a creature grabbing it, the
 * Thievery DC of whoever tied it up, a spell's DC, or an impediment's own Escape DC. A success frees it of the grabbed,
 * immobilized and restrained conditions that one source laid on it, and so does a critical success (after which it
 * may Stride 5 feet); on a critical failure it can't try to Escape again until its next turn.
 * Escape is the held creature's own action: a friend can't make it for them. Untying a friend is an Interact action,
 * one action and no roll, which is the core's own way.
 * Not played: the Escape counting toward the multiple attack penalty of the Strikes after it (the core counts a
 * turn's attacks itself), and the 5-foot Stride after a critical success.
 * The rules (rules.js) play it: escapeFrom, bondsDC, escapeCost (the bar after a critical failure) and breakFree; the
 * adapter puts escapeOf's numbers on each creature's spec.
 */
import { IMPLIES } from "./commit.js";

/** The GM Core's DCs by level (0 to 25): the DC for a challenge of that level when nothing else sets one. */
const LEVEL_DCS = Object.freeze([14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50]);

/** The DC for a level (below 0 as 0; past 25, 2 more a level, as the table goes at its end). */
export function levelDC(level) {
  const n = Math.max(0, Math.round(Number(level) || 0));
  return n < LEVEL_DCS.length ? LEVEL_DCS[n] : LEVEL_DCS.at(-1) + 2 * (n - LEVEL_DCS.length + 1);
}

/** What an Escape breaks that a sheet can show. (Immobilized comes with both; on its own, the sheet can't say what holds it.) */
const HELD = new Set(["grabbed", "restrained"]);

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A statistic's DC: the system's own, else 10 + its modifier. */
const dcOf = s => num(s?.dc?.value) ?? (num(s?.mod) === null ? undefined : 10 + s.mod);

/**
 * What a creature brings to breaking free and to holding others, from its sheet:
 *  - escapeWork {mod}: its best way out, the best of its unarmed attack modifiers (every unarmed Strike the system
 *    lists, shown or not, as the system's own Escape reads them), Acrobatics and Athletics;
 *  - escapeDC: its Athletics DC, how hard a grab of its own is to break;
 *  - tiesDC: its Thievery DC, how hard the bonds it ties are to slip.
 * @param {object} actor   a PF2e actor (its system.actions and skills)
 */
export function escapeOf(actor) {
  const unarmed = (actor?.system?.actions ?? [])
    .filter(s => s?.type === "strike" && (s.item?.category === "unarmed" || (s.item?.system?.traits?.value ?? []).includes("unarmed")))
    .map(s => s.totalModifier);
  const skills = actor?.skills ?? {};
  return {
    escapeWork: escapeWork({ unarmed, acrobatics: skills.acrobatics?.mod, athletics: skills.athletics?.mod }) ?? undefined,
    escapeDC: dcOf(skills.athletics),
    tiesDC: dcOf(skills.thievery)
  };
}

/** The best of its unarmed attack modifiers, Acrobatics and Athletics, as {mod}; null with none of them. */
export function escapeWork({ unarmed = [], acrobatics = null, athletics = null } = {}) {
  const mods = [...unarmed, acrobatics, athletics].map(num).filter(m => m !== null);
  return mods.length ? { mod: Math.max(...mods) } : null;
}

/**
 * A condition its sheet shows that an Escape breaks (rules.escapeFrom): grabbed or restrained, as {dc, others, with},
 * or null. The sheet doesn't say who's holding it, so the DC is the GM Core's for its own level; broken, it takes the
 * off-guard and immobilized it brought along (`with`, which the core clears unless another hold still brings them).
 * Restrained on one the core has tied up is those bonds, marked on the sheet: the core's own hold, not another.
 */
export function sheetHold(u, key) {
  if ( !HELD.has(key) ) return null;
  if ( key === "restrained" && (u?.bound || u?.boundBy) ) return null;
  return { dc: levelDC(u?.spec?.level ?? 0), others: null, with: [...IMPLIES[key]] };
}
