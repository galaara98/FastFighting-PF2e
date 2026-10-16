/**
 * PF2e's skill actions in a fight, as the core's maneuvers (its engine/maneuvers.js, which the story tells by name):
 * each names its maneuver and says what it does at each degree in PF2e, from the one doing it (critical failure,
 * failure, success, critical success), in the system's words. Pure, unit-tested.
 *  - Shove (Athletics against Fortitude, an attack): pushed 5 feet away, 10 on a critical success; a critical failure,
 *    you fall prone. (Off a ledge, it falls: rules.fallDamage.)
 *  - Reposition (Athletics against Fortitude, an attack; the target in your reach): moved 5 feet, 10 on a critical
 *    success, wherever you like within your reach; a critical failure, it moves you 5 feet, as though it had
 *    Repositioned you.
 *  - Trip (Athletics against Reflex, an attack): prone, and 1d6 bludgeoning on a critical success; a critical failure,
 *    you fall prone.
 *  - Grapple (Athletics against Fortitude, an attack): grabbed (the core's grab, which an Escape against your Athletics
 *    DC breaks), restrained on a critical success, until about the end of your next turn; a critical failure, the foe
 *    grabs you (its choice, in the rules: that, or you fall prone).
 *  - Disarm (Athletics against Reflex, an attack; a foe with a weapon in hand): -2 to its attacks with it; on a critical
 *    success it drops it (disarmed: an action gone picking it up); a critical failure leaves you off-guard.
 *  - Feint (Deception against Perception, mental; in melee reach): off-guard to you for the rest of your turn; on a
 *    critical success, until the end of your next one.
 *  - Demoralize (Intimidation against Will, within 30 feet): frightened 1, 2 on a critical success; each foe once a
 *    fight (it's then immune to yours).
 * Those with the attack trait need a free hand, and a target no more than one size larger. Feint and Disarm are for
 * the trained, as in the rules; so, here, are the other Athletics ones (anyone may try them, in the rules).
 * A creature's Strike that lists Push or Pull (strikeMove): a Shove (a Reposition toward it, for Pull) after the hit,
 * played as the hit's own rider, as Grab and Knockdown are here.
 * Not played: a failed Grapple letting go of a foe you already held, a critically failed Feint (off-guard to that
 * foe alone, which the core can't lay on the one acting), Feint's off-guard only against melee and Disarm's -2 only
 * until the foe's turn, a weapon's shove, trip or disarm trait standing in for the free hand, the Stride after a
 * Shove, and Demoralize's -4 against a foe that doesn't share a language.
 */
import { parseFormula } from "./core.js";
import { t, actionName, conditionLabel } from "./words.js";

/** Demoralize's reach: 30 feet, no penalty for distance (its own, each time). */
const near = () => ({ melee: false, range: { increment: 30, max: 30, noPenalty: true } });

/**
 * The maneuvers a creature can try, as engine control actions.
 * @param {object} d
 * @param {string} d.actorId
 * @param {number} d.maxSize            the largest size it can Trip, Shove ... (its own, one up)
 * @param {number|null} [d.athletics]   its Athletics modifier, trained (null: not)
 * @param {number|null} [d.deception]   its Deception modifier, trained (null: not)
 * @param {number|null} [d.intimidation]  its Intimidation modifier (null: none at all)
 * @returns {object[]}
 */
export function skillManeuvers({ actorId, maxSize, athletics = null, deception = null, intimidation = null }) {
  const out = [];
  const prone = { conditions: { prone: 1 }, rounds: 1, label: conditionLabel("prone") };
  const fall = { ...prone, self: true };
  if ( intimidation !== null ) {
    out.push({ id: `${actorId}.demoralize`, name: actionName("Demoralize"), kind: "control", maneuver: "demoralize", cost: 1, traits: ["auditory", "concentrate", "emotion", "fear", "mental"], ...near(),
      check: { mod: intimidation, against: "will" }, oncePerTarget: true,
      onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: conditionLabel("frightened", 1) }, { conditions: { frightened: 2 }, rounds: 2, label: conditionLabel("frightened", 2) }] });
  }
  if ( athletics !== null ) {
    // (An attack, hand to hand: a free hand, a creature at most one size larger.)
    const grip = { kind: "control", cost: 1, traits: ["attack"], hands: 1, melee: true, reach: 5, maxSize };
    const vs = against => ({ check: { mod: athletics, against, attack: true } });
    // (Tripped hard: 1d6 bludgeoning as it lands, on a critical success only.)
    out.push({ id: `${actorId}.trip`, name: actionName("Trip"), maneuver: "trip", ...grip, ...vs("reflex"),
      onHit: [fall, null, prone, { ...prone, damage: [parseFormula("1d6", "bludgeoning")] }] });
    // (The core's grab, and the condition for a round: kept up by grappling again, as in the rules. Restrained the
    // same; one Escape breaks the lot: rules.js. Botched, the foe has hold of you: the core's, until you break it.)
    out.push({ id: `${actorId}.grapple`, name: actionName("Grapple"), maneuver: "grapple", ...grip, ...vs("fortitude"),
      onHit: [{ self: true, grab: true, label: conditionLabel("grabbed") }, null, { grab: true, conditions: { grabbed: 1 }, rounds: 1, label: conditionLabel("grabbed") },
        { grab: true, conditions: { restrained: 1 }, rounds: 1, label: conditionLabel("restrained") }] });
    // (Its grip loosened until its turn; knocked out of its hand, an action picking it up.)
    out.push({ id: `${actorId}.disarm`, name: actionName("Disarm"), maneuver: "disarm", ...grip, disarm: true, ...vs("reflex"),
      onHit: [{ conditions: { offGuard: 1 }, rounds: 1, self: true, label: conditionLabel("off-guard") }, null, { mods: { attack: -2 }, rounds: 1, label: t("Loosened") },
        { conditions: { disarmed: 1 }, mods: { attack: -2, actions: -1 }, rounds: 1, label: t("Dropped") }] });
    const pushed = feet => ({ move: { kind: "push", feet }, label: t("Pushed") });
    out.push({ id: `${actorId}.shove`, name: actionName("Shove"), maneuver: "shove", ...grip, ...vs("fortitude"), onHit: [fall, null, pushed(5), pushed(10)] });
    // (Botched, the foe moves you: 5 feet, within its reach.)
    const placed = (feet, extra = {}) => ({ move: { kind: "place", feet }, label: t("Repositioned"), ...extra });
    out.push({ id: `${actorId}.reposition`, name: actionName("Reposition"), maneuver: "reposition", ...grip, ...vs("fortitude"),
      onHit: [placed(5, { self: true }), null, placed(5), placed(10)] });
  }
  if ( deception !== null ) {
    // (Off-guard to you alone: for this turn's attacks; done well, your next turn's too.)
    const exposed = rounds => ({ conditions: { offGuard: 1 }, onlyVs: true, rounds, label: conditionLabel("off-guard") });
    out.push({ id: `${actorId}.feint`, name: actionName("Feint"), kind: "control", maneuver: "feint", cost: 1, traits: ["mental"], melee: true, reach: 5,
      check: { mod: deception, against: "perception" }, onHit: [null, null, exposed(1), exposed(2)] });
  }
  return out;
}

/**
 * A creature's forced movement on a hit, by an attack effect its Strike lists (the effect's slug): Push and Improved
 * Push (the monster attempts to Shove it; Improved Push as a free action), Push or Pull (pushed: it's the monster's
 * choice), and Pull (a Reposition toward it). As far as the ability lists, in its slug ("push-20-feet") or its English
 * name ("Push 10 feet", "Improved Push (20 Feet)": the system keeps the distance nowhere else), else the maneuver's 5
 * feet. The core plays it as the hit's rider (its simulator.js applyEffects): the Shove's own roll isn't played, nor
 * its 10 feet on a critical success.
 * @param {string} slug     the attack effect's slug
 * @param {string} [name]   the ability's name in English (the item the slug names), for the distance it lists
 * @returns {{kind: "move", move: {kind: "push"|"pull", feet: number}}|null}
 */
export function strikeMove(slug, name = "") {
  const m = /^(?:improved-)?(push-or-pull|push|pull)(?:-(\d+)-feet)?$/.exec(String(slug ?? ""));
  if ( !m ) return null;
  const listed = /(\d+)\s*(?:feet|foot|ft)\b/i.exec(String(name ?? ""));
  const feet = Number(m[2]) || Number(listed?.[1]) || 5;
  return { kind: "move", move: { kind: m[1] === "pull" ? "pull" : "push", feet } };
}
