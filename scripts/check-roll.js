/**
 * Saves and checks in a live battle, rolled with PF2e's own rollers (API 19 rollSave and rollCheck): every save and
 * check in a turn FastFighting plays, its card in the chat as the sheet rolls it, with no roll dialog; for the GMs only
 * where it's `secret`. The DC is the engine's (the system's already: the target's defense DC ...); the degree is
 * PF2e's (0-3), with the natural die and the total.
 *  - A save: the actor's saving throw (actor.saves; of several named, the best, as the engine takes it). Whoever made
 *    it save goes with it as its origin, and the item it's against where the action's id names one (the adapter's ids:
 *    the actor's id, then the item's id or slug), so PF2e's bonuses against a poison or a spell count. Not an item with
 *    the incapacitation trait: the engine shifts that degree itself (rules.controlShift).
 *  - A check: PF2e's own action, where the adapter's action is one (Trip, Grapple, Shove, Disarm, Reposition,
 *    Demoralize, Feint, Create a Diversion, Hide, Aid; Escape, Steal and Administer First Aid by what it's for), as
 *    its sheet button rolls it (its card, notes and traits; a trip weapon's item bonus to Trip). Else the skill a feat
 *    or an ability uses (Bon Mot, Battle Medicine, Swallow Whole: with that item), Medicine to heal, or the skill the
 *    spec names (by slug, or the label its sheet shows; talk by the core's kind of pitch). Against a target's defense
 *    (`against`), the target goes with it where its token is drawn, so the card says whose DC it was.
 *  - The multiple attack penalty on a check with the attack trait (a maneuver, an Escape, Swallow Whole): PF2e's own,
 *    for the attacks the token made before it this turn as this client rolled them (strike-roll.js attacksSoFar: the
 *    core counts a Strike's, not a check's). Not counted: a Strike the engine rolled itself.
 * Null where it can't tell what to roll (a spell check: PF2e has none) or PF2e rolled nothing: the engine rolls it.
 * {gm: true} for an Aid whose best way is a Strike: PF2e's Aid rolls a skill, and the check that aids is the GM's call.
 */
import { naturalOf } from "./read-turn.js";
import { click, strikesOf, attacksSoFar, noteAttack } from "./strike-roll.js";
import { AID_SKILLS } from "./edges.js";

/** PF2e's saves, by the keys the engine may name them with. */
const SAVES = Object.freeze({ __proto__: null, fortitude: "fortitude", fort: "fortitude", reflex: "reflex", ref: "reflex", will: "will" });

/** The adapter's actions PF2e has an action of its own for (game.pf2e.actions), by slug: the action's id ends in it. */
const ACTIONS = new Set(["trip", "grapple", "shove", "disarm", "reposition", "demoralize", "feint", "create-a-diversion", "hide"]);

/** What a check is for, where PF2e has an action for it: [its slug, its variant]. */
const PURPOSES = Object.freeze({ __proto__: null, escape: ["escape"], theft: ["steal"], firstAid: ["administer-first-aid", "stabilize"] });

/** The skill a feat or an ability rolls, by its slug: Bon Mot, Battle Medicine, Swallow Whole (gullet.js). */
const ITEM_SKILLS = Object.freeze({ __proto__: null, "bon-mot": "diplomacy", "battle-medicine": "medicine", "swallow-whole": "athletics" });

/** Talk, by the core's kind of pitch: its skill (adapter.js #social). */
const TALK = Object.freeze({ __proto__: null, persuade: "diplomacy", intimidate: "intimidation", deceive: "deception" });

/** For the GMs only (`secret`), as PF2e rolls a GM's roll; else in the chat's own mode. */
const mode = secret => (secret ? { messageMode: game.user?.isGM ? "gm" : "blind" } : {});

/** The engine's DC, a whole number; null without one. */
const dcOf = dc => (typeof dc === "number" && Number.isFinite(dc) ? Math.trunc(dc) : null);

/** An item's slug, PF2e's own (none made from its name, which is in the world's language). */
const slugOf = item => item?.slug ?? item?.system?.slug ?? null;

const traitsOf = item => [...(item?.system?.traits?.value ?? [])];

/** What PF2e rolled: {degree (0-3), natural, total}, or null (cancelled, or no degree). */
function rolled(roll) {
  const degree = roll?.degreeOfSuccess;
  if ( !Number.isInteger(degree) || degree < 0 || degree > 3 ) return null;
  return { degree, natural: naturalOf(roll), total: Number(roll.total) };
}

/**
 * The item an action's id names among the actor's (the adapter's ids: the actor's id, then the item's id or slug), or
 * null. Not one with the incapacitation trait: the engine shifts that degree itself (rules.controlShift).
 */
function itemIn(actor, id) {
  const parts = typeof id === "string" ? id.split(".") : [];
  if ( !actor?.items || parts.length < 2 || parts[0] !== actor.id ) return null;
  const rest = parts.slice(1);
  const item = rest.map(p => actor.items.get?.(p)).find(Boolean) ?? actor.items.find?.(i => rest.includes(slugOf(i))) ?? null;
  return item && !traitsOf(item).includes("incapacitation") ? item : null;
}

/** The actor an action's id begins with (the adapter's ids), or null. */
const actorOf = id => (typeof id === "string" ? game.actors?.get?.(id.split(".")[0]) ?? null : null);

/** The actor's save of those named (a key, or several: the best of them, as the engine takes it), or null. */
function saveOf(actor, save) {
  const saves = [].concat(save ?? []).map(k => actor?.saves?.[SAVES[k]]).filter(s => typeof s?.roll === "function");
  return saves.reduce((best, s) => (!best || (Number(s.mod) || 0) > (Number(best.mod) || 0) ? s : best), null);
}

/**
 * A save rolled with PF2e's own roller: the actor's save against the engine's DC, whoever made it save as its origin
 * and the item it's against where the action's id names one.
 * @param {TokenDocument} token   the one saving
 * @param {object} options        {save: its key, or several; dc; action: {id, name}; from: the TokenDocument of
 *                                 whoever made it save, or null; secret: for the GMs only}
 * @returns {Promise<object|null>} {degree, natural, total}, or null (the engine rolls it)
 */
export async function rollPf2eSave(token, { save, dc, action = null, from = null, secret = false } = {}) {
  const stat = saveOf(token?.actor, save);
  const value = dcOf(dc);
  if ( !stat || value === null ) return null;
  // (Its item from whoever made it save; with no one known, from the actor the action's id begins with.)
  const origin = from?.actor ?? null;
  const item = itemIn(origin ?? actorOf(action?.id), action?.id);
  const roll = await stat.roll({ dc: { value }, skipDialog: true, ...mode(secret), ...(origin ? { origin } : {}), ...(item ? { item } : {}) });
  return rolled(roll);
}

/** A skill or Perception, by its slug or by the label its sheet shows (a spec's, in the world's language), or null. */
function statisticOf(actor, name) {
  if ( typeof name !== "string" || !name ) return null;
  const all = [...Object.values(actor.skills ?? {}), actor.perception].filter(s => typeof s?.roll === "function");
  return all.find(s => s.slug === name) ?? all.find(s => s.label === name) ?? null;
}

/**
 * Aid as the adapter weighs it (edges.js): its best skill of AID_SKILLS, as PF2e's Aid rolls it. A Strike better than
 * any is a GM's call ({gm: true}): PF2e's Aid rolls a skill, and the check that aids is the GM's to say. Null with
 * neither.
 */
function aidWay(actor) {
  const skill = AID_SKILLS.map(s => actor.skills?.[s]).filter(s => Number.isFinite(s?.mod)).reduce((a, b) => (!a || b.mod > a.mod ? b : a), null);
  const strike = Math.max(...strikesOf(actor).map(s => Number(s.totalModifier)).filter(Number.isFinite));
  if ( strike > (skill?.mod ?? -Infinity) ) return { gm: true };
  return skill ? { action: "aid", statistic: skill.slug } : null;
}

/**
 * What a check is rolled with: PF2e's action ({action, variant, statistic}), a statistic ({statistic, item}), a GM's
 * call ({gm: true}), or null (it can't tell).
 */
function checkFor(actor, { purpose, skill, action }) {
  const id = typeof action?.id === "string" ? action.id : "";
  const last = id.split(".").pop();
  if ( (purpose === "control" || purpose === "aid") && ACTIONS.has(last) ) return { action: last };
  if ( purpose === "aid" && last === "aid" ) return aidWay(actor);
  const item = itemIn(actor, id);
  const own = ITEM_SKILLS[slugOf(item)];
  if ( own && actor.skills?.[own] ) return { statistic: actor.skills[own], item };
  if ( PURPOSES[purpose] ) return { action: PURPOSES[purpose][0], variant: PURPOSES[purpose][1] ?? null };
  // (PF2e has no spell check.)
  if ( purpose === "cast" ) return null;
  // (Talk names its skill by the label the sheet shows, or the kind of pitch; with no action, the kind is its name.)
  const statistic = statisticOf(actor, skill) ?? statisticOf(actor, TALK[skill])
    ?? (purpose === "talk" ? statisticOf(actor, TALK[action?.name]) : null)
    ?? (purpose === "heal" ? actor.skills?.medicine ?? null : null);
  return statistic ? { statistic, item } : null;
}

/** PF2e's own action (game.pf2e.actions), as its sheet button rolls it: its card, notes and traits. */
async function useAction(token, { action: slug, variant = null, statistic = null }, { dc, at, secret }) {
  const pf2e = game.pf2e?.actions?.get?.(slug);
  if ( typeof pf2e?.use !== "function" ) return null;
  const attack = (pf2e.traits ?? []).includes("attack");
  const before = attack ? attacksSoFar(token) : 0;
  const results = await pf2e.use({
    actors: [token.actor], event: click("showCheckDialogs", secret), difficultyClass: dc,
    ...(variant ? { variant } : {}), ...(statistic ? { statistic } : {}), ...(at ? { target: at.object } : {}),
    // (PF2e's -5 an attack before it, no further than the third.)
    ...(before > 0 ? { multipleAttackPenalty: before } : {})
  });
  const done = (Array.isArray(results) ? results : []).find(r => r?.actor === token.actor) ?? null;
  const out = rolled(done?.roll);
  if ( out && attack ) noteAttack(token, done.message?.id ?? null);
  return out;
}

/** A skill or Perception, as its sheet rolls it; a feat's or an ability's with that item (its name, traits and action). */
async function rollStatistic(token, { statistic, item = null }, { dc, at, secret }) {
  const traits = traitsOf(item);
  const attack = traits.includes("attack");
  const slug = slugOf(item);
  let card = null;
  const roll = await statistic.roll({
    dc, skipDialog: true, ...mode(secret), ...(at ? { target: at.actor } : {}),
    ...(item ? { item, title: item.name, traits, extraRollOptions: slug ? [`action:${slug}`] : [] } : {}),
    // (PF2e's multiple attack penalty for that item: an agile one's -4.)
    ...(attack ? { attackNumber: attacksSoFar(token) + 1 } : {}),
    callback: (_roll, _outcome, message) => {
      card = message?.id ?? null;
    }
  });
  const out = rolled(roll);
  if ( out && attack ) noteAttack(token, card);
  return out;
}

/**
 * A check rolled with PF2e's own roller: PF2e's action, or the skill, against the engine's DC.
 * @param {TokenDocument} token   the one rolling it
 * @param {object} options        {purpose; skill: the spec's, if it names one; against: the target's defense; dc;
 *                                 action: {id, name}; target: a TokenDocument, or null; secret: for the GMs only}
 * @returns {Promise<object|null>} {degree, natural, total}; {gm: true}; or null (the engine rolls it)
 */
export async function rollPf2eCheck(token, { purpose = null, skill = null, against = null, dc, action = null, target = null, secret = false } = {}) {
  const actor = token?.actor;
  const value = dcOf(dc);
  if ( !actor || value === null ) return null;
  const how = checkFor(actor, { purpose, skill, action });
  if ( !how || how.gm ) return how;
  // (At another's defense, the target goes with it where its token is drawn here: the card says whose DC it was.)
  const other = target && target !== token && !(target.id && target.id === token.id);
  const at = other && typeof against === "string" && against && target.object ? target : null;
  const options = { dc: at ? { value, slug: against } : { value }, at, secret };
  return how.action ? useAction(token, how, options) : rollStatistic(token, how, options);
}
