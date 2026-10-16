/**
 * How many free hands an action needs (`hands` on every action the helper builds: what a creature held fast, its
 * hands tied, can still do). PF2e says it in its weapons' grips and its traits. Pure, unit-tested.
 *  - A Strike with a weapon: as it's held (its usage): one hand, or two; a weapon held in 1+ hands (a bow) needs both
 *    to shoot; one wielded two-handed for its two-hand trait, two; one worn (a glove), none.
 *  - An unarmed attack: none, but a grasping appendage (a fist, a claw: the system's graspingAppendage) needs its hand.
 *    A creature's attack goes by the weapon it's linked to; without one, it's its own body (a tail, a wing, a
 *    stinger), and needs no hands.
 *  - Anything else: one if it has the manipulate trait (a spell cast with gestures, drinking a potion, Exploit
 *    Vulnerability), none if not (a spell of words alone, a breath, a shout, Demoralize). A spell from before the
 *    remaster says it with its components instead: somatic or material, a hand.
 * Trip, Disarm, Grapple, Shove and Reposition say so in their requirements (a free hand): maneuvers.js gives them one.
 */

/** Hands a weapon's grip takes (its usage, as the system's own WeaponPF2e#hands reads it; "1+" shoots with both). */
const GRIP = Object.freeze({
  "held-in-one-hand": 1, "held-in-one-or-two-hands": 1, "held-in-one-plus-hands": 2, "held-in-two-hands": 2, worngloves: 0
});

/** Unarmed (its category, as the system works it out, or its trait). */
const unarmed = item => (item?.category ?? item?.system?.category) === "unarmed" || (item?.system?.traits?.value ?? []).includes("unarmed");

/** A fist or a claw: a hand, as the system has it (a weapon's graspingAppendage; a creature's attack by its base type). */
const grasping = item => !!item?.system?.graspingAppendage || ["fist", "claw"].includes(item?.baseType ?? item?.system?.baseItem ?? "");

/**
 * Free hands a Strike needs, from its item: a character's weapon, or a creature's attack (and the weapon behind it).
 * @param {object} item   the strike's item (strike.item, as the system lists its Strikes)
 * @returns {number}
 */
export function strikeHands(item) {
  if ( !item ) return 0;
  if ( unarmed(item) ) return grasping(item) ? 1 : 0;
  // (A creature's attack: its weapon's grip; with none, its own body.)
  const weapon = item.type === "melee" ? item.linkedWeapon ?? null : item;
  if ( !weapon ) return 0;
  if ( unarmed(weapon) ) return grasping(weapon) ? 1 : 0;
  const usage = String(weapon.system?.usage?.value ?? "held-in-one-hand").replace(/^worn-?gloves$/, "worngloves");
  const grip = GRIP[usage] ?? (/^worn/.test(usage) ? 0 : 1);
  // (Held in both hands for its two-hand trait: both.)
  return Math.max(grip, Number(weapon.system?.equipped?.handsHeld) >= 2 ? 2 : 0);
}

/**
 * Free hands anything else needs: one with the manipulate trait (or, before the remaster, a somatic or material
 * component), else none.
 * @param {string[]} [traits]
 * @param {object} [components]   a legacy spell's {somatic, material, verbal, focus}
 * @returns {number}
 */
export function traitHands(traits = [], components = null) {
  if ( (traits ?? []).includes("manipulate") ) return 1;
  return components?.somatic || components?.material ? 1 : 0;
}
