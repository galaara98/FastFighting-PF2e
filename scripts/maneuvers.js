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
 *    DC breaks), restrained on a critical success, until the end of your next turn (the core's until: "source"); a
 *    critical failure, the foe grabs you (its choice, in the rules: that, or you fall prone).
 *  - Disarm (Athletics against Reflex, an attack; a foe with a weapon in hand): -2 to its attacks with it; on a critical
 *    success it drops it (disarmed: an action gone picking it up); a critical failure leaves you off-guard.
 *  - Feint (Deception against Perception, mental; in melee reach): off-guard to your next melee attack before the end of
 *    your turn (the core's onlyVs "melee", uses 1, until: "source"); on a critical success, to all your melee attacks
 *    until the end of your next turn.
 *  - Demoralize (Intimidation against Will, within 30 feet): frightened 1, 2 on a critical success; each foe once a
 *    fight (it's then immune to yours).
 * Those with the attack trait need a free hand, and a target no more than one size larger. Feint and Disarm are for
 * the trained, as in the rules; so, here, are the other Athletics ones (anyone may try them, in the rules).
 *
 * A creature's Strike that lists one of the Monster Core's attack effects (attackEffectOf, effectManeuver), as the
 * remaster's glossary has them: after a hit with that Strike, the creature attempts a maneuver at the one it hit, with
 * the body part it hit with (no hand needed), its Athletics against the maneuver's defense, neither taking nor adding to
 * its multiple attack penalty. Grab and Improved Grab a Grapple, Knockdown and Improved Knockdown a Trip, Push and
 * Improved Push a Shove (as far as it lists on a success), Pull a Reposition toward it (as far as it lists); Push or
 * Pull, its choice of either. The plain ones are an action straight after the hit (the core's requires.lastHit); the
 * Improved ones free, at once (a blow's maneuver rider). A Trip a Strike lists is PF2e's Trip action: the same after
 * the hit, but an attack like any Trip. In a live battle the ability's own card shows first (`card`).
 *  - An ability that tries maneuvers with a Strike instead of Athletics (strikeManeuvers: a ghostly guard's
 *    Ectoplasmic Maneuver, Disarm, Shove or Trip a foe within 15 feet with its ghostly rapier Strike): each maneuver its
 *    text links to PF2e's action for, the Strike's attack modifier against the maneuver's defense, an attack (the
 *    multiple attack penalty), as far as its text says ("within 15 feet"; else the Strike's reach), no hand needed.
 *  - Bon Mot (Diplomacy against Will, within 30 feet; with the feat): a -2 status penalty to Will saves and Perception
 *    (the core's bySave and byCheck) for a minute, -3 on a critical success; a critical failure, you take the -2.
 * A failed Grapple at a foe it holds already lets it go (the core's failLetsGo). Disarm's -2 lasts as long as the foe
 * keeps the weapon, until it spends an Interact changing its grip (rules.js remedies). Demoralize takes -4 against a
 * foe that doesn't share a language with it (rules.js check), unless the GM ignores languages.
 * Not played: a critically failed Feint (off-guard to that foe alone, which the core can't lay on the one acting),
 * retorting to a Bon Mot, a weapon's shove, trip or disarm trait standing in for the free hand, the Stride after a
 * Shove, and a body part holding a foe still striking.
 */
import { parseFormula } from "./core.js";
import { t, actionName, conditionLabel } from "./words.js";

/** How long a loosened grip lasts, in rounds, where nothing ends it sooner: a fight's whole length (a minute). */
export const LOOSENED_ROUNDS = 10;

/** Demoralize's reach: 30 feet, no penalty for distance (its own, each time). */
const near = () => ({ melee: false, range: { increment: 30, max: 30, noPenalty: true } });

const prone = () => ({ conditions: { prone: 1 }, rounds: 1, label: conditionLabel("prone") });
const fall = () => ({ ...prone(), self: true });
const pushed = feet => ({ move: { kind: "push", feet }, label: t("Pushed") });
const pulled = feet => ({ move: { kind: "pull", feet }, label: t("Repositioned") });
const placed = (feet, extra = {}) => ({ move: { kind: "place", feet }, label: t("Repositioned"), ...extra });
/** Grabbed or restrained until the end of the grabber's next turn (the core's grab with it; kept up by grappling again). */
const held = key => ({ grab: true, conditions: { [key]: 1 }, rounds: 1, until: "source", label: conditionLabel(key) });

/** Each maneuver by degree (critical failure, failure, success, critical success), from the one doing it. */
const DEGREES = Object.freeze({
  // (Tripped hard: 1d6 bludgeoning as it lands, on a critical success only.)
  trip: () => [fall(), null, prone(), { ...prone(), damage: [parseFormula("1d6", "bludgeoning")] }],
  // (Restrained the same; one Escape breaks the lot: rules.js. Botched, the foe has hold of you: the core's, until you
  // break it.)
  grapple: () => [{ self: true, grab: true, label: conditionLabel("grabbed") }, null, held("grabbed"), held("restrained")],
  shove: (feet = 5) => [fall(), null, pushed(feet), pushed(Math.max(10, feet))],
  // (Botched, the foe moves you: 5 feet, within its reach.)
  reposition: () => [placed(5, { self: true }), null, placed(5), placed(10)],
  // (Toward it: a Reposition that brings the foe in, PF2e's Pull.)
  drag: (feet = 5) => [placed(5, { self: true }), null, pulled(feet), pulled(Math.max(10, feet))],
  // (Its grip loosened for as long as it holds the weapon, until it changes its grip: an Interact, rules.js remedies;
  // knocked out of its hand, an action picking it up.)
  disarm: () => [{ conditions: { offGuard: 1 }, rounds: 1, self: true, label: conditionLabel("off-guard") }, null, { mods: { attack: -2 }, rounds: LOOSENED_ROUNDS, label: t("Loosened") },
    { conditions: { disarmed: 1 }, mods: { attack: -2, actions: -1 }, rounds: 1, label: t("Dropped") }]
});

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
  if ( intimidation !== null ) {
    out.push({ id: `${actorId}.demoralize`, name: actionName("Demoralize"), kind: "control", maneuver: "demoralize", cost: 1, traits: ["auditory", "concentrate", "emotion", "fear", "mental"], ...near(),
      check: { mod: intimidation, against: "will" }, oncePerTarget: true,
      onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: conditionLabel("frightened", 1) }, { conditions: { frightened: 2 }, rounds: 2, label: conditionLabel("frightened", 2) }] });
  }
  if ( athletics !== null ) {
    // (An attack, hand to hand: a free hand, a creature at most one size larger.)
    const grip = { kind: "control", cost: 1, traits: ["attack"], hands: 1, melee: true, reach: 5, maxSize };
    const vs = against => ({ check: { mod: athletics, against, attack: true } });
    out.push({ id: `${actorId}.trip`, name: actionName("Trip"), maneuver: "trip", ...grip, ...vs("reflex"), onHit: DEGREES.trip() });
    // (Failed, it lets go of a foe it held already: failLetsGo, the core's.)
    out.push({ id: `${actorId}.grapple`, name: actionName("Grapple"), maneuver: "grapple", ...grip, ...vs("fortitude"), failLetsGo: true, onHit: DEGREES.grapple() });
    out.push({ id: `${actorId}.disarm`, name: actionName("Disarm"), maneuver: "disarm", ...grip, disarm: true, ...vs("reflex"), onHit: DEGREES.disarm() });
    out.push({ id: `${actorId}.shove`, name: actionName("Shove"), maneuver: "shove", ...grip, ...vs("fortitude"), onHit: DEGREES.shove() });
    out.push({ id: `${actorId}.reposition`, name: actionName("Reposition"), maneuver: "reposition", ...grip, ...vs("fortitude"), onHit: DEGREES.reposition() });
  }
  if ( deception !== null ) {
    // (Off-guard to your melee attacks alone, to the end of your turns: on a success, the next one before this turn
    // ends; done well, every one until the end of your next turn.)
    const exposed = extra => ({ conditions: { offGuard: 1 }, onlyVs: "melee", until: "source", rounds: 1, label: conditionLabel("off-guard"), ...extra });
    out.push({ id: `${actorId}.feint`, name: actionName("Feint"), kind: "control", maneuver: "feint", cost: 1, traits: ["mental"], melee: true, reach: 5,
      check: { mod: deception, against: "perception" }, onHit: [null, null, exposed({ uses: 1, thisTurn: true }), exposed()] });
  }
  return out;
}

/**
 * Bon Mot, as a control action: Diplomacy against the foe's Will DC, within 30 feet; a status penalty to its Will saves
 * and Perception (the core's bySave and byCheck) for a minute, -2, -3 on a critical success; a critical failure, the
 * same -2 on you.
 * @param {object} d
 * @param {string} d.id         `<actor id>.bon-mot`
 * @param {string} d.name
 * @param {number} d.diplomacy  its Diplomacy modifier
 */
export function bonMot({ id, name, diplomacy }) {
  const jab = n => ({ mods: { bySave: { will: -n }, byCheck: { perception: -n } }, rounds: 10, label: t("Flustered") });
  return { id, name, kind: "control", cost: 1, special: true, maneuver: "distract", traits: ["auditory", "concentrate", "emotion", "linguistic", "mental"], ...near(),
    check: { mod: Number(diplomacy) || 0, against: "will" }, onHit: [{ ...jab(2), self: true }, null, jab(2), jab(3)] };
}

/** The maneuvers (the core's maneuver, PF2e's action, the defense it's against). */
const GRAPPLE = Object.freeze({ maneuver: "grapple", action: "grapple", against: "fortitude" });
const TRIP = Object.freeze({ maneuver: "trip", action: "trip", against: "reflex" });
const SHOVE = Object.freeze({ maneuver: "shove", action: "shove", against: "fortitude" });
const DRAG = Object.freeze({ maneuver: "drag", action: "reposition", against: "fortitude" });

/**
 * The attack effects that try a maneuver, by slug (a distance after it, "-20-feet", or not): the glossary's, a listed
 * Trip, and Push or Pull. `free`: an Improved one; `attack`: PF2e's Trip action itself.
 */
const EFFECT_MANEUVERS = Object.freeze({
  grab: { maneuvers: [GRAPPLE] },
  "improved-grab": { free: true, maneuvers: [GRAPPLE] },
  knockdown: { maneuvers: [TRIP] },
  "improved-knockdown": { free: true, maneuvers: [TRIP] },
  trip: { attack: true, maneuvers: [TRIP] },
  push: { maneuvers: [SHOVE] },
  "improved-push": { free: true, maneuvers: [SHOVE] },
  pull: { maneuvers: [DRAG] },
  "push-or-pull": { maneuvers: [SHOVE, DRAG] }
});

/** An attack effect's slug: what it is, and the distance after it, if any ("push-20-feet"). */
const EFFECT_SLUG = /^(.+?)(?:-(\d+)-feet)?$/;

/**
 * What an attack effect does after a hit, by its slug: {free, attack, feet, maneuvers: [{maneuver, action, against}]},
 * or null for one that tries no maneuver. `free`: an Improved one, at once and free; else an action after the hit.
 * `attack`: a listed Trip, PF2e's Trip action, which takes and adds to the multiple attack penalty (the glossary's
 * don't). `feet`: as far as it lists, in its slug ("push-20-feet") or its English name ("Push 10 feet", "Improved
 * Push (20 Feet)": the system keeps the distance nowhere else), else null (the maneuver's own).
 * @param {string} slug     the attack effect's slug
 * @param {string} [name]   the ability's name in English (the item the slug names), for the distance it lists
 */
export function attackEffectOf(slug, name = "") {
  const m = EFFECT_SLUG.exec(String(slug ?? ""));
  const known = m && Object.hasOwn(EFFECT_MANEUVERS, m[1]) ? EFFECT_MANEUVERS[m[1]] : null;
  if ( !known ) return null;
  const listed = /(\d+)\s*(?:feet|foot|ft)\b/i.exec(String(name ?? ""));
  return { free: !!known.free, attack: !!known.attack, feet: Number(m[2]) || Number(listed?.[1]) || null, maneuvers: [...known.maneuvers] };
}

/**
 * One of an attack effect's maneuvers as an engine control action: the creature's Athletics against the target's
 * defense, no hand needed (the body part it hit with), a target no more than one size larger; by degree as the
 * maneuver's. Its id ends in PF2e's action (`<key>.grapple`: check-roll.js rolls PF2e's own Grapple), and its own card
 * shows first in a live battle (`card`: the ability's, action-roll.js).
 * @param {object} d
 * @param {string} d.id          `<actor id>.<the ability's item id, else the effect's slug>`
 * @param {string} d.name
 * @param {{maneuver: string, action: string, against: string}} d.how   one of attackEffectOf's maneuvers
 * @param {number|null} [d.feet] as far as it lists (a Shove's or a Pull's success)
 * @param {boolean} [d.attack]   an attack, for the multiple attack penalty (a listed Trip)
 * @param {number} d.athletics   its Athletics modifier
 * @param {number} d.maxSize     the largest size it can try it on (its own, one up)
 * @param {number} [d.reach]     the reach of the Strikes that list it
 * @param {number} [d.cost]      1 (an action after the hit), 0 (free: an Improved one's)
 */
export function effectManeuver({ id, name, how, feet = null, attack = false, athletics, maxSize, reach = 5, cost = 1 }) {
  const degrees = how.maneuver === "shove" || how.maneuver === "drag" ? DEGREES[how.maneuver](feet ?? 5) : DEGREES[how.maneuver]();
  return {
    id: `${id}.${how.action}`, name, kind: "control", maneuver: how.maneuver, cost, traits: ["attack"], hands: 0, melee: true, reach, maxSize,
    check: { mod: Number(athletics) || 0, against: how.against, ...(attack ? { attack: true } : {}) }, onHit: degrees, card: true
  };
}

/**
 * Grab used on a creature it holds instead (Grab's and Improved Grab's other use, an action): its grab, or the
 * restraint it laid, kept up to the end of its next turn (the core's renew), no roll; only on one it holds.
 * @param {object} d
 * @param {string} d.id     `<actor id>.<the ability's item id, else the effect's slug>`
 * @param {string} d.name
 * @param {number} [d.reach]
 */
export function keepHold({ id, name, reach = 5 }) {
  return {
    id: `${id}.keep`, name, kind: "control", maneuver: "grapple", cost: 1, auto: true, traits: [], hands: 0, melee: true, reach,
    requires: { holding: true }, outcome: { renew: true, rounds: 1, label: t("HoldKept") }, card: true
  };
}

/** PF2e's maneuver actions by their id in its actions compendium (pf2e.actionspf2e): what an ability's text links. */
const LINKED_MANEUVERS = Object.freeze({
  __proto__: null,
  ge56Lu1xXVFYUnLP: { maneuver: "trip", against: "reflex" },
  Dt6B1slsBy8ipJu9: { maneuver: "disarm", against: "reflex" },
  "7blmbDrQFNfdT731": { maneuver: "shove", against: "fortitude" },
  PMbdMWc2QroouFGD: { maneuver: "grapple", against: "fortitude" },
  lOE4yjUnETTdaf2T: { maneuver: "reposition", against: "fortitude" }
});

/** The maneuver a link names (a uuid to PF2e's action, by its compendium id), or null. */
const linkedManeuver = uuid => {
  const m = /^Compendium\.pf2e\.actionspf2e\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? LINKED_MANEUVERS[m[1]] ?? null : null;
};

/**
 * An ability that tries maneuvers with one of its Strikes instead of Athletics, as engine control actions: one for each
 * maneuver its text links to PF2e's action for (in order, each once), when its text (in English) says a Strike makes the
 * roll and asks for no check of its own. The Strike its text names (its name in the text), else its best melee one.
 * Each: the Strike's attack modifier against the maneuver's defense, an attack (the multiple attack penalty), as far as
 * the text says ("within 15 feet"), else the Strike's reach; no hand needed (it tries it with what the ability says);
 * a target no more than one size larger, as the maneuver's; by degree as the maneuver's. Named for the ability, and the
 * maneuver too where it links more than one. Its id ends in `<maneuver>-strike`, and `strike` names the Strike (its
 * slug): in a live battle check-roll.js rolls PF2e's own action, with the Strike's modifier in place of Athletics, after
 * the ability's own card (`card`).
 * @param {object} d
 * @param {string} d.id          `<actor id>.<the ability's item id>`
 * @param {string} d.name        the ability's
 * @param {string} d.text        its description in English, as plain text
 * @param {string[]} d.links     the uuids its description links (granted.js linksIn)
 * @param {boolean} [d.checks]   its description asks for a check of its own (an @Check): not this
 * @param {object[]} d.strikes   its Strikes, as engine actions (name, bonus, reach, melee)
 * @param {number} d.cost        its actions
 * @param {string[]} [d.traits]  its traits
 * @param {number} d.maxSize     the largest size it can try them on (its own, one up)
 * @param {(maneuver: string) => string} d.maneuverName   PF2e's name for a maneuver
 * @param {(effect: string, maneuver: string) => string} d.named   the ability and the maneuver, as one name
 * @returns {object[]}
 */
export function strikeManeuvers({ id, name, text, links, checks = false, strikes, cost, traits = [], maxSize, maneuverName, named }) {
  if ( checks || !/\bStrike\b/.test(String(text ?? "")) ) return [];
  const tries = [];
  for ( const uuid of links ?? [] ) {
    const how = linkedManeuver(uuid);
    if ( how && !tries.some(x => x.maneuver === how.maneuver) ) tries.push(how);
  }
  if ( !tries.length ) return [];
  const lower = String(text).toLowerCase();
  const melee = (strikes ?? []).filter(s => s.kind === "strike" && s.melee !== false && Number.isFinite(Number(s.bonus)));
  const strike = melee.find(s => s.name && lower.includes(String(s.name).toLowerCase()))
    ?? [...melee].sort((a, b) => Number(b.bonus) - Number(a.bonus))[0];
  if ( !strike ) return [];
  const within = /\bwithin\s+(\d+)\s*(?:feet|foot|ft)\b/i.exec(String(text));
  const reach = Number(within?.[1]) || Number(strike.reach) || 5;
  return tries.map(how => ({
    id: `${id}.${how.maneuver}-strike`, name: tries.length > 1 ? named(name, maneuverName(how.maneuver)) : name, kind: "control", maneuver: how.maneuver,
    cost: Number(cost) || 1, traits: traits.includes("attack") ? [...traits] : [...traits, "attack"], hands: 0, melee: true, reach, maxSize,
    ...(how.maneuver === "disarm" ? { disarm: true } : {}), ...(how.maneuver === "grapple" ? { failLetsGo: true } : {}),
    check: { mod: Number(strike.bonus), against: how.against, attack: true }, strike: strike.slug ?? null, onHit: DEGREES[how.maneuver](), card: true
  }));
}
