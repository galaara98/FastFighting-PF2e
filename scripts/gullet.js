/**
 * Swallow Whole and Engulf (a creature's abilities, by slug), played as the core's swallowed and engulfed (its
 * engine/conditions.js PROFILES: held inside, hurt each turn, let go of when the one holding it falls). Read from the
 * ability's line as the system writes it ("Huge, @Damage[(2d8+5)[bludgeoning]], Rupture 20"; "@Check[reflex|dc:22],
 * @Damage[(4d6)[acid]] damage, [[/act escape dc=22]], Rupture 15"), and played as the Monster Core's glossary has them:
 *  - Swallow Whole (one action, attack): an Athletics check against the Reflex DC of a creature it has grabbed, of the
 *    listed size or smaller. Swallowed, the creature is grabbed and slowed 1; it takes the listed damage at once and at
 *    the end of each of its turns; it can attack only the one that swallowed it (off-guard to it), with unarmed attacks
 *    or light weapons. It gets out by Escaping (the swallower's Athletics DC), or by cutting itself free: piercing or
 *    slashing damage of the Rupture value or more from one attack (any blow from inside, or a try at it in place of an
 *    Escape; the blow's damage dealt either way). Once it has swallowed a creature of the largest size it lists, it
 *    can't swallow another. Its swallower killed, the corpse has to be cut open: three actions by a friend beside it
 *    with a piercing or slashing blow, or it gets itself out as before (no more damage from a dead gullet).
 *  - Engulf (two actions): it Strides up to double its Speed, and each creature of its size or smaller in its path
 *    attempts a Reflex save against the listed DC; one that fails is engulfed: as swallowed, Escaping against the listed
 *    Escape DC.
 * The core keeps it where its holder is, and out of reach of everything outside. The rules (rules.js) play the rest:
 * conditionHarm, usable, canTarget, exposed, actionsLost, breakFree, afterHarm (Rupture), letGo and untieCost (the
 * corpse). Not played: holding its breath (and suffocating), a successful save's push aside, the engulfer's own move,
 * and the combined three actions of several friends at a corpse (one friend's three).
 * Pure, unit-tested.
 */
import { meanPart, localize } from "./core.js";
import { damageIn, saveIn } from "./abilities.js";
import { plain } from "./control.js";

/** The abilities, by slug, and the core's condition each lays. */
export const GULLETS = Object.freeze({ "swallow-whole": "swallowed", engulf: "engulfed" });

/** PF2e's sizes, smallest first, as the ability's line names them (the core's spec.size: 0 tiny ... 5 gargantuan). */
const SIZE_WORDS = Object.freeze(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/** How long it lasts: until it gets out, or the one holding it falls (in rounds, the fight). */
const INSIDE_ROUNDS = 100;

/** Damage types that cut a way out. */
const CUTS = new Set(["piercing", "slashing"]);

/** Is it a light enough attack to make from inside: an unarmed attack, a creature's own, or a weapon of light Bulk or less? */
export function lightStrike(item) {
  if ( !item ) return false;
  if ( item.type === "melee" || item.category === "unarmed" || (item.system?.traits?.value ?? []).includes("unarmed") ) return true;
  const bulk = Number(item.system?.bulk?.value);
  return Number.isFinite(bulk) && bulk <= 0.1;
}

/** The DC its Escape is against, where the line lists one ("[[/act escape dc=22]]", "Escape DC 22"), or null. */
function escapeDCIn(html) {
  const act = /\/act escape[^\]]*\bdc=(\d+)/i.exec(String(html ?? ""));
  if ( act ) return Number(act[1]);
  const words = /\bEscape DC (\d+)/i.exec(plain(html));
  return words ? Number(words[1]) : null;
}

/**
 * Swallow Whole or Engulf as the engine's control action, and what its gullet does (spec.gullet: the damage each turn
 * and the Rupture value), or null for any other ability or one it can't read.
 * @param {object} d
 * @param {string} d.id
 * @param {string} d.name
 * @param {string} d.slug
 * @param {string} d.html            its line, its formulas worked out
 * @param {string[]} [d.traits]
 * @param {number} [d.actions]       what it costs
 * @param {number} [d.athletics]     its Athletics modifier (Swallow Whole's check)
 * @param {number} [d.athleticsDC]   its Athletics DC (the Escape from its gullet)
 * @param {number} [d.size]          its own size (0 tiny ... 5 gargantuan): what it can engulf
 * @param {number} [d.speed]         its Speed (Engulf: double it)
 * @param {number} [d.reach]         its reach (Swallow Whole: one it holds in its jaws)
 * @returns {{action: object, gullet: {key, damage, rupture}}|null}
 */
export function gulletAction({ id, name, slug, html, traits = [], actions = null, athletics = null, athleticsDC = null, size = 2, speed = 25, reach = 5 }) {
  const key = GULLETS[slug];
  if ( !key ) return null;
  const text = plain(html);
  const damage = damageIn(html);
  const rupture = Number(/\bRupture\s*(\d+)/i.exec(text)?.[1]) || null;
  // (The core's own condition, by the core's word for it.)
  const label = localize(`FASTFIGHTING.Condition.${key}`).toLocaleLowerCase();
  if ( key === "swallowed" ) {
    const listed = SIZE_WORDS.indexOf(/^\s*(tiny|small|medium|large|huge|gargantuan)\b/i.exec(text)?.[1]?.toLowerCase());
    if ( !Number.isFinite(athletics) ) return null;
    const inside = { conditions: { swallowed: 1 }, rounds: INSIDE_ROUNDS, label, damage, escape: { key, dc: Number.isFinite(athleticsDC) ? athleticsDC : 10 + athletics, others: null } };
    return {
      action: {
        id, name, kind: "control", cost: Math.max(1, Math.min(3, Number(actions) || 1)), traits, ability: true, maneuver: "swallow", swallow: true,
        melee: true, reach: Math.max(5, Number(reach) || 5), ...(listed >= 0 ? { maxSize: listed } : {}),
        check: { mod: athletics, against: "reflex", attack: traits.includes("attack") }, onHit: [null, null, inside, inside]
      },
      gullet: { key, damage, rupture, most: listed >= 0 ? listed : null }
    };
  }
  const save = saveIn(html);
  if ( !save ) return null;
  const escape = escapeDCIn(html) ?? (Number.isFinite(athleticsDC) ? athleticsDC : save.dc);
  const inside = { conditions: { engulfed: 1 }, rounds: INSIDE_ROUNDS, label, damage, escape: { key, dc: escape, others: null } };
  const feet = 2 * Math.max(5, Number(speed) || 25);
  return {
    action: {
      id, name, kind: "control", cost: Math.max(1, Math.min(3, Number(actions) || 2)), traits, ability: true, maneuver: "engulf", engulf: true,
      melee: false, range: { increment: feet, max: feet, noPenalty: true }, maxSize: Number.isFinite(size) ? size : 2, area: { targets: 2 },
      save: { type: "reflex", dc: save.dc, basic: false }, onSave: [inside, inside, null, null]
    },
    gullet: { key, damage, rupture, most: null }
  };
}

/** Who holds it inside (swallowed it, engulfed it): that one's id, or null. */
export function holderId(u) {
  if ( !(Number(u?.conds?.swallowed) > 0 || Number(u?.conds?.engulfed) > 0) ) return null;
  const e = (u.effects ?? []).find(x => !x.onlyVs && x.sourceId && (Number(x.conditions?.swallowed) > 0 || Number(x.conditions?.engulfed) > 0));
  return e?.sourceId ?? null;
}

/** Is it holding inside it a creature of the largest size its Swallow Whole lists (so it can't swallow another)? */
export function full(run, u) {
  const most = u.spec?.gullet?.swallowed?.most;
  if ( !Number.isFinite(most) ) return false;
  return run.units.some(o => o !== u && Number(o.conds?.swallowed) > 0 && holderId(o) === u.id && Number(o.spec?.size ?? 2) >= most);
}

/** The chance a total of these parts (times `mult`) comes to at least `n`: the dice convolved, exactly. */
export function chanceAtLeast(parts, n, mult = 1) {
  let dist = new Map([[0, 1]]);
  let flat = 0;
  for ( const p of parts ) {
    flat += Number(p.flat) || 0;
    for ( const { n: count, faces, mult: m = 1 } of p.dice ?? [] ) {
      for ( let i = 0; i < Math.min(Math.abs(count), 40); i++ ) {
        const next = new Map();
        for ( const [sum, q] of dist ) for ( let r = 1; r <= faces; r++ ) next.set(sum + Math.sign(count) * r * m, (next.get(sum + Math.sign(count) * r * m) ?? 0) + q / faces);
        dist = next;
      }
    }
  }
  let p = 0;
  for ( const [sum, q] of dist ) if ( Math.floor((sum + flat) * mult) >= n ) p += q;
  return p;
}

/**
 * Its best way to cut itself free of `by` (a Strike it can make from inside with piercing or slashing damage): the
 * Strike and the parts that cut, or null. Best: the most cutting damage on the whole.
 */
export function cuttingStrike(u) {
  let best = null;
  for ( const a of u.spec?.actions ?? [] ) {
    if ( a.kind !== "strike" || !a.melee || !a.light || !Number.isFinite(a.bonus) ) continue;
    const parts = (a.damage ?? []).filter(p => CUTS.has(p.type) && !p.persistent);
    if ( !parts.length ) continue;
    const mean = parts.reduce((s, p) => s + meanPart(p), 0);
    if ( !best || mean > best.mean ) best = { strike: a, parts, mean };
  }
  return best;
}
