/**
 * PF2e personality defaults. Every number here is a starting point the GM can fudge.
 * Inputs are plain values so this stays testable without Foundry.
 *
 * A player character starts as the usual hero (the core's PC_BASELINE) and everything on its sheet moves it a little,
 * each part shown in the trait's reason: its Intelligence and Wisdom, its level, its Will for its level and its
 * Constitution, its class, ancestry and background, holy or unholy, its feats and features (read by what their rules
 * do: a better save against fear makes a bolder one, a bonus to Aid a more loyal one; a few without rules by slug), its
 * skills, its Perception, and whether it's in a party.
 * Anyone else is read from what it is: its Intelligence and Wisdom, its Will for its level, its creature traits.
 */
import { clamp, listItems, traitsFromParts, PC_BASELINE, TRAITS } from "./core.js";
import { t, traitName } from "./words.js";

const SELFISH_BY_TRAIT = {
  demon: 85, fiend: 70, daemon: 80, devil: 55, undead: 60, aberration: 60, dragon: 70, giant: 50,
  goblin: 55, kobold: 50, orc: 45, animal: 50, beast: 50, celestial: 15, angel: 10, archon: 15,
  minion: 10, construct: 5, mindless: 0
};

/** How a creature trait moves a creature's loyalty (the strongest one counts): a devil's hierarchy, a demon's chaos. */
const LOYAL_BY_TRAIT = {
  devil: 12, archon: 12, angel: 8, celestial: 8, hobgoblin: 10, kobold: 5, troop: 10,
  demon: -15, daemon: -10, dragon: -8, fey: -6, goblin: -4, aberration: -6
};

/** Holy and unholy (a sanctified character or creature): how they move its selfishness and loyalty. */
const SANCTIFIED = { holy: { selfish: -6, loyal: 3 }, unholy: { selfish: 10, loyal: -4 } };

/** What a class leans toward (Player Core 1 and 2 and the rest), by slug. Its numbers count for themselves. */
const CLASS_LEANS = Object.freeze({
  barbarian: { brave: 5, tactical: -4 }, champion: { brave: 4, selfish: -8, loyal: 5 }, cleric: { selfish: -4, loyal: 2 },
  commander: { tactical: 6, loyal: 4 }, exemplar: { brave: 4 }, fighter: { brave: 2 }, guardian: { brave: 4, selfish: -5, loyal: 4 },
  investigator: { tactical: 6 }, inventor: { tactical: 2 }, alchemist: { tactical: 2 }, rogue: { selfish: 3 },
  swashbuckler: { brave: 4, tactical: -2 }, ranger: { tactical: 2 }, bard: { loyal: 2 }, monk: { brave: 2 },
  thaumaturge: { brave: 2 }, gunslinger: { tactical: 2 }
});

/** What an ancestry leans toward, only where its own abilities say so (an orc's ferocity, a kobold's caution). */
const ANCESTRY_LEANS = Object.freeze({
  orc: { brave: 4 }, goblin: { brave: 2, tactical: -2 }, kobold: { brave: -4, tactical: 2 }, dwarf: { loyal: 3 }
});

/** What a background leans toward (Player Core's), by slug. */
const BACKGROUND_LEANS = Object.freeze({
  acolyte: { selfish: -5, loyal: 3 }, barrister: { tactical: 3 }, "bounty-hunter": { selfish: 4, brave: 2 }, bandit: { selfish: 6, loyal: -3 },
  charlatan: { selfish: 6, loyal: -5 }, criminal: { selfish: 6, loyal: -4 }, cultist: { loyal: 4 }, detective: { tactical: 4 },
  emissary: { loyal: 3, tactical: 2 }, "field-medic": { selfish: -6, brave: 2 }, gambler: { selfish: 4, brave: 2, tactical: -2 },
  gladiator: { brave: 5 }, guard: { loyal: 5, brave: 2 }, hermit: { loyal: -4 }, insurgent: { brave: 3, loyal: -3 },
  "martial-disciple": { brave: 3, tactical: 2 }, merchant: { selfish: 4 }, noble: { selfish: 3 }, royalty: { selfish: 3 },
  prisoner: { selfish: 3, loyal: -3 }, saboteur: { tactical: 2, loyal: -2 }, scholar: { tactical: 4 }, scout: { tactical: 2 },
  squire: { loyal: 5, brave: 2 }, "street-urchin": { selfish: 5, loyal: -2 }, "tax-collector": { selfish: 4 },
  teacher: { selfish: -3 }, warrior: { brave: 4, tactical: 2 }, refugee: { brave: -3 }, servant: { loyal: 3 }, outrider: { tactical: 2 }
});

/** Skills that say something of who it is (once trained; more at master), by slug. */
const SKILL_LEANS = Object.freeze({
  "warfare-lore": { tactical: 3 }, thievery: { selfish: 2 }, "underworld-lore": { selfish: 2 }, deception: { selfish: 1, loyal: -1 },
  medicine: { selfish: -2 }, diplomacy: { loyal: 1 }, intimidation: { brave: 1 }
});

/** Feats and features that say something but have no rules to read (Player Core's), by slug. */
const ITEM_LEANS = Object.freeze({
  "aura-of-courage": { brave: 6 }, "orc-ferocity": { brave: 3 }, "reckless-abandon": { brave: 4, tactical: -2 }, "battle-medicine": { selfish: -2 }
});

const FEARS = /fear|emotion|despair|frighten/;

/**
 * What an item's rules say of who has it: a better save against fear (a bolder one), against being controlled (one
 * harder to order around), a bonus to Aid (a more loyal, less selfish one), immunity to being frightened.
 * @param {object[]} rules   the item's rule elements
 * @returns {{brave?: number, loyal?: number, selfish?: number}}
 */
export function ruleLeans(rules = []) {
  const out = {};
  const add = (k, n) => { out[k] = (out[k] ?? 0) + n; };
  for ( const r of rules ?? [] ) {
    if ( !r || typeof r !== "object" ) continue;
    const when = JSON.stringify(r.predicate ?? []).toLowerCase();
    const selector = [r.selector ?? []].flat().join(" ");
    const onSave = /will|saving-throw/.test(selector);
    if ( r.key === "Immunity" && FEARS.test(JSON.stringify(r.type ?? "")) ) add("brave", 10);
    else if ( r.key === "AdjustDegreeOfSuccess" && onSave ) {
      if ( FEARS.test(when) ) add("brave", 6);
      else if ( /controlled|mental/.test(when) ) { add("brave", 2); if ( /controlled/.test(when) ) add("loyal", -3); }
      else if ( when === "[]" && /will/.test(selector) ) add("brave", 3);
    } else if ( r.key === "FlatModifier" && onSave && FEARS.test(when) ) add("brave", Math.min(4, 2 * Math.abs(Number(r.value) || 1)));
    if ( /action:aid/.test(when) ) { add("loyal", 3); add("selfish", -2); }
  }
  for ( const k of Object.keys(out) ) out[k] = clamp(out[k], -10, 10);
  return out;
}

/** The creature types PF2e files creatures under (a creature can have more than one). */
const CREATURE_TYPES = new Set(["aberration", "animal", "astral", "beast", "celestial", "construct", "dragon", "dream", "elemental",
  "ethereal", "fey", "fiend", "fungus", "giant", "humanoid", "monitor", "ooze", "petitioner", "plant", "spirit", "time", "undead"]);

/**
 * What kind of creature, for grouping neutrals: its ancestry if it has one (goblin, human, kobold), else its creature
 * types (animal; dragon and elemental).
 * @param {string[]} traits
 * @param {Iterable<string>} [ancestries]  the system's ancestry traits (CONFIG.PF2E.ancestryTraits)
 * @returns {string|null}
 */
export function creatureKindOf(traits = [], ancestries = []) {
  const known = new Set(ancestries);
  const ancestry = traits.find(t => known.has(t) && !CREATURE_TYPES.has(t));
  if ( ancestry ) return ancestry;
  const types = traits.filter(t => CREATURE_TYPES.has(t)).sort();
  return types.length ? types.join(":") : null;
}

/** Expected Will modifier for a creature of `level` (moderate PF2e NPC guideline). */
function expectedWill(level) {
  return Math.round(level * 1.15 + 5);
}

/** The usual player character's Will at a level: trained or expert, Wisdom +1 or +2. */
const usualPcWill = level => level + 5;

const signed = n => `${n >= 0 ? "+" : ""}${n}`;

/** Parts from a table's leaning ({trait: n}), with the reason they're shown with. */
const partsOf = (lean, why, scale = 1) => Object.entries(lean ?? {}).map(([trait, n]) => ({ trait, n: n * scale, why }));

/**
 * A player character's parts: everything on its sheet that moves it from the usual hero.
 * @param {object} d   see derivePf2eTraits
 */
function pcParts(d) {
  const names = d.names ?? {};
  const ability = k => names.abilities?.[k] ?? k;
  const level = Number(d.level) || 0;
  const parts = [];
  const add = (trait, n, why) => parts.push({ trait, n, why });
  const mod = k => Number(d[k]) || 0;

  // A good head: Intelligence above all, Wisdom (awareness) too; and experience.
  add("tactical", (mod("int") - 1) * 4, t("Reason.Ability", { name: ability("int"), n: signed(mod("int")) }));
  add("tactical", (mod("wis") - 1) * 2, t("Reason.Ability", { name: ability("wis"), n: signed(mod("wis")) }));
  add("tactical", (level - 5) * 0.5, t("Reason.Level", { n: level }));
  if ( Number(d.perception) >= 2 ) add("tactical", (Number(d.perception) - 1) * 2, t("Reason.Proficient", { name: names.perception ?? "", rank: names.ranks?.[d.perception] ?? d.perception }));

  // Nerve: its Will against the usual hero's at its level, and its toughness.
  if ( Number.isFinite(d.will) ) {
    const delta = d.will - usualPcWill(level);
    add("brave", delta * 3, t("Reason.Will", { n: signed(delta) }));
  }
  add("brave", (mod("con") - 1) * 1.5, t("Reason.Ability", { name: ability("con"), n: signed(mod("con")) }));

  // Who it is: class, ancestry, background, holy or unholy.
  parts.push(...partsOf(CLASS_LEANS[d.cls], names.cls ?? d.cls));
  parts.push(...partsOf(ANCESTRY_LEANS[d.ancestry], names.ancestry ?? d.ancestry));
  parts.push(...partsOf(BACKGROUND_LEANS[d.background], names.background ?? d.background));
  for ( const s of ["holy", "unholy"] ) if ( (d.traits ?? []).includes(s) ) parts.push(...partsOf(SANCTIFIED[s], traitName(s)));

  // What it's learned to do: its feats and features, its skills.
  for ( const item of d.items ?? [] ) {
    const lean = { ...ruleLeans(item.rules) };
    for ( const [k, n] of Object.entries(ITEM_LEANS[item.slug] ?? {}) ) lean[k] = (lean[k] ?? 0) + n;
    parts.push(...partsOf(lean, item.name ?? item.slug));
  }
  for ( const [slug, rank] of Object.entries(d.skills ?? {}) ) {
    if ( !(rank >= 1) || !SKILL_LEANS[slug] ) continue;
    parts.push(...partsOf(SKILL_LEANS[slug], names.skills?.[slug] ?? slug, rank >= 3 ? 1.5 : 1));
  }

  // Its friends: one who isn't in a party is less bound to the others.
  if ( d.inParty === false ) add("loyal", -10, t("Reason.NoParty"));
  return parts;
}

/** A trait's reason with more after it (the parts that moved it). */
const joinReasons = (first, more) => Object.fromEntries(TRAITS.map(k => [k, listItems([first[k], more[k]].filter(Boolean))]));

/**
 * @param {object} d
 * @param {string} d.type        "character" | "npc" | "familiar" | ...
 * @param {number} d.level
 * @param {string[]} d.traits
 * @param {number} d.int         Intelligence modifier
 * @param {number} d.wis         Wisdom modifier
 * @param {number} [d.con]       Constitution modifier (a player character's)
 * @param {number} d.will        Will save modifier
 * @param {string[]} d.abilities Slugs of the actor's actions/feats (pack-attack, sneak-attack, ...)
 * @param {boolean} d.hasMaster
 * @param {{slug, name, rules}[]} [d.items]  its feats, features and actions, with their rule elements
 * A player character's own:
 * @param {string} [d.cls]  @param {string} [d.ancestry]  @param {string} [d.background]   slugs
 * @param {Record<string, number>} [d.skills]   skill slug: proficiency rank (0-4)
 * @param {number} [d.perception]   its Perception rank
 * @param {boolean} [d.inParty]
 * @param {object} [d.names]   the words shown: {abilities: {int, wis, con}, cls, ancestry, background, perception, ranks: [..], skills: {slug: label}}
 */
export function derivePf2eTraits(d) {
  const traits = new Set(d.traits ?? []);
  const abilities = new Set(d.abilities ?? []);
  const reasons = {};
  const flags = {};
  const pc = d.type === "character" && !traits.has("minion");

  if ( abilities.has("pack-attack") || abilities.has("pack-tactics") ) flags.packTactics = true;
  if ( abilities.has("sneak-attack") ) flags.sneakAttack = true;
  // Not everyone can punish a foe for moving: only those with Reactive Strike (Attack of Opportunity, before the remaster).
  if ( abilities.has("reactive-strike") || abilities.has("attack-of-opportunity") ) flags.reactiveStrike = true;

  if ( pc && !traits.has("mindless") ) {
    const built = traitsFromParts(PC_BASELINE, pcParts(d), { from: t("Reason.Pc") });
    return { traits: built.traits, flags, reasons: built.reasons };
  }

  // Tactical ---------------------------------------------------------
  let tactical;
  if ( traits.has("mindless") ) { tactical = 5; reasons.tactical = t("Reason.Mindless"); }
  else if ( traits.has("animal") || traits.has("beast") ) {
    tactical = clamp(18 + d.wis * 3 + Math.max(0, d.int + 4) * 2, 5, 45);
    reasons.tactical = t("Reason.Animal");
  } else {
    tactical = clamp(38 + d.int * 8 + d.wis * 2, 10, 95);
    reasons.tactical = t("Reason.Int", { n: signed(d.int) });
  }
  if ( flags.packTactics ) reasons.tactical = t("Reason.PackHunter", { reason: reasons.tactical });

  // Brave ------------------------------------------------------------
  let brave;
  if ( traits.has("mindless") ) { brave = 100; flags.fearless = true; reasons.brave = t("Reason.NeverFlees"); }
  else if ( traits.has("construct") ) { brave = 100; flags.fearless = true; reasons.brave = t("Reason.Construct"); }
  else if ( traits.has("undead") ) { brave = 90; reasons.brave = t("Reason.Undead"); }
  else {
    const delta = (d.will ?? expectedWill(d.level)) - expectedWill(d.level);
    brave = clamp(55 + delta * 5 - (traits.has("animal") ? 15 : 0), 10, 90);
    reasons.brave = t(traits.has("animal") ? "Reason.WillAnimal" : "Reason.Will", { n: signed(delta) });
  }
  if ( traits.has("minion") ) brave = Math.max(brave, 70);

  // Selfish ----------------------------------------------------------
  let selfish = 40;
  let selfishWhy = null;
  for ( const trait of traits ) {
    if ( SELFISH_BY_TRAIT[trait] !== undefined ) {
      if ( !selfishWhy || SELFISH_BY_TRAIT[trait] > selfish ) { selfish = SELFISH_BY_TRAIT[trait]; selfishWhy = t("Reason.Trait", { trait: traitName(trait) }); }
    }
  }
  // (A minion is its master's, whatever else it is.)
  if ( traits.has("minion") ) { selfish = SELFISH_BY_TRAIT.minion; selfishWhy = t("Reason.Trait", { trait: traitName("minion") }); }
  reasons.selfish = selfishWhy ?? t("Reason.Default");

  // Loyal ------------------------------------------------------------
  let loyal = 50;
  reasons.loyal = t("Reason.Default");
  const bound = d.hasMaster || traits.has("minion") || d.type === "familiar" || traits.has("summoned") || traits.has("mindless");
  if ( d.hasMaster || traits.has("minion") || d.type === "familiar" ) { loyal = 85; reasons.loyal = t("Reason.Master"); }
  else if ( traits.has("summoned") ) { loyal = 90; reasons.loyal = t("Reason.Summoned"); }
  else if ( traits.has("mindless") ) { loyal = 80; reasons.loyal = t("Reason.Orders"); }

  // What moves it from there: its kind's loyalty (the strongest), holy or unholy, what its abilities' rules say.
  const parts = [];
  if ( !bound ) {
    const kin = [...traits].filter(k => LOYAL_BY_TRAIT[k] !== undefined).sort((a, b) => Math.abs(LOYAL_BY_TRAIT[b]) - Math.abs(LOYAL_BY_TRAIT[a]))[0];
    if ( kin ) parts.push({ trait: "loyal", n: LOYAL_BY_TRAIT[kin], why: t("Reason.Trait", { trait: traitName(kin) }) });
  }
  if ( !traits.has("mindless") ) {
    for ( const s of ["holy", "unholy"] ) if ( traits.has(s) ) parts.push(...partsOf(SANCTIFIED[s], traitName(s), 1.5));
    for ( const item of d.items ?? [] ) parts.push(...partsOf(ruleLeans(item.rules), item.name ?? item.slug));
  }
  const built = traitsFromParts({ tactical, brave, selfish, loyal }, parts, { min: 0, max: 100 });
  return { traits: built.traits, flags, reasons: joinReasons(reasons, built.reasons) };
}
