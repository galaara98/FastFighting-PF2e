/**
 * What martial classes do with their Strikes, recognised by slug: Vicious Swing (Power Attack before the remaster),
 * Double Slice, Sudden Charge, Flurry of Blows, and a ranger's Hunter's Edge (Flurry: a smaller multiple attack
 * penalty; Precision: extra precision damage on the first hit each turn). Built from the creature's own Strikes.
 * Pure, unit-tested.
 */
import { featureName } from "./words.js";
import { doubled } from "./core.js";

const meanDamage = parts => (parts ?? []).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0);
const score = s => (s.bonus ?? 0) + meanDamage(s.damage);
const best = list => [...list].sort((a, b) => score(b) - score(a))[0] ?? null;

/** n more of the weapon's own damage die (its first part's die, of its type). */
function weaponDice(strike, n) {
  const first = strike.damage?.[0];
  const faces = first?.dice?.[0]?.faces;
  if ( !faces ) return null;
  return { dice: [{ n, faces }], flat: 0, type: first.type, persistent: false, category: null };
}

/**
 * What `more` adds to `base` (damage parts as parsed): the extra dice, by size, and flat damage of each type. How a
 * class feature's damage is read off the system's own formula, with and without the roll option that turns it on
 * (Sneak Attack, Strategic Strike ...). Empty when it adds nothing.
 * @param {object[]} base
 * @param {object[]} more
 * @param {string|null} [category]  what the extra is ("precision")
 */
export function extraParts(base, more, category = null) {
  const key = p => `${p.type}|${p.persistent ? 1 : 0}`;
  const had = new Map();
  for ( const p of base ?? [] ) {
    const h = had.get(key(p)) ?? { dice: new Map(), flat: 0 };
    for ( const d of p.dice ?? [] ) h.dice.set(d.faces, (h.dice.get(d.faces) ?? 0) + d.n);
    h.flat += p.flat ?? 0;
    had.set(key(p), h);
  }
  const out = [];
  for ( const p of more ?? [] ) {
    const h = had.get(key(p)) ?? { dice: new Map(), flat: 0 };
    const dice = [];
    for ( const d of p.dice ?? [] ) {
      const left = h.dice.get(d.faces) ?? 0;
      const n = d.n - Math.min(left, d.n);
      h.dice.set(d.faces, Math.max(0, left - d.n));
      if ( n > 0 ) dice.push({ n, faces: d.faces, mult: 1 });
    }
    const flat = Math.max(0, (p.flat ?? 0) - h.flat);
    h.flat = Math.max(0, h.flat - (p.flat ?? 0));
    had.set(key(p), h);
    if ( dice.length || flat > 0 ) out.push({ dice, flat, type: p.type, persistent: !!p.persistent, category: category ?? p.category ?? null });
  }
  return out;
}

/**
 * @param {object} d
 * @param {string} d.actorId
 * @param {Set<string>} d.slugs     the slugs of its feats, features and actions
 * @param {number} d.level
 * @param {object[]} d.strikes      its Strikes, as engine actions
 * @returns {{actions: object[], strikes: object[]}}  new actions, and the Strikes as changed (Hunter's Edge)
 */
export function classActions({ actorId, slugs, level, strikes, names = {} }) {
  const out = [];
  const has = slug => slugs.has(slug);
  // (What the character calls it: a translated compendium's name, else the English.)
  const named = slug => featureName(names, slug);
  let changed = strikes;
  // Hunter's Edge: Flurry (a smaller multiple attack penalty) or Precision (extra precision damage once a turn).
  if ( has("hunt-prey") && has("flurry") ) {
    changed = changed.map(s => ({ ...s, maps: s.traits?.includes("agile") ? [0, -2, -4] : [0, -3, -6] }));
  }
  if ( has("hunt-prey") && has("precision") ) {
    const n = level >= 19 ? 3 : level >= 11 ? 2 : 1;
    changed = changed.map(s => ({ ...s, bonusDamage: [...(s.bonusDamage ?? []), { id: "hunters-precision", when: "always", oncePerTurn: true,
      parts: [{ dice: [{ n, faces: 8 }], flat: 0, type: s.damage?.[0]?.type ?? "untyped", persistent: false, category: "precision" }] }] }));
  }
  const melee = changed.filter(s => s.kind === "strike" && s.melee && s.damage?.length && !s.sequence);
  // Vicious Swing (Power Attack): two actions, an extra weapon die (two from 10th level, three from 18th), and it
  // counts as two attacks for the multiple attack penalty.
  const swing = has("vicious-swing") || has("power-attack") ? best(melee.filter(s => !s.traits?.includes("unarmed")).length ? melee.filter(s => !s.traits?.includes("unarmed")) : melee) : null;
  if ( swing ) {
    const extra = weaponDice(swing, level >= 18 ? 3 : level >= 10 ? 2 : 1);
    if ( extra ) out.push({ ...swing, id: `${swing.id}.vicious-swing`, name: `${has("vicious-swing") ? named("vicious-swing") : named("power-attack")} (${swing.name})`, cost: 2, attacks: 2,
      damage: [...swing.damage, extra], critDamage: swing.critDamage ? [...swing.critDamage, ...doubled([extra])] : null, classAction: "vicious-swing" });
  }
  // Double Slice: a Strike with each of two melee weapons, both at the current penalty.
  if ( has("double-slice") ) {
    const weapons = [];
    for ( const s of [...melee].filter(x => !x.traits?.includes("unarmed")).sort((a, b) => score(b) - score(a)) ) {
      if ( !weapons.some(w => w.name === s.name) ) weapons.push(s);
      if ( weapons.length === 2 ) break;
    }
    if ( weapons.length === 2 ) {
      out.push({ ...weapons[0], id: `${actorId}.double-slice`, name: named("double-slice"), cost: 2, reach: Math.min(weapons[0].reach ?? 5, weapons[1].reach ?? 5),
        sequence: weapons.map((w, i) => ({ ...w, id: `${actorId}.double-slice.${i}` })), sameMap: true, classAction: "double-slice" });
    }
  }
  // Sudden Charge: two Strides, then a Strike.
  if ( has("sudden-charge") && melee.length ) {
    const s = best(melee);
    out.push({ ...s, id: `${s.id}.sudden-charge`, name: `${named("sudden-charge")} (${s.name})`, cost: 2, charge: 2, classAction: "sudden-charge" });
  }
  // Flurry of Blows: two unarmed Strikes for one action, once a turn.
  if ( has("flurry-of-blows") ) {
    const unarmed = melee.filter(s => s.traits?.includes("unarmed"));
    const s = best(unarmed.length ? unarmed : melee);
    if ( s ) out.push({ ...s, id: `${s.id}.flurry-of-blows`, name: named("flurry-of-blows"), cost: 1, oncePerTurn: true,
      sequence: [0, 1].map(i => ({ ...s, id: `${s.id}.flurry-of-blows.${i}` })), classAction: "flurry-of-blows" });
  }
  return { actions: out, strikes: changed };
}
