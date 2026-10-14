/**
 * A player's turn in a live battle, read from the chat cards PF2e made for it (flags.pf2e.context): what FastFighting's
 * engine would have logged, so the turn is told like any other and the creatures it plays feel it.
 *   - A Strike (attack-roll): who, with what, how it went; its damage roll, the damage (the sheets settle how much).
 *   - A skill action at a creature (skill-check): Demoralize, Trip, Grapple, Shove, Disarm, Feint as maneuvers; a
 *     Diplomacy, Intimidation or Deception roll at it as words (the GM looks: was it talk?).
 *   - Healing (a damage roll of healing): told as healing (the sheets say how much).
 * Each event says whether it's `sure`; what isn't, the GM looks at before the turn is told.
 */

/** A PF2e degree of success as the engine counts it (0 critical failure ... 3 critical success). */
const DEGREE = { criticalFailure: 0, failure: 1, success: 2, criticalSuccess: 3 };

/** Skill actions that are maneuvers on the core's master list (story/master.js), by the action's slug. */
const MANEUVERS = { demoralize: "demoralize", trip: "trip", grapple: "grapple", shove: "shove", disarm: "disarm", feint: "feint", "create-a-diversion": "distract", reposition: "reposition" };
/** A skill rolled at a creature that is words, and which. */
const TALK = { diplomacy: "persuade", intimidation: "intimidate", deception: "deceive" };

/** The token id at the end of a token's uuid ("Scene.x.Token.y"), or the id itself. */
const tokenIdOf = ref => (typeof ref === "string" ? ref.split(".").pop() : null);

/** The natural die of a d20 check, where it shows. */
function naturalOf(roll) {
  const d20 = roll?.dice?.find?.(d => d.faces === 20);
  return d20?.total ?? d20?.results?.find?.(r => r.active)?.result ?? null;
}

/** The action a check was made for, by its slug (from its roll options: "action:demoralize"). */
function actionOf(context) {
  for ( const o of context?.options ?? [] ) {
    const m = /^action:([a-z-]+)$/.exec(o);
    if ( m ) return m[1];
  }
  return typeof context?.action === "string" ? context.action : null;
}

/**
 * @param {ChatMessage[]} messages  the cards made during the turn, oldest first
 * @param {object} context          {actorId, tokenId, ids: {tokenId: battle id}}
 * @returns {object[]} engine log events (attack, control, talk, heal), each with `sure`
 */
export function readPf2eTurn(messages, { tokenId, ids = {} } = {}) {
  const events = [];
  const mine = m => {
    const c = m.flags?.pf2e?.context;
    return (c?.token && tokenIdOf(c.token) === tokenId) || m.speaker?.token === tokenId;
  };
  for ( const m of messages ) {
    const c = m.flags?.pf2e?.context;
    if ( !c || !mine(m) ) continue;
    const target = ids[tokenIdOf(c.target?.token)] ?? null;
    const roll = m.rolls?.[0] ?? null;
    const degree = c.outcome in DEGREE ? DEGREE[c.outcome] : null;
    if ( c.type === "attack-roll" ) {
      if ( !target || degree === null ) continue;
      const melee = (c.options ?? []).includes("item:melee") || (c.domains ?? []).includes("melee-attack-roll") || (c.domains ?? []).includes("melee-strike-attack-roll");
      events.push({
        type: "attack", targetId: target, action: m.flags?.pf2e?.strike?.name ?? itemName(m) ?? c.title ?? "", degree, natural: naturalOf(roll), total: roll?.total ?? null,
        dc: c.dc?.value ?? null, margin: Number.isFinite(c.dc?.value) && Number.isFinite(roll?.total) ? roll.total - c.dc.value : 0,
        melee, ranged: !melee, launched: !melee && !(c.traits ?? []).some(t => /^thrown/.test(t)), damage: 0, sure: true
      });
    } else if ( c.type === "damage-roll" ) {
      const total = Number(roll?.total) || 0;
      const healing = roll?.kinds?.has?.("healing") || (roll?.instances ?? []).every?.(i => i.kinds?.has?.("healing")) && (roll?.instances ?? []).length > 0;
      if ( healing ) {
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
      const skill = (c.domains ?? []).find(d => d in TALK);
      if ( skill ) {
        events.push({ type: "talk", targetId: target, kind: TALK[skill], skill: c.title ?? skill, degree, natural: naturalOf(roll), total: roll?.total ?? null, dc: c.dc?.value ?? null, sure: false });
      }
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
    const melee = (c.options ?? []).includes("item:melee") || (c.domains ?? []).includes("melee-attack-roll") || (c.domains ?? []).includes("melee-strike-attack-roll");
    return !melee;
  }
  const options = [...(f.origin?.rollOptions ?? []), ...(c?.options ?? [])];
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
