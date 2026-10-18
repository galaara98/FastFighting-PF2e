/**
 * Immunities, weaknesses and resistances as PF2e's own applyIWR applies them (pf2e.mjs, PF2e 8.6.1), to the engine's
 * damage (the core's rules.applyIwr, its ctx: what deals it). Pure: no Foundry globals.
 *
 * Each damage type a blow deals is one instance, as PF2e's are, and is tested with what deals it:
 *  - Unaffected (PF2e's isAffectedBy): vitality harms only a creature with void healing, void only one without it; a
 *    hazard, neither, unless it has a weakness or resistance to it.
 *  - Immune: none of that instance (its exceptions aside). Immunity to precision takes off the instance's precision
 *    part; immunity to critical hits is critImmune's (the core rolls a normal hit's damage for it).
 *  - Weakness: the highest that fits the instance, a precision weakness where it has precision, splash-damage where it
 *    has splash; a weakness PF2e applies once a blow (ONCE: holy, unholy, an element's, a tradition's, spells) once
 *    for the whole blow if any instance fits it.
 *  - Resistance: the highest that fits the instance and none of its exceptions, doubled where its doubleVs fits (a
 *    ghost's against non-magical damage); to precision, no more than the precision part; to critical hits, no more than
 *    what the critical added (half the instance). No more than what's left of it.
 * What a key fits: its damage type; "physical" and "energy"; "all-damage"; an area's damage ("area-damage"); a critical
 * hit; non-magical or magical damage; the action's traits (holy and unholy, an older item's good and evil read as
 * those; an element, a tradition); a spell's ("spells", "magic"); the materials it's made of (MATERIALS: a weakness to
 * cold iron is to sovereign steel too); a ghost-touch rune.
 */

/** Damage types grouped for IWR keys such as "physical" or "energy". */
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "bleed"]);
const ENERGY = new Set(["acid", "cold", "electricity", "fire", "sonic", "force", "vitality", "void"]);

/**
 * Weaknesses, resistances and immunities to what deals the damage, by its traits: the remaster's holy and unholy,
 * whatever the damage's type. An older item's alignment traits are read as the remaster has them (good holy, evil
 * unholy).
 */
export const TRAIT_IWR = Object.freeze({ holy: "holy", unholy: "unholy", good: "holy", evil: "unholy" });

/** Keys PF2e matches by an action's trait alone (its IWR's item:trait). */
const TRAIT_KEYS = new Set(["air", "alchemical", "earth", "light", "metal", "olfactory", "prediction", "radiation", "time", "visual", "water", "wood",
  "auditory", "arcane", "divine", "occult", "primal"]);

/**
 * Weaknesses PF2e applies once a blow, whichever of its instances fit (its applyOnce; less its weapon groups', which
 * no Strike here carries).
 */
const ONCE = new Set(["arcane", "divine", "occult", "primal", "air", "earth", "ghost-touch", "holy", "metal", "plant", "radiation", "salt-water", "salt",
  "spells", "unholy", "water", "wood"]);

/**
 * The materials PF2e counts as the one a weakness or a resistance names (its IWR's own): a weakness to cold iron is to
 * sovereign steel too, to silver to dawnsilver; a resistance's adamantine is keep-stone's too. Any other, itself.
 */
const MATERIALS = Object.freeze({
  weak: Object.freeze({ "cold-iron": ["cold-iron", "sovereign-steel"], silver: ["silver", "dawnsilver"] }),
  resist: Object.freeze({ adamantine: ["adamantine", "keep-stone"] })
});

/** The property runes PF2e's ghost-touch matches. */
const GHOST_TOUCH = new Set(["ghost-touch", "astral", "greater-astral"]);

/** Keys the generic match leaves to their own rule (precision and critical hits). */
const OWN_RULE = new Set(["precision", "critical-hits", "splash-damage"]);

/**
 * What deals an instance of damage, for its keys to be tested against: its type and the blow's ctx (the core's
 * iwrContext), with the target (for duskwood's peachwood: against the undead).
 */
function factsOf(type, ctx = {}, target = null) {
  const traits = new Set(ctx.traits ?? []);
  return {
    type,
    traits,
    materials: new Set(ctx.materials ?? []),
    runes: new Set(ctx.action?.propertyRunes ?? []),
    area: !!ctx.area,
    crit: !!ctx.crit,
    magical: !!ctx.magical || traits.has("magical"),
    spell: !!ctx.action?.spellId || traits.has("impulse"),
    undead: !!target?.spec?.creatureTraits?.includes?.("undead")
  };
}

/** Does `key` (a weakness's, a resistance's or an immunity's, or one of their exceptions) fit this instance? */
function fits(key, f, kind = "resist") {
  if ( key === f.type || key === "all-damage" ) return true;
  switch ( key ) {
    case "physical": return PHYSICAL.has(f.type);
    case "energy": return ENERGY.has(f.type);
    case "area-damage": return f.area;
    case "critical-hits": return f.crit;
    case "non-magical": return !f.magical;
    case "magical":
    case "item:magical": return f.magical;
    case "spells":
    case "magic":
    case "damage-from-spells": return f.spell;
    case "ghost-touch": return [...f.runes].some(r => GHOST_TOUCH.has(r));
    case "duskwood": return f.materials.has("duskwood") || (f.undead && f.materials.has("peachwood"));
    default: break;
  }
  if ( Object.values(TRAIT_IWR).includes(key) ) return [...f.traits].some(t => TRAIT_IWR[t] === key);
  if ( TRAIT_KEYS.has(key) ) return f.traits.has(key);
  const as = MATERIALS[kind === "weak" ? "weak" : "resist"][key] ?? [key];
  return as.some(m => f.materials.has(m));
}

/** Does an entry fit this instance, none of its exceptions fitting? */
function applies(iwr, kind, key, f) {
  if ( !fits(key, f, kind) ) return false;
  const except = iwr?.except?.[kind]?.[key] ?? [];
  return !except.some(x => fits(x, f, kind));
}

/**
 * Is the target untouched by this damage type (PF2e's isAffectedBy)? Vitality harms only a creature with void healing
 * (spec.voidHealing), void only one without; a hazard neither, unless it has a weakness or a resistance to it. With no
 * target known, it's touched.
 */
export function unaffected(type, target, iwr = target?.spec?.iwr) {
  if ( type !== "vitality" && type !== "void" ) return false;
  const spec = target?.spec;
  if ( !spec ) return false;
  if ( spec.hazard ) return !(Object.hasOwn(iwr?.weak ?? {}, type) || Object.hasOwn(iwr?.resist ?? {}, type));
  return type === "vitality" ? !spec.voidHealing : !!spec.voidHealing;
}

/**
 * Damage after immunities, weaknesses and resistances (the core's rules.applyIwr).
 * @param {object} iwr                      {immune: [keys], weak: {key: n}, resist: {key: n}, except: {immune|weak|
 *                                          resist: {key: [keys]}}, doubleVs: {key: [keys]}}
 * @param {Record<string, number>} byType   the blow's damage by type
 * @param {object} [target]                 the unit it lands on (its void healing; undead, for peachwood)
 * @param {object} [ctx]                    the core's iwrContext: traits, materials, magical, area, crit, byCategory, action
 * @returns {number}
 */
export function applyPf2eIwr(iwr, byType, target = null, ctx = {}) {
  const immune = iwr?.immune ?? [];
  const precisionImmune = immune.includes("precision");
  let total = 0;
  const dealt = [];
  for ( const [type, raw] of Object.entries(byType ?? {}) ) {
    if ( !(raw > 0) ) continue;
    const f = factsOf(type, ctx, target);
    dealt.push(f);
    if ( unaffected(type, target, iwr) ) continue;
    if ( immune.some(k => !OWN_RULE.has(k) && applies(iwr, "immune", k, f)) ) continue;
    const precision = Math.min(raw, Number(ctx.byCategory?.precision?.[type]) || 0);
    const splash = Number(ctx.byCategory?.splash?.[type]) || 0;
    let amount = raw - (precisionImmune ? precision : 0);
    if ( amount <= 0 ) continue;
    // The highest weakness that fits (once-a-blow ones aside), to its precision or its splash among them.
    let weak = 0;
    for ( const [k, v] of Object.entries(iwr?.weak ?? {}) ) {
      if ( ONCE.has(k) ) continue;
      const fit = k === "precision" ? precision > 0 && !precisionImmune : k === "splash-damage" ? splash > 0 : applies(iwr, "weak", k, f);
      if ( fit ) weak = Math.max(weak, Number(v) || 0);
    }
    amount += weak;
    // The highest resistance that fits, none of its exceptions fitting; doubled where its doubleVs fits; to precision,
    // no more than its precision; to critical hits, no more than what the critical added.
    let resist = 0;
    for ( const [k, v] of Object.entries(iwr?.resist ?? {}) ) {
      let value = Number(v) || 0;
      if ( k === "precision" ) value = precision > 0 && !precisionImmune ? Math.min(value, precision) : 0;
      else if ( k === "critical-hits" ) value = f.crit ? Math.min(value, Math.floor(raw / 2)) : 0;
      else if ( !applies(iwr, "resist", k, f) ) continue;
      else if ( (iwr?.doubleVs?.[k] ?? []).some(x => fits(x, f, "resist")) ) value *= 2;
      resist = Math.max(resist, value);
    }
    total += Math.max(0, amount - Math.min(amount, resist));
  }
  // Once a blow: each that fits any of its instances.
  for ( const [k, v] of Object.entries(iwr?.weak ?? {}) ) {
    if ( ONCE.has(k) && dealt.some(f => applies(iwr, "weak", k, f)) ) total += Number(v) || 0;
  }
  return Math.max(0, total);
}

/**
 * Is a critical hit by `action` a normal hit's damage to the target (the core's rules.critImmune: PF2e's immunity to
 * critical hits, unless one of its exceptions fits what the action deals)?
 */
export function critImmune(target, action) {
  const iwr = target?.iwr ?? target?.spec?.iwr;
  if ( !iwr?.immune?.includes("critical-hits") ) return false;
  const except = iwr.except?.immune?.["critical-hits"] ?? [];
  if ( !except.length ) return true;
  const ctx = { traits: action?.traits ?? [], materials: action?.materials ?? [], action, crit: true };
  return !(action?.damage ?? []).some(p => except.some(x => fits(x, factsOf(p.type, ctx, target))));
}

/**
 * Does a heal mend the target (PF2e's void healing)? Vitality healing mends only one without void healing, void
 * healing (Harm) only one with it; any other heal, anyone.
 */
export function healsIt(action, target) {
  const traits = action?.traits ?? [];
  if ( traits.includes("vitality") ) return !target?.spec?.voidHealing;
  if ( traits.includes("void") ) return !!target?.spec?.voidHealing;
  return true;
}
