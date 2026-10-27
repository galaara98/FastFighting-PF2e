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
 *  - Talk at a creature drawn here: PF2e's own action for the core's kind of pitch (TALK_ACTIONS), at its Will DC (a
 *    lie, its Perception DC), the target with it, so its card says what was said, to whom and how it went. Without the
 *    action (an older PF2e) or the target's token here, the skill alone, as before. A taunt isn't one: it's the skill.
 *  - The multiple attack penalty, on a check with the attack trait (a maneuver, Swallow Whole): for the core's
 *    `attackNumber`, the attacks before it as the engine counted them for its own penalty (none: null). An Escape takes
 *    none, as the engine's doesn't (PF2e's has the attack trait).
 *  - The helper's own rules' checks (rules.js, through the core's systemRolled): a flat check ("flat": PF2e's flat
 *    check, the d20 alone, titled with what it's for), and Tumble Through ("tumble": PF2e's action, at the foe's
 *    Reflex DC).
 *  - A Seek (purpose "seek", the core's patrol: behavior/patrol.js): PF2e's own Seek action, its secret trait rolling it
 *    for the GMs, against the engine's DC (the hardest Stealth DC of those it may find); without the action, Perception.
 *  - A deal (purposes "bribe", "extort", "scare": the core's behavior/deals.js, API 26): PF2e's own action at the
 *    target's Will DC, a bribe a Request (Diplomacy), a demand (money, or only to go; a toll) a Coerce (Intimidation). Without
 *    words (`deal.wordless`), neither will do (both are linguistic): Intimidation, with Demoralize's -4 for a target that
 *    doesn't understand. Without the action or the target's token here, the skill alone.
 * Null where it can't tell what to roll (a spell check: PF2e has none; an Aid only a Strike would make: PF2e's Aid
 * rolls a skill) or PF2e rolled nothing: the engine rolls it.
 */
import { naturalOf } from "./read-turn.js";
import { click, strikesOf, slugOf, spellPart, castAt } from "./strike-roll.js";
import { AID_SKILLS } from "./edges.js";
import { t } from "./words.js";

/** PF2e's saves, by the keys the engine may name them with. */
const SAVES = Object.freeze({ __proto__: null, fortitude: "fortitude", fort: "fortitude", reflex: "reflex", ref: "reflex", will: "will" });

/** The adapter's actions PF2e has an action of its own for (game.pf2e.actions), by slug: the action's id ends in it. */
const ACTIONS = new Set(["trip", "grapple", "shove", "disarm", "reposition", "demoralize", "feint", "create-a-diversion", "hide"]);

/**
 * What a check is for, where PF2e has an action for it: [its slug, its variant]. First aid on a bleed, Administer First
 * Aid's other variant: its action id ends in it (rules.js stopBleeding).
 */
const PURPOSES = Object.freeze({ __proto__: null, escape: ["escape"], theft: ["steal"], firstAid: ["administer-first-aid", "stabilize"], tumble: ["tumble-through"] });

/** The skill a feat or an ability rolls, by its slug: Bon Mot, Battle Medicine, Swallow Whole (gullet.js). */
const ITEM_SKILLS = Object.freeze({ __proto__: null, "bon-mot": "diplomacy", "battle-medicine": "medicine", "swallow-whole": "athletics" });

/** A deal, by what it's for: PF2e's action, and its skill. */
const DEALS = Object.freeze({ __proto__: null, bribe: { action: "request", skill: "diplomacy" }, extort: { action: "coerce", skill: "intimidation" }, scare: { action: "coerce", skill: "intimidation" }, toll: { action: "coerce", skill: "intimidation" } });

/** Talk, by the core's kind of pitch: its skill (adapter.js #social). */
const TALK = Object.freeze({ __proto__: null, persuade: "diplomacy", intimidate: "intimidation", deceive: "deception" });

/**
 * Talk as PF2e's own action, by the core's kind of pitch, with the defense its DC is (adapter.js #social's resist). The
 * engine's pitch moves its target along the persuasion track toward standing down (a step a success, two a critical
 * success):
 *  - persuade: Request in a fight (Diplomacy's one action: what a turn has room for); Make an Impression while a
 *    standoff holds (no blows yet, time to talk: an attitude turned a step at a time, as the track goes);
 *  - intimidate: Coerce, in a fight or a standoff. Never Demoralize: the engine sways, it doesn't frighten, and
 *    Demoralize's card would promise the frightened condition;
 *  - deceive: Lie, against Perception. Its secret trait has PF2e roll it for the GMs: PF2e's own rule.
 */
const TALK_ACTIONS = Object.freeze({
  __proto__: null,
  persuade: { fight: "request", standoff: "make-an-impression", against: "will" },
  intimidate: { fight: "coerce", standoff: "coerce", against: "will" },
  deceive: { fight: "lie", standoff: "lie", against: "perception" }
});

/** For the GMs only (`secret`), as PF2e rolls a GM's roll; else in the chat's own mode. */
const mode = secret => (secret ? { messageMode: game.user?.isGM ? "gm" : "blind" } : {});

/** The engine's DC, a whole number; null without one. */
const dcOf = dc => (typeof dc === "number" && Number.isFinite(dc) ? Math.trunc(dc) : null);

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
  // (A spell's at the rank it's cast at: `<spell id>@5`.)
  const rest = parts.slice(1).map(spellPart);
  const found = rest.map(p => ({ item: actor.items.get?.(p.itemId), rank: p.rank })).find(p => p.item);
  const item = found ? castAt(found.item, found.rank) : actor.items.find?.(i => rest.some(p => p.itemId === slugOf(i))) ?? null;
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
 * Aid as the adapter weighs it (edges.js): its best skill of AID_SKILLS, as PF2e's Aid rolls it. Null with none, or a
 * Strike better than any (PF2e's Aid rolls a skill): the engine rolls it, as it weighed it.
 */
function aidWay(actor) {
  const skill = AID_SKILLS.map(s => actor.skills?.[s]).filter(s => Number.isFinite(s?.mod)).reduce((a, b) => (!a || b.mod > a.mod ? b : a), null);
  const strike = Math.max(...strikesOf(actor).map(s => Number(s.totalModifier)).filter(Number.isFinite));
  return skill && skill.mod >= strike ? { action: "aid", statistic: skill.slug } : null;
}

/** What a check is rolled with: PF2e's action ({action, variant, statistic}), a statistic ({statistic, item}), or null. */
function checkFor(actor, { purpose, skill, action }) {
  const id = typeof action?.id === "string" ? action.id : "";
  const last = id.split(".").pop();
  if ( (purpose === "control" || purpose === "aid") && ACTIONS.has(last) ) return { action: last };
  if ( purpose === "aid" && last === "aid" ) return aidWay(actor);
  // (A Seek: PF2e's own, its card and its secret trait; without the action, Perception as the sheet rolls it.)
  if ( purpose === "seek" ) return pf2eAction("seek") ? { action: "seek" } : statisticOf(actor, "perception") ? { statistic: statisticOf(actor, "perception") } : null;
  const item = itemIn(actor, id);
  const own = ITEM_SKILLS[slugOf(item)];
  if ( own && actor.skills?.[own] ) return { statistic: actor.skills[own], item };
  if ( PURPOSES[purpose] ) {
    const [slug, variant = null] = PURPOSES[purpose];
    return { action: slug, variant: purpose === "firstAid" && last === "stop-bleeding" ? last : variant };
  }
  // (PF2e has no spell check.)
  if ( purpose === "cast" ) return null;
  // (Talk names its skill by the label the sheet shows, or the kind of pitch; with no action, the kind is its name.)
  const statistic = statisticOf(actor, skill) ?? statisticOf(actor, TALK[skill])
    ?? (purpose === "talk" ? statisticOf(actor, TALK[action?.name]) : null)
    ?? (purpose === "heal" ? actor.skills?.medicine ?? null : null);
  return statistic ? { statistic, item } : null;
}

/** PF2e's own action by its slug (game.pf2e.actions), where it can be used; else null. */
const pf2eAction = slug => {
  const action = game.pf2e?.actions?.get?.(slug);
  return typeof action?.use === "function" ? action : null;
};

/**
 * Talk as PF2e's own action (TALK_ACTIONS): {action, against}, or null where it's the skill alone. Talk itself is the
 * core's pitch, named by its kind with no action id of its own (a taunt has one, the core's goad: the skill); at
 * someone else whose token is drawn here (PF2e takes a target only so, and with none takes the user's own targets); and
 * PF2e has the action.
 */
function talkAction(token, { skill, action, target, standoff }) {
  if ( typeof action?.id === "string" && action.id ) return null;
  const kind = TALK_ACTIONS[action?.name] ? action.name : TALK_ACTIONS[skill] ? skill : null;
  if ( !kind || !target?.object || target === token || (target.id && target.id === token.id) ) return null;
  const how = TALK_ACTIONS[kind];
  const slug = standoff ? how.standoff : how.fight;
  return pf2eAction(slug) ? { action: slug, against: how.against } : null;
}

/**
 * A deal's check (DEALS): PF2e's action at the target's Will DC, where the target's token is drawn here; else the skill.
 * Without words, Intimidation with Demoralize's -4 (PF2e's own penalty, by its own label). A skill of the player's own
 * choosing (their deal dialog: `skill`, by its slug), not the deal's own: that skill, as its sheet rolls it.
 */
async function rollDeal(token, { purpose, value, target, wordless, skill = null, secret }) {
  const how = DEALS[purpose];
  const at = target?.object && target !== token && !(target.id && target.id === token.id) ? target : null;
  const dc = at ? { value, slug: "will" } : { value };
  const own = typeof skill === "string" && skill !== how.skill ? token.actor.skills?.[skill] ?? null : null;
  const statistic = own ?? token.actor.skills?.[how.skill] ?? null;
  if ( wordless ) {
    const Modifier = game.pf2e?.Modifier;
    if ( !statistic || typeof Modifier !== "function" ) return null;
    const penalty = new Modifier({ label: "PF2E.Actions.Demoralize.Unintelligible", modifier: -4, type: "circumstance" });
    return rolled(await statistic.roll({ dc, skipDialog: true, ...mode(secret), ...(at ? { target: at.actor } : {}), modifiers: [penalty] }));
  }
  if ( at && !own && pf2eAction(how.action) ) return useAction(token, { action: how.action }, { dc, at, attacks: null, secret });
  return statistic ? rollStatistic(token, { statistic }, { dc, at, attacks: null, secret }) : null;
}

/** PF2e's own action (game.pf2e.actions), as its sheet button rolls it: its card, notes and traits. */
async function useAction(token, { action: slug, variant = null, statistic = null }, { dc, at, attacks, secret }) {
  const pf2e = pf2eAction(slug);
  if ( !pf2e ) return null;
  const results = await pf2e.use({
    actors: [token.actor], event: click("showCheckDialogs", secret), difficultyClass: dc,
    ...(variant ? { variant } : {}), ...(statistic ? { statistic } : {}), ...(at ? { target: at.object } : {}),
    // (PF2e's -5 an attack before it, no further than -10, as the engine's maneuvers take it.)
    ...(attacks > 0 ? { multipleAttackPenalty: attacks } : {})
  });
  const done = (Array.isArray(results) ? results : []).find(r => r?.actor === token.actor) ?? null;
  return rolled(done?.roll);
}

/** A skill or Perception, as its sheet rolls it; a feat's or an ability's with that item (its name, traits and action). */
async function rollStatistic(token, { statistic, item = null }, { dc, at, attacks, secret }) {
  const traits = traitsOf(item);
  const slug = slugOf(item);
  const roll = await statistic.roll({
    dc, skipDialog: true, ...mode(secret), ...(at ? { target: at.actor } : {}),
    ...(item ? { item, title: item.name, traits, extraRollOptions: slug ? [`action:${slug}`] : [] } : {}),
    // (PF2e's multiple attack penalty for that item, by its attack number.)
    ...(item && attacks !== null ? { attackNumber: attacks + 1 } : {})
  });
  return rolled(roll);
}

/**
 * A flat check as PF2e rolls one (game.pf2e.Check, a flat check: the d20 alone, no dialog) against the engine's DC, the
 * card titled with what it's for (the rules' label, the core's action name).
 */
async function rollFlat(token, { value, label, secret }) {
  const Check = game.pf2e?.Check;
  const CheckModifier = game.pf2e?.CheckModifier;
  if ( typeof Check?.roll !== "function" || typeof CheckModifier !== "function" ) return null;
  const title = label ? t("FlatCheckFor", { what: label }) : game.i18n.localize("PF2E.FlatCheck");
  const roll = await Check.roll(new CheckModifier(title, { modifiers: [] }), {
    actor: token.actor, token, type: "flat-check", title, dc: { value }, options: ["flat-check"], skipDialog: true, ...mode(secret)
  });
  return rolled(roll);
}

/**
 * A check rolled with PF2e's own roller: PF2e's action, or the skill, against the engine's DC.
 * @param {TokenDocument} token   the one rolling it
 * @param {object} options        {purpose; skill: the spec's, if it names one; against: the target's defense;
 *                                 attackNumber: the attacks before it this turn, for one with the attack trait, else
 *                                 null; standoff: a standoff holds (API 20); dc; action: {id, name}; target: a
 *                                 TokenDocument, or null; secret: for the GMs}
 * @returns {Promise<object|null>} {degree, natural, total}, or null (the engine rolls it)
 */
export async function rollPf2eCheck(token, { purpose = null, skill = null, against = null, attackNumber = null, standoff = false, dc, action = null, target = null, secret = false, deal = null } = {}) {
  const actor = token?.actor;
  const value = dcOf(dc);
  if ( !actor || value === null ) return null;
  if ( purpose === "flat" ) return rollFlat(token, { value, label: typeof action?.name === "string" ? action.name : "", secret });
  if ( DEALS[purpose] ) return rollDeal(token, { purpose, value, target, wordless: deal?.wordless === true, skill, secret });
  // (Talk at someone drawn here: PF2e's own action, its card the target's and its DC's. Else the skill, below.)
  const talk = purpose === "talk" ? talkAction(token, { skill, action, target, standoff: standoff === true }) : null;
  if ( talk ) return useAction(token, talk, { dc: { value, slug: against ?? talk.against }, at: target, attacks: null, secret });
  const how = checkFor(actor, { purpose, skill, action });
  const attacks = Number.isInteger(attackNumber) && attackNumber >= 0 ? attackNumber : null;
  // (A penalty PF2e can't take without an action or an item to take it by: the engine rolls it, with its own.)
  if ( !how || (attacks > 0 && !how.action && !how.item) ) return null;
  // (At another's defense, the target goes with it where its token is drawn here: the card says whose DC it was.)
  const other = target && target !== token && !(target.id && target.id === token.id);
  const at = other && typeof against === "string" && against && target.object ? target : null;
  const options = { dc: at ? { value, slug: against } : { value }, at, attacks, secret };
  return how.action ? useAction(token, how, options) : rollStatistic(token, how, options);
}
