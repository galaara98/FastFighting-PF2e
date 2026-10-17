/**
 * A player's turn in a live battle, read from the chat cards PF2e made for it (flags.pf2e.context): what FastFighting's
 * engine would have logged, so the turn is told like any other and the creatures it plays feel it.
 *   - A Strike (attack-roll): who, with what, how it went; its damage roll, the damage (the sheets settle how much).
 *   - A skill action at a creature (skill-check): Demoralize, Trip, Grapple, Shove, Disarm, Feint as maneuvers; a
 *     Diplomacy, Intimidation or Deception roll at it as words (the GM looks: was it talk?).
 *   - Healing (a damage roll of healing): told as healing (the sheets say how much).
 * Each event says whether it's `sure`; what isn't, the GM looks at before the turn is told.
 * A damage roll's card is read here too as it's made (pf2eDamageCard), for the core to apply it or put it before a GM.
 */
import { asksSave } from "./abilities.js";

/** A PF2e degree of success as the engine counts it (0 critical failure ... 3 critical success). */
const DEGREE = { criticalFailure: 0, failure: 1, success: 2, criticalSuccess: 3 };

/** Skill actions that are maneuvers on the core's master list (story/master.js), by the action's slug. */
const MANEUVERS = { __proto__: null, demoralize: "demoralize", trip: "trip", grapple: "grapple", shove: "shove", disarm: "disarm", feint: "feint", "create-a-diversion": "distract", reposition: "reposition" };
/** A skill rolled at a creature that is words, and which. */
const TALK = { diplomacy: "persuade", intimidation: "intimidate", deception: "deceive" };

/** The token id at the end of a token's uuid ("Scene.x.Token.y"), or the id itself. */
const tokenIdOf = ref => (typeof ref === "string" ? ref.split(".").pop() : null);

/** The natural die of a d20 check, where it shows. */
function naturalOf(roll) {
  const d20 = roll?.dice?.find?.(d => d.faces === 20);
  return d20?.total ?? d20?.results?.find?.(r => r.active)?.result ?? null;
}

/** Whether an attack roll's card is a melee one (its options or domains say). */
function meleeOf(c) {
  const has = (list, v) => Array.isArray(list) && list.includes(v);
  return has(c.options, "item:melee") || has(c.domains, "melee-attack-roll") || has(c.domains, "melee-strike-attack-roll");
}

/** A card's list, where it is one (a card's data is its author's to write). */
export const listOf = v => (Array.isArray(v) ? v : []);

/** The token a card was rolled at, by its uuid (PF2e writes it in the card's context, and again in its flags). */
const targetOf = m => m.flags?.pf2e?.context?.target?.token ?? m.flags?.pf2e?.target?.token ?? null;

/** A damage roll's kinds (damage, healing), from the roll or from each of its parts. */
function kindsOf(roll) {
  if ( roll?.kinds instanceof Set ) return roll.kinds;
  return new Set(listOf(roll?.instances).flatMap(i => (i?.kinds instanceof Set ? [...i.kinds] : [])));
}

/**
 * Whether a damage roll heals: healing alone, or harm and healing both (Heal, Harm) at a creature its harm doesn't
 * touch (PF2e's isAffectedBy: vitality hurts only the undead, void only the living). At no one known: it heals.
 */
export function heals(roll, actor = null) {
  const kinds = kindsOf(roll);
  if ( !kinds.has("healing") ) return false;
  if ( !kinds.has("damage") || typeof actor?.isAffectedBy !== "function" ) return true;
  const types = globalThis.CONFIG?.PF2E?.damageTypes ?? {};
  return !listOf(roll.instances).some(i => i?.kinds?.has?.("damage") && Object.hasOwn(types, String(i.type)) && actor.isAffectedBy(String(i.type)));
}

/** A card's first roll, where it's PF2e's damage roll (what its Apply Damage buttons take), else null. */
export function damageRollOf(message) {
  const roll = message?.rolls?.[0] ?? null;
  const DamageRoll = globalThis.CONFIG?.Dice?.rolls?.find?.(r => r?.name === "DamageRoll");
  return roll && (DamageRoll ? roll instanceof DamageRoll : typeof roll.alter === "function") ? roll : null;
}

/** The item a card came from (PF2e's own reading of it: a spell as it was cast), or null. */
export function itemOf(message) {
  try {
    return message.item ?? null;
  } catch ( err ) {
    return null;
  }
}

/** A spell's defense, by its roll options (PF2e's item:defense:...): a save against its damage. */
const SAVE_OPTION = /^item:defense:(?:basic|fortitude|reflex|will)$/;
/** Area Fire and Auto-Fire, by their damage's domains: a basic Reflex save. */
const SAVE_DOMAINS = new Set(["area-fire-damage", "auto-fire-damage"]);

/**
 * Whether a damage roll's damage waits on a save its target rolls: a spell with a save, Area Fire or Auto-Fire, or an
 * effect (a feat's, an impulse's, a consumable's) whose text asks for one. Not an attack's, nor one whose degree is
 * known already (an affliction's stage, after its save).
 */
function withSave(message) {
  const c = message.flags.pf2e.context;
  if ( c.sourceType !== "save" || c.outcome ) return false;
  if ( listOf(c.options).some(o => SAVE_OPTION.test(o)) || listOf(c.domains).some(d => SAVE_DOMAINS.has(d)) ) return true;
  const item = itemOf(message);
  return !!item && item.type !== "spell" && asksSave(item.system?.description?.value);
}

/**
 * A damage roll's card (context type "damage-roll"): {amount (the roll's total), kind ("damage" or "healing"), targets
 * (the token it was rolled at, by id), save}; null for any other card.
 * @param {ChatMessage} message
 */
export function pf2eDamageCard(message) {
  const c = message?.flags?.pf2e?.context;
  if ( c?.type !== "damage-roll" ) return null;
  const roll = damageRollOf(message);
  const amount = Number(roll?.total);
  if ( !roll || !Number.isFinite(amount) ) return null;
  const at = tokenIdOf(targetOf(message));
  let actor = null;
  try {
    actor = message.target?.actor ?? null;
  } catch ( err ) {
    actor = null;
  }
  return { amount, kind: heals(roll, actor) ? "healing" : "damage", targets: at ? [at] : [], save: withSave(message) };
}

/** The action a check was made for, by its slug (from its roll options: "action:demoralize"). */
function actionOf(context) {
  for ( const o of listOf(context?.options) ) {
    const m = /^action:([a-z-]+)$/.exec(o);
    if ( m ) return m[1];
  }
  return typeof context?.action === "string" ? context.action : null;
}

/**
 * @param {ChatMessage[]} messages  the cards made during the turn, oldest first
 * @param {object} context          {tokenId, ids: {tokenId: battle id}}
 * @returns {object[]} engine log events (attack, control, talk, heal), each with `sure`
 */
export function readPf2eTurn(messages, { tokenId, ids = {} } = {}) {
  const events = [];
  const mine = m => {
    const c = m.flags?.pf2e?.context;
    return (c?.token && tokenIdOf(c.token) === tokenId) || m.speaker?.token === tokenId;
  };
  for ( const m of messages ) {
    try {
      const c = m.flags?.pf2e?.context;
      if ( !c || !mine(m) ) continue;
      const at = tokenIdOf(targetOf(m));
      const target = at && Object.hasOwn(ids, at) ? ids[at] : null;
      const roll = m.rolls?.[0] ?? null;
      const degree = Object.hasOwn(DEGREE, String(c.outcome)) ? DEGREE[c.outcome] : null;
      if ( c.type === "attack-roll" ) {
        if ( !target || degree === null ) continue;
        const melee = meleeOf(c);
        events.push({
          type: "attack", targetId: target, action: m.flags?.pf2e?.strike?.name ?? itemName(m) ?? c.title ?? "", degree, natural: naturalOf(roll), total: roll?.total ?? null,
          dc: c.dc?.value ?? null, margin: Number.isFinite(c.dc?.value) && Number.isFinite(roll?.total) ? roll.total - c.dc.value : 0,
          melee, ranged: !melee, launched: !melee && !listOf(c.traits).some(t => /^thrown/.test(t)), damage: 0, sure: true
        });
      } else if ( c.type === "damage-roll" ) {
        const total = Number(roll?.total) || 0;
        if ( heals(roll) ) {
          events.push({ type: "heal", targetId: target, action: itemName(m) ?? "", amount: total, sure: !!target });
          continue;
        }
        // (The Strike it's for: the last one at the same target that hit.)
        const strike = [...events].reverse().find(e => e.type === "attack" && (!target || e.targetId === target) && e.degree >= 2 && !e.damage);
        if ( strike ) {
          strike.damage = total;
          strike.damageType = roll?.instances?.[0]?.type ?? null;
          strike.crit = c.outcome === "criticalSuccess" || strike.degree === 3;
        } else if ( target && total > 0 ) {
          events.push({ type: "auto", targetId: target, action: itemName(m) ?? c.title ?? "", damage: total, damageType: roll?.instances?.[0]?.type ?? null, sure: false });
        }
      } else if ( c.type === "skill-check" ) {
        const slug = actionOf(c);
        const maneuver = MANEUVERS[slug];
        if ( maneuver && target && degree !== null ) {
          events.push({
            type: "control", targetId: target, action: c.title ?? slug, maneuver, took: degree >= 2, degree, roll: "check", natural: naturalOf(roll), total: roll?.total ?? null, sure: true
          });
          continue;
        }
        // (Words: whether it was talk at all, at whom and how well, the GM says. A roll with no DC has no outcome yet.)
        const skill = listOf(c.domains).find(d => typeof d === "string" && Object.hasOwn(TALK, d));
        if ( skill ) {
          events.push({ type: "talk", targetId: target, kind: TALK[skill], skill: c.title ?? skill, degree, natural: naturalOf(roll), total: roll?.total ?? null, dc: c.dc?.value ?? null, sure: false });
        }
      }
    } catch ( err ) {
      console.warn("FastFighting PF2e | a card of the turn couldn't be read", err);
    }
  }
  return events;
}

/**
 * A card that lowers the character's guard in a foe's reach (Reactive Strike's other triggers): a ranged attack, or
 * anything with the manipulate trait (a spell cast with its hands, a potion drawn and drunk).
 */
export function pf2eOpening(message, tokenId) {
  const f = message.flags?.pf2e ?? {};
  const c = f.context;
  const mine = (c?.token && tokenIdOf(c.token) === tokenId) || message.speaker?.token === tokenId;
  if ( !mine ) return false;
  if ( c?.type === "attack-roll" ) {
    return !meleeOf(c);
  }
  const list = v => (Array.isArray(v) ? v : []);
  const options = [...list(f.origin?.rollOptions), ...list(c?.options)];
  return options.some(o => /(^|:)trait:manipulate$/.test(String(o)));
}

/** The item a card came from, by its name, where the card says. */
function itemName(m) {
  const uuid = m.flags?.pf2e?.origin?.uuid;
  if ( !uuid ) return null;
  try {
    return fromUuidSync(uuid)?.name ?? null;
  } catch ( err ) {
    return null;
  }
}
