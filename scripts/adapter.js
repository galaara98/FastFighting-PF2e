/**
 * Pathfinder 2e adapter: reads PF2e actors into CombatantSpecs and commits outcomes back.
 * Data paths verified against pf2e 8.6.0 on Foundry v14.
 */
import { SystemAdapter, parseTypedFormula, parseFormula, describeMods, localize, hasWords } from "./core.js";
import { pf2eRules } from "./rules.js";
import { parseAffliction } from "./afflictions.js";
import { derivePf2eTraits, creatureKindOf } from "./traits.js";
import { pf2eHints, pf2eTactics, plainText, textOf } from "./auto.js";
import { rankLeaders } from "./leadership.js";
import { commitPf2eOutcome, describePf2eOutcome, commitPf2eConcession } from "./commit.js";
import { parseControl, parseCritRider, conditionsIn, plain } from "./control.js";
import { abilityAction } from "./abilities.js";
import { classActions, extraParts } from "./class-actions.js";
import { t, actionName, traitName, featureName, conditionLabel, coin, englishName, englishDescription } from "./words.js";
import { modsFromRules, spellRounds, spellReach, helps, effectRounds, ruleValue, ONE_ROLL } from "./effects.js";
import { aidAction } from "./edges.js";
import { loreBoost } from "./lore.js";

const PRONE_EFFECTS = new Set(["knockdown", "improved-knockdown", "trip", "improved-trip"]);
const GRAB_EFFECTS = new Set(["grab", "improved-grab"]);
const AFFLICTION_TRAITS = new Set(["poison", "disease", "curse"]);
const HEAL_SPELLS_TWO_ACTION_BONUS = new Set(["heal", "heal-animal", "heal-companion"]);
const SPEED_KEYS = { land: "walk", fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" };
/** Spell Effect items, fetched once a session (the same Bless serves every cleric). */
/** Creature sizes, smallest first (dnd5e and PF2e use the same keys). */
/** A creature's rarity, as the core counts it (spec.rarity). */
export const RARITY = Object.freeze({ common: 0, uncommon: 1, rare: 2, unique: 3 });
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const sizeOf = key => { const i = SIZES.indexOf(String(key ?? "med")); return i < 0 ? 2 : i; };

/**
 * Roll options a class means to have on in every fight, so they're part of its Strikes: a thaumaturge's Implement's
 * Empowerment (an implement in one hand, a weapon in the other).
 */
const ALWAYS_ON = ["implements-empowerment"];
/** Knowledge skills for Recall Knowledge (and any Lore). */
const RECALL_SKILLS = new Set(["arcana", "crafting", "medicine", "nature", "occultism", "religion", "society"]);

const EFFECT_CACHE = new Map();
const CREATURE_CACHE = new Map();

/** The highest creature level a summon spell of each rank calls (PF2e's summon trait), from rank 1. */
const SUMMON_LEVEL = [-1, -1, 1, 2, 3, 5, 7, 9, 11, 13, 15];
/** What each summon spell calls, by its slug (the creature trait to look for). */
const SUMMON_TRAITS = {
  "summon-animal": "animal", "summon-fey": "fey", "summon-undead": "undead", "summon-elemental": "elemental", "summon-construct": "construct",
  "summon-plant-or-fungus": "plant", "summon-dragon": "dragon", "summon-fiend": "fiend", "summon-celestial": "celestial", "summon-monitor": "monitor",
  "summon-giant": "giant", "summon-entity": "aberration", "summon-anarch": "fiend", "summon-axiom": "monitor", "summon-lesser-servitor": "celestial"
};

/**
 * A creature with this trait of the highest level up to `level` from the installed bestiaries (the Monster Core
 * first), never a unique one: what a summon spell would most likely call.
 */
async function creatureFor(level, trait) {
  const key = `${level}|${trait}`;
  if ( !CREATURE_CACHE.has(key) ) CREATURE_CACHE.set(key, (async () => {
    const rank = p => (/monster-core/.test(p.collection) ? 0 : /bestiary/.test(p.collection) ? 1 : 2);
    const packs = [...game.packs].filter(p => p.documentName === "Actor").sort((a, b) => rank(a) - rank(b));
    for ( const pack of packs ) {
      const index = await pack.getIndex({ fields: ["type", "system.details.level.value", "system.traits.value", "system.traits.rarity"] });
      const fits = index.filter(e => e.type === "npc" && (e.system?.traits?.value ?? []).includes(trait) && e.system?.traits?.rarity !== "unique"
        && Number(e.system?.details?.level?.value) <= level);
      if ( !fits.length ) continue;
      const best = Math.max(...fits.map(e => Number(e.system.details.level.value)));
      const pick = fits.filter(e => Number(e.system.details.level.value) === best).sort((a, b) => a.name.localeCompare(b.name))[0];
      return pack.getDocument(pick._id);
    }
    return null;
  })().catch(() => null));
  return CREATURE_CACHE.get(key);
}
async function linkedEffect(uuid) {
  if ( !EFFECT_CACHE.has(uuid) ) EFFECT_CACHE.set(uuid, fromUuid(uuid).catch(() => null));
  return EFFECT_CACHE.get(uuid);
}
/** PF2e conditions the engine plays out, by slug -> engine key. */
const ENGINE_CONDITIONS = {
  "off-guard": "offGuard", grabbed: "offGuard", restrained: "offGuard", prone: "prone", clumsy: "clumsy", enfeebled: "enfeebled",
  sickened: "sickened", frightened: "frightened", slowed: "slowed", stunned: "stunned", paralyzed: "paralyzed",
  blinded: "blinded", deafened: "deafened"
};

/** What a character calls its feats, features and actions, by slug (a translated compendium's names). */
function ownNames(actor) {
  const out = {};
  for ( const i of actor.items ?? [] ) {
    const slug = slugOf(i);
    if ( slug && !(slug in out) ) out[slug] = i.name;
  }
  return out;
}

/** A character's weapon Strikes, as the system lists them (the ones it shows). */
const strikesOf = actor => (actor.system?.actions ?? []).filter(s => s.type === "strike" && s.visible !== false);

/** The id of a Strike's action: the `index`th of strikesOf(actor). */
const strikeId = (actor, s, index) => `${actor.id}.strike.${s.slug ?? index}.${index}`;

function slugOf(item) {
  const slug = item?.slug ?? item?.system?.slug;
  if ( slug ) return slug;
  return item?.name ? item.name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
}

function parseActionCost(time) {
  const t = String(time ?? "").trim().toLowerCase();
  if ( /^\d$/.test(t) ) return Number(t);
  if ( t === "1 to 3" || t === "1 or 2" || t === "2 or 3" ) return 2;
  return null; // reactions, free actions, minutes...
}

function parseFeet(text) {
  const m = /(\d+)\s*(?:feet|foot|ft)/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** Rough number of enemies caught by an area. */
function areaTargets(area, targetText) {
  if ( /1 or 2 creatures/i.test(targetText ?? "") ) return 2;
  const n = /up to (\d+) creatures/i.exec(targetText ?? "");
  if ( n ) return Number(n[1]);
  if ( !area ) return 1;
  const size = Number(area.value) || 5;
  if ( area.type === "line" ) return size >= 60 ? 3 : 2;
  if ( area.type === "cone" ) return size >= 30 ? 3 : 2;
  if ( area.type === "emanation" ) return size >= 20 ? 3 : 2;
  return size >= 20 ? 4 : size >= 10 ? 3 : 2; // burst
}


/**
 * A character's Stamina Points, when the world plays PF2e's Stamina variant: spent before hit points (the system takes
 * damage from temporary hit points, then stamina, then hit points), and healing doesn't restore them.
 */
function staminaOf(actor, hp) {
  if ( actor.type !== "character" || !game.pf2e?.settings?.variants?.stamina || !hp?.sp ) return {};
  return { stamina: { value: Math.max(0, Number(hp.sp.value) || 0), max: Math.max(0, Number(hp.sp.max) || 0) } };
}
export class Pf2eAdapter extends SystemAdapter {
  /** Building a summoned creature (which doesn't summon in turn). */
  #summoning = false;

  static systemId = "pf2e";

  get label() {
    return t("Label");
  }

  get rules() {
    return pf2eRules;
  }

  canHandle(actor) {
    return !!actor && ["character", "npc", "familiar", "hazard"].includes(actor.type);
  }

  /* -------------------------------------------- */

  async toCombatantSpec(tokenDoc) {
    const actor = tokenDoc.actor;
    if ( !this.canHandle(actor) ) return null;
    const sys = actor.system;
    const hp = sys.attributes.hp ?? {};
    const level = actor.level ?? sys.details?.level?.value ?? 0;
    const traits = [...(sys.traits?.value ?? [])];
    // (An animal or construct companion made on a character sheet is a minion: a companion, not a player character.)
    const hazard = actor.type === "hazard";
    const kind = hazard ? "hazard" : actor.type === "familiar" || (actor.type === "character" && traits.includes("minion")) ? "companion"
      : actor.type === "character" ? "pc"
        : traits.includes("minion") ? "minion" : "npc";

    // Its Strikes, and what its class does with them (Vicious Swing, Double Slice, Flurry of Blows, Hunter's Edge ...).
    const { strikes, variants } = await this.#strikes(actor);
    const martial = classActions({ actorId: actor.id, slugs: new Set(actor.items.map(i => slugOf(i)).filter(Boolean)), level, strikes, names: ownNames(actor) });
    // (Its own: a class's actions, a kineticist's blasts, a thaumaturge's mark, its feats' actions, what it puts on
    // itself, a creature's abilities. What "magic and specialties" means, with spells.)
    const own = list => list.map(a => ({ ...a, feature: true }));
    const actions = [
      ...martial.strikes,
      ...own(martial.actions),
      ...own(variants),
      ...own(await this.#elementalBlasts(actor)),
      ...own(this.#marks(actor)),
      ...await this.#spells(actor),
      ...this.#consumables(actor),
      ...own(this.#feats(actor)),
      ...own(await this.#selfEffects(actor)),
      ...this.#skillActions(actor, traits, martial.strikes)
    ];
    actions.push(...own(await this.#abilities(actor, actions)));

    const speeds = {};
    for ( const [key, value] of Object.entries(sys.movement?.speeds ?? {}) ) {
      const mode = SPEED_KEYS[key];
      const v = typeof value === "number" ? value : value?.value;
      if ( mode && v > 0 ) speeds[mode] = v;
    }
    if ( !hazard && !speeds.walk && !Object.keys(speeds).length ) speeds.walk = 25; // (a hazard stays where it is)

    const iwr = { immune: [], weak: {}, resist: {} };
    for ( const i of actor.attributes?.immunities ?? [] ) iwr.immune.push(i.type);
    for ( const w of actor.attributes?.weaknesses ?? [] ) iwr.weak[w.type] = w.value;
    for ( const r of actor.attributes?.resistances ?? [] ) iwr.resist[r.type] = r.value;

    const resources = {};
    for ( const a of actions ) if ( a.resource && a.pool !== undefined ) resources[a.resource] = a.pool;
    for ( const a of actions ) delete a.pool;
    // Hero Points: spent to keep someone from dying (all of them, for one's own Heroic Recovery).
    const heroPoints = actor.type === "character" ? Number(sys.resources?.heroPoints?.value) || 0 : 0;
    if ( heroPoints > 0 ) resources.fate = heroPoints;

    const derived = this.deriveTraits(actor);
    const shield = sys.attributes?.shield;
    const mending = this.#mending(actor);
    // A success that counts as a critical success: Evasion (Reflex), Juggernaut (Fortitude), Resolve (Will).
    const upgrades = Object.entries({ evasion: "reflex", juggernaut: "fortitude", resolve: "will" })
      .filter(([slug]) => actor.items.some(i => slugOf(i) === slug)).map(([, save]) => save);
    return {
      ...mending,
      saveUpgrades: upgrades.length ? upgrades : undefined,
      id: tokenDoc.id,
      tokenId: tokenDoc.id,
      actorId: actor.id,
      actorUuid: actor.uuid,
      name: tokenDoc.name ?? actor.name,
      img: tokenDoc.texture?.src ?? actor.img,
      kind,
      level,
      // (A hazard with no Hit Points can't be broken: it's always set. One with them, at 0, is broken: it's done.)
      hp: hazard && !(hp.max > 0) ? { value: 1, max: 1, temp: 0 } : { value: hp.value ?? 0, max: hp.max ?? 1, temp: hp.temp ?? 0, ...staminaOf(actor, hp) },
      defenses: {
        ac: sys.attributes?.ac?.value ?? 10,
        fortitude: actor.saves?.fortitude?.mod ?? level + 5,
        reflex: actor.saves?.reflex?.mod ?? level + 5,
        will: actor.saves?.will?.mod ?? level + 5
      },
      shield: shield?.ac > 0 && !shield.broken && !shield.destroyed ? { ac: shield.ac, hardness: shield.hardness } : null,
      initiative: { mod: actor.initiative?.mod ?? actor.perception?.mod ?? 0, stealth: actor.skills?.stealth?.mod ?? 0 },
      // A creature's rarity (its trait: common, uncommon, rare, unique): a rarer one has a slight edge for command.
      rarity: actor.type === "character" ? 0 : RARITY[sys.traits?.rarity] ?? 0,
      speeds,
      actions,
      iwr,
      resources,
      reactions: this.#reactions(actor),
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags, ...(hazard ? { fearless: true, mindless: true } : {}), masterActorId: actor.type === "familiar" ? sys.master?.id ?? null : null },
      diesAtZero: actor.type !== "character",
      wounded: sys.attributes?.wounded?.value ?? 0,
      doomed: sys.attributes?.doomed?.value ?? 0,
      dying: sys.attributes?.dying?.value ?? 0,
      // A fight resumed mid-way starts from where things stand.
      conditions: this.#conditions(actor),
      persistent: this.#persistent(actor),
      perception: actor.perception?.mod ?? actor.initiative?.mod ?? 0,
      darkvision: !!actor.hasDarkvision,
      senses: this.#senses(actor),
      fateLabel: game.i18n.localize("FFPF2E.HeroPoints"),
      // Administer First Aid needs training in Medicine (and a healer's toolkit, which trained characters carry).
      firstAid: actor.skills?.medicine?.proficient ? { mod: actor.skills.medicine.mod } : null,
      // Steal: Thievery, for those trained in it.
      theft: actor.skills?.thievery?.proficient ? { skill: actor.skills.thievery.label ?? "thievery", mod: actor.skills.thievery.mod } : null,
      // A locked door: Force Open (Athletics), or Pick a Lock (trained in Thievery, with a thieves' toolkit for a PC).
      doorWork: {
        force: { mod: actor.skills?.athletics?.mod ?? 0 },
        pick: actor.skills?.thievery?.proficient && (actor.type !== "character" || actor.items.some(i => /thieves-?(tool|toolkit)/.test(i.slug ?? "")))
          ? { mod: actor.skills.thievery.mod } : null
      },
      // Sizing a foe up (a Lore-Collector): Recall Knowledge, with its best knowledge skill.
      sizeUp: this.#recallKnowledge(actor, traits),
      creatureTraits: traits,
      creatureKind: creatureKindOf(traits, Object.keys(CONFIG.PF2E?.ancestryTraits ?? {})), // (the planner groups neutrals by it)
      size: sizeOf(actor.size ?? sys.traits?.size?.value),
      social: hazard ? { mindless: true, languages: [], pitches: {}, resist: {} } : this.#social(actor, level, traits),
      valuables: this.#valuables(actor),
      leadership: hazard ? null : this.#leadershipEntry(actor, tokenDoc.id),
      // A hazard: a simple one fires once (its trigger), a complex one each round; nobody attacks it.
      ...(hazard ? { hazard: { once: !actor.isComplex }, untargetable: true } : {})
    };
  }

  /* -------------------------------------------- */

  /**
   * Recall Knowledge, to size up a foe: its best knowledge skill (Arcana, Crafting, Medicine, Nature, Occultism,
   * Religion, Society, or a Lore), against the DC for the foe's level (the rules' typical DC). Null for the mindless.
   */
  #recallKnowledge(actor, traits) {
    if ( traits.includes("mindless") ) return undefined;
    let best = null;
    for ( const [slug, s] of Object.entries(actor.skills ?? {}) ) {
      if ( !(RECALL_SKILLS.has(slug) || /-lore$/.test(slug)) || typeof s?.mod !== "number" ) continue;
      if ( !best || s.mod > best.mod ) best = { mod: s.mod, label: game.i18n.localize("FFPF2E.RecallKnowledge"), boost: loreBoost() };
    }
    return best ?? undefined;
  }

  /** Talking in PF2e: Diplomacy persuades, Intimidation threatens, Deception bluffs; Will and Perception DCs resist. */
  #social(actor, level, traits) {
    const skill = slug => {
      const s = actor.skills?.[slug];
      return typeof s?.mod === "number" ? { skill: s.label ?? slug, mod: s.mod } : null;
    };
    const will = actor.saves?.will;
    const willDC = { dc: will?.dc?.value ?? level + 15, label: will?.label ?? "will" };
    return {
      pitches: { persuade: skill("diplomacy"), intimidate: skill("intimidation"), deceive: skill("deception") },
      resist: {
        persuade: willDC,
        intimidate: willDC,
        deceive: { dc: actor.perception?.dc?.value ?? level + 15, label: actor.perception?.label ?? "perception" },
        steal: { dc: actor.perception?.dc?.value ?? level + 15, label: actor.perception?.label ?? "perception" }
      },
      // How strong-willed it is next to a typical creature of its level (moderate Will is about level × 1.15 + 5).
      resolve: (will?.mod ?? Math.round(level * 1.15 + 5)) - Math.round(level * 1.15 + 5),
      languages: [...(actor.system.details?.languages?.value ?? [])],
      mindless: traits.includes("mindless")
    };
  }

  /** Coins (in copper), and gear that could be handed over: stowed (not held or worn) and held. */
  #valuables(actor) {
    const inventory = actor.inventory;
    if ( !inventory ) return null;
    const stowed = [];
    const wielded = [];
    for ( const item of inventory.contents ?? [] ) {
      if ( item.isOfType?.("treasure") && item.isCurrency ) continue;
      if ( item.type === "backpack" || !(item.quantity > 0) ) continue; // no containers (their contents would go too)
      // (What kind of thing it is, of what, how rare: for a character asking for something of a kind, itemCatalog.)
      const entry = {
        id: item.id, name: item.name, value: Math.round((item.assetValue?.copperValue ?? 0) / Math.max(1, item.quantity)),
        category: item.type, material: item.system.material?.type ?? "", rarity: item.system.traits?.rarity ?? ""
      };
      const carry = item.system.equipped?.carryType;
      if ( carry === "held" ) wielded.push(entry);
      else if ( carry === "stowed" ) stowed.push(entry);
    }
    return {
      money: inventory.currency?.copperValue ?? 0,
      denominations: [{ label: coin("pp"), value: 1000 }, { label: coin("gp"), value: 100 }, { label: coin("sp"), value: 10 }, { label: coin("cp"), value: 1 }],
      stowed,
      wielded
    };
  }

  /**
   * What it senses beyond plain sight and hearing: darkvision (and its greater kin) to see in the dark, and the
   * senses that need no sight at all (scent, tremorsense, echolocation, lifesense ...), each with its range.
   */
  #senses(actor) {
    const out = [];
    for ( const s of Array.from(actor.perception?.senses ?? []) ) {
      const type = String(s?.type ?? "");
      const range = Number.isFinite(Number(s?.range)) ? Number(s.range) : null;
      if ( /darkvision|truesight|see-invisibility/.test(type) ) out.push({ type, range, dark: true });
      else if ( type && !/low-light|vision/.test(type) ) out.push({ type, range, blind: true });
    }
    return out;
  }

  #conditions(actor) {
    const out = {};
    for ( const c of actor.itemTypes?.condition ?? [] ) {
      const key = ENGINE_CONDITIONS[c.slug];
      if ( !key ) continue;
      const value = typeof c.value === "number" ? c.value : 1;
      out[key] = Math.max(out[key] ?? 0, value);
    }
    return out;
  }

  #persistent(actor) {
    const out = [];
    for ( const c of actor.itemTypes?.condition ?? [] ) {
      const p = c.slug === "persistent-damage" ? c.system?.persistent : null;
      if ( !p?.formula ) continue;
      out.push({ ...parseFormula(p.formula, p.damageType ?? "untyped"), persistent: true });
    }
    return out;
  }

  /** PF2e regions: environment types (aquatic, ...) and difficult terrain from environment features. */
  describeRegionBehavior(behavior) {
    if ( behavior.type === "environment" ) return { types: [...(behavior.system.environmentTypes ?? [])] };
    if ( behavior.type === "environmentFeature" && behavior.system.terrain?.difficult ) return { difficult: true };
    return null;
  }

  /**
   * Its Strikes, with what its class and archetypes add, read off the system's own damage formulas (rule elements
   * and all) rather than by name:
   *  - what's always on in a fight (a thaumaturge's Implement's Empowerment) is part of every Strike;
   *  - what a flat-footed target adds (Sneak Attack, and the archetypes' and other classes' like it) is extra
   *    precision damage against an off-guard foe;
   *  - a Strike set up by a class action is an action of its own: an investigator's Devise a Stratagem (Strategic
   *    Strike), a swashbuckler's finisher with panache (Precise Strike).
   * A bomb or other consumable weapon can be thrown only as many times as it has.
   * @returns {Promise<{strikes: object[], variants: object[]}>}
   */
  async #strikes(actor) {
    const out = [];
    const variants = [];
    const character = actor.type === "character";
    const pack = this.#bonusDice(actor, "pack-attack");
    const sneak = this.#sneakAttackDice(actor);
    const has = slug => actor.items.some(i => slugOf(i) === slug);
    const setups = [];
    if ( has("devise-a-stratagem") ) setups.push({ key: "stratagem", label: featureName(ownNames(actor), "devise-a-stratagem"), options: ["check:substitution:devise-a-stratagem"], precision: true });
    if ( has("panache") || actor.items.some(i => i.system?.traits?.value?.includes("finisher")) ) setups.push({ key: "finisher", label: traitName("finisher"), options: ["self:effect:panache", "finisher"] });
    const strikes = strikesOf(actor);
    for ( const [index, s] of strikes.entries() ) {
      const item = s.item;
      const formula = async (options = [], critical = false) => {
        try {
          const params = { getFormula: true, options: [...ALWAYS_ON, ...options] };
          return (critical ? await s.critical?.(params) : await s.damage?.(params)) ?? null;
        } catch ( err ) {
          console.warn(`fast-fighting | could not read damage for ${actor.name} ${s.label}`, err);
          return null;
        }
      };
      const normal = await formula();
      const crit = await formula([], true);
      const damage = normal ? parseTypedFormula(normal) : [];
      const effects = this.#attackEffects(actor, item);
      if ( !damage.length && !effects.length ) continue;
      const traits = item?.system?.traits?.value ?? [];
      const ranged = !!item?.isRanged;
      const range = item?.range ?? item?.system?.range ?? null;
      const reachTrait = traits.find(t => /^reach(-\d+)?$/.test(t));
      const reach = reachTrait ? (Number(reachTrait.split("-")[1]) || 10) : (Number(item?.reach) || 5);
      const reload = Number(traits.find(t => t.startsWith("reload-"))?.split("-")[1]) || 0;
      const primaryType = damage[0]?.type ?? "untyped";
      // (A bomb, a dart of alchemist's fire: one throw each.)
      const consumable = traits.includes("consumable") || traits.includes("bomb");
      const quantity = Number(item?.system?.quantity ?? 1);
      if ( consumable && !(quantity > 0) ) continue;

      const bonusDamage = [];
      if ( pack && !ranged ) bonusDamage.push({ when: "pack", allies: 2, parts: [parseFormula(pack, primaryType)] });
      // Against an off-guard foe: what the system adds then (a character's Sneak Attack, by any class or archetype).
      const offGuard = character && damage.length ? extraParts(damage, parseTypedFormula(await formula(["target:condition:off-guard"]) ?? ""), "precision") : [];
      if ( offGuard.length ) bonusDamage.push({ when: "offGuard", parts: offGuard });
      else if ( sneak && (!character || ranged || traits.includes("agile") || traits.includes("finesse")) ) {
        bonusDamage.push({ when: "offGuard", parts: [{ ...parseFormula(sneak, primaryType), category: "precision" }] });
      }

      const strike = {
        id: strikeId(actor, s, index),
        name: s.label,
        kind: "strike",
        cost: 1 + reload,
        bonus: s.totalModifier ?? 0,
        maps: traits.includes("agile") ? [0, -4, -8] : [0, -5, -10],
        melee: !ranged,
        reach,
        range: ranged && range ? { increment: range.increment ?? range.max ?? 30, max: range.max ?? (range.increment ?? 30) * 6 } : null,
        damage,
        critDamage: crit ? parseTypedFormula(crit) : null,
        effects,
        bonusDamage,
        drawCost: s.ready === false && character ? 1 : 0,
        traits,
        // (A weapon in hand, one that can be knocked away: a character's weapon, or a creature's that has one.)
        held: ["simple", "martial", "advanced"].includes(item?.category) || undefined,
        ...(consumable ? { resource: `item:${item.id}`, pool: quantity, itemId: item.id } : {})
      };
      out.push(strike);
      // What a class action before the Strike makes of it.
      for ( const setup of setups ) {
        if ( consumable || !damage.length ) continue;
        const more = parseTypedFormula(await formula(setup.options) ?? "");
        const extra = extraParts(damage, more, setup.precision ? "precision" : null);
        if ( !extra.length ) continue;
        const moreCrit = parseTypedFormula(await formula(setup.options, true) ?? "");
        variants.push({ setup, strike: { ...strike, id: `${strike.id}.${setup.key}`, name: `${setup.label} (${s.label})`, cost: strike.cost + 1, oncePerTurn: true,
          damage: [...damage, ...extra], critDamage: moreCrit.length ? moreCrit : null, classAction: setup.key } });
      }
    }
    // One of each: the Strike it does most with.
    const mean = a => (a.damage ?? []).reduce((s, p) => s + p.flat + p.dice.reduce((t, d) => t + d.n * (d.faces + 1) / 2, 0), 0) + (a.bonus ?? 0);
    const picked = [];
    for ( const setup of setups ) {
      const best = variants.filter(v => v.setup === setup).map(v => v.strike).sort((a, b) => mean(b) - mean(a))[0];
      if ( best ) picked.push(best);
    }
    return { strikes: out, variants: picked };
  }

  /**
   * A kineticist's Elemental Blast, as the system works it out (its impulse attack, its gate's damage die, the
   * two-action blast's Constitution): one action, up close or at range, and two actions at range.
   */
  async #elementalBlasts(actor) {
    const Blast = game.pf2e?.ElementalBlast;
    if ( !Blast || actor.class?.slug !== "kineticist" && !actor.items.some(i => slugOf(i) === "elemental-blast") ) return [];
    const out = [];
    try {
      const blast = new Blast(actor);
      const bonus = blast.statistic?.check?.mod ?? 0;
      for ( const config of blast.configs ?? [] ) {
        const damageType = config.damageTypes?.[0]?.value;
        if ( !damageType ) continue;
        const feet = Number(config.range?.max ?? config.range?.increment) || 30;
        const read = async (melee, actionCost) => parseTypedFormula(await blast.damage({ element: config.element, damageType, melee, actionCost, getFormula: true }) ?? "");
        const base = { kind: "strike", bonus, maps: [0, -5, -10], traits: ["impulse", "attack", config.element, "elemental-blast"] };
        const name = `${featureName(ownNames(actor), "elemental-blast")} (${traitName(config.element)})`;
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.melee`, name, cost: 1, melee: true, reach: 5, damage: await read(true, 1) });
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.ranged`, name, cost: 1, melee: false, range: { increment: feet, max: feet, noPenalty: true }, damage: await read(false, 1) });
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.ranged2`, name: t("TwoActions", { name }), cost: 2, melee: false, range: { increment: feet, max: feet, noPenalty: true }, damage: await read(false, 2) });
      }
    } catch ( err ) {
      console.warn(`fast-fighting | could not read ${actor.name}'s Elemental Blast`, err);
    }
    return out.filter(a => a.damage.length);
  }

  #attackEffects(actor, item) {
    const effects = [];
    for ( const slug of item?.system?.attackEffects?.value ?? [] ) {
      const source = actor.items.find(i => slugOf(i) === slug);
      const traits = source?.system?.traits?.value ?? [];
      if ( source && traits.some(t => AFFLICTION_TRAITS.has(t)) ) {
        const parsed = parseAffliction({
          id: `${actor.id}.${slug}`,
          name: source.name,
          slug,
          description: englishDescription(source),
          traits
        });
        if ( parsed ) effects.push(parsed);
      } else if ( PRONE_EFFECTS.has(slug) ) effects.push({ kind: "prone" });
      else if ( GRAB_EFFECTS.has(slug) ) effects.push({ kind: "grabbed" });
    }
    return effects;
  }

  /** Dice from an ability's description, e.g. Pack Attack "an extra 1d4 damage". */
  #bonusDice(actor, slug) {
    const item = actor.items.find(i => slugOf(i) === slug);
    if ( !item ) return null;
    const m = /(\d+d\d+)/.exec(englishDescription(item));
    return m?.[1] ?? null;
  }

  #sneakAttackDice(actor) {
    const item = actor.items.find(i => slugOf(i) === "sneak-attack");
    if ( !item ) return null;
    if ( actor.type === "character" ) {
      const level = actor.level ?? 1;
      return `${level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1}d6`;
    }
    return /(\d+d\d+)/.exec(englishDescription(item))?.[1] ?? null;
  }

  /* -------------------------------------------- */

  async #spells(actor) {
    const out = [];
    const focusPool = actor.system.resources?.focus?.value ?? 0;
    const entries = actor.spellcasting?.regular ?? actor.spellcasting?.contents ?? [];
    for ( const entry of entries ) {
      const stat = entry.statistic;
      if ( !stat ) continue;
      const mode = entry.system?.prepared?.value;
      for ( const spell of entry.spells?.contents ?? [] ) {
        const cost = parseActionCost(spell.system.time?.value);
        if ( !cost ) continue;
        let roll = null;
        try {
          roll = (await spell.getDamage())?.template?.damage?.roll ?? null;
        } catch ( err ) {
          roll = null;
        }
        const kinds = roll?.kinds ?? new Set();
        const traits = spell.system.traits?.value ?? [];
        const parts = roll ? parseTypedFormula(roll.formula) : [];
        // No damage: maybe it's crowd control, conditions by degree of the target's save or of a spell attack.
        const control = !parts.length && (spell.system.defense?.save || spell.isAttack)
          ? parseControl({ description: englishDescription(spell), duration: spell.system.duration?.value })
          : null;
        // No damage and no conditions by degree: a buff for friends or a debuff for foes, from its Spell Effect.
        const support = !parts.length && !control ? await this.#spellSupport(spell, stat) : null;
        // A summon spell: the creature it most likely calls, which must be Sustained.
        const summon = traits.includes("summon") && !this.#summoning ? await this.#summon(spell) : null;
        if ( !parts.length && !control && !support && !summon ) continue;

        // Resource
        let resource = null;
        let pool;
        let uses;
        if ( spell.isCantrip ) resource = null;
        else if ( spell.isFocusSpell ) { resource = "focus"; pool = focusPool; }
        else if ( mode === "prepared" ) {
          let count = 0;
          for ( const [key, slot] of Object.entries(entry.system.slots ?? {}) ) {
            if ( key === "slot0" ) continue;
            count += (slot.prepared ?? []).filter(p => p.id === spell.id && !p.expended).length;
          }
          if ( !count ) continue;
          resource = `prep:${entry.id}:${spell.id}`;
          pool = count;
        } else if ( mode === "spontaneous" ) {
          const rank = spell.rank;
          resource = `slots:${entry.id}:${rank}`;
          pool = entry.system.slots?.[`slot${rank}`]?.value ?? 0;
        } else if ( mode === "innate" ) {
          // (PF2e says "at will" and "constant" only in the spell's name: "Translocate (At will)". At will is as
          // often as it likes; a constant one is always on, not cast.)
          // (In a Spanish world: "(constante)", "(a voluntad)".)
          if ( /\((constant|constante)\)/i.test(englishName(spell)) || /\((constant|constante)\)/i.test(spell.name) ) continue;
          uses = /\((at[- ]will|a voluntad)\)/i.test(`${englishName(spell)} ${spell.name}`) ? undefined : spell.system.location?.uses?.value ?? 1;
        }
        const id = `${actor.id}.spell.${spell.id}`;
        const rangeFeet = parseFeet(spell.system.range?.value);
        const area = spell.system.area;
        const isHeal = kinds.has?.("healing") && traits.includes("healing");
        if ( summon ) {
          out.push({ id, name: spell.name, cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, ...summon });
          continue;
        }
        if ( support ) {
          out.push({ id, name: spell.name, cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, ...support });
          continue;
        }

        if ( isHeal ) {
          let heal = parts.map(p => ({ ...p, type: "healing" }));
          if ( HEAL_SPELLS_TWO_ACTION_BONUS.has(spell.slug) && cost === 2 ) {
            heal = heal.map((p, i) => i === 0 ? { ...p, flat: p.flat + 8 * (spell.rank ?? 1) } : p);
          }
          const animalOnly = /animal/i.test(spell.system.target?.value ?? "");
          // One-action heal is a touch; two actions reach 30 feet.
          const touch = /touch/i.test(spell.system.range?.value ?? "") || (cost === 1 && HEAL_SPELLS_TWO_ACTION_BONUS.has(spell.slug));
          const reach = touch ? { reach: 5 } : rangeFeet ? { range: { increment: rangeFeet, max: rangeFeet, noPenalty: true } } : {};
          out.push({
            id, name: spell.name, kind: "heal", cost, heal, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank,
            targetTrait: animalOnly ? "animal" : null, ...reach
          });
          continue;
        }
        const defense = spell.system.defense;
        if ( control ) {
          const action = {
            id, name: spell.name, kind: "control", cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits,
            melee: false, range: { increment: rangeFeet ?? area?.value ?? 30, max: rangeFeet ?? area?.value ?? 30, noPenalty: true }
          };
          if ( defense?.save ) {
            action.save = { type: defense.save.statistic, dc: stat.dc?.value ?? 10 + level(actor), basic: false };
            // (Dominate: a save at the end of each of its turns, against the caster's DC.)
            action.onSave = control.map(o => (o?.repeatSave ? { ...o, repeatSave: { type: action.save.type, dc: action.save.dc } } : o));
          } else {
            // A spell attack: the degrees are the caster's (critical success, success ...).
            action.bonus = stat.check?.mod ?? 0;
            action.maps = [0, -5, -10];
            action.onHit = control;
          }
          const targets = areaTargets(area, spell.system.target?.value);
          if ( targets > 1 ) action.area = { targets };
          out.push(action);
          continue;
        }
        if ( !kinds.has?.("damage") ) continue;
        const action = {
          id, name: spell.name, cost, damage: parts, resource, pool, uses,
          spellId: spell.id, entryId: entry.id, rank: spell.rank, traits,
          melee: false,
          range: { increment: rangeFeet ?? area?.value ?? 30, max: rangeFeet ?? area?.value ?? 30, noPenalty: true }
        };
        if ( /touch/i.test(spell.system.range?.value ?? "") ) {
          action.melee = true;
          action.reach = 5;
          action.range = null;
        }
        const targets = areaTargets(area, spell.system.target?.value);
        if ( targets > 1 ) action.area = { targets };
        if ( spell.isAttack ) {
          action.kind = "spell-attack";
          action.bonus = stat.check?.mod ?? 0;
          action.maps = [0, -5, -10];
        } else if ( defense?.save ) {
          action.kind = "save";
          action.save = { type: defense.save.statistic, dc: stat.dc?.value ?? 10 + level(actor), basic: !!defense.save.basic };
          // "If the target critically fails the save, it is also stunned 1."
          const rider = parseCritRider(englishDescription(spell));
          if ( rider ) action.effects = [rider];
        } else {
          action.kind = "auto";
          if ( spell.slug === "force-barrage" ) action.damage = parts.map(p => ({ ...p, dice: p.dice.map(d => ({ ...d, n: d.n * 2 })), flat: p.flat * 2 }));
        }
        out.push(action);
      }
    }
    return out;
  }

  /**
   * A spell that works through its Spell Effect: a buff for friends (Bless, Heroism, Courageous Anthem, Protection,
   * Haste), a debuff on foes who fail a save (Bane, Malediction), or conditions laid on enemies with no save at all
   * (Dirge of Doom). Null when it does nothing the engine plays out.
   */
  /**
   * A summon spell as the engine's: a creature of the trait it calls, at the highest level its rank allows, read like
   * any creature, as a minion (two actions a turn) that its summoner must Sustain each turn or lose.
   */
  async #summon(spell) {
    const rank = Math.min(10, Number(spell.rank) || 1);
    const slug = spell.slug ?? slugOf(spell);
    const trait = SUMMON_TRAITS[slug] ?? (/\b(animal|fey|undead|elemental|construct|plant|dragon|fiend|celestial|monitor|giant|aberration|beast)\b/i.exec(plain(englishDescription(spell)))?.[1]?.toLowerCase() ?? "animal");
    const src = await creatureFor(SUMMON_LEVEL[rank], trait);
    if ( !src ) return null;
    this.#summoning = true;
    let spec = null;
    try {
      spec = await this.toCombatantSpec({ actor: src, id: `summon-${src.id}`, name: src.name, texture: { src: src.img } });
    } finally {
      this.#summoning = false;
    }
    if ( !spec ) return null;
    spec.creatureTraits = [...new Set([...(spec.creatureTraits ?? []), "minion", "summoned"])];
    return { kind: "summon", creatures: [spec], rounds: spellRounds(spell.system.duration?.value) ?? 10, sustain: { actions: 1 }, sustainOrEnd: true };
  }

  async #spellSupport(spell, stat) {
    const sys = spell.system;
    const html = englishDescription(spell);
    const text = plain(html);
    const mods = {};
    let tempHp = 0;
    let oneRoll = false;
    const uuids = [];
    // (A bonus the spell's own roll option switches on, as its target uses it: Guidance's "guidance".)
    const own = new Set([spell.slug ?? slugOf(spell)].filter(Boolean));
    for ( const m of html.matchAll(/@UUID\[(Compendium\.pf2e\.spell-effects\.Item\.[^\]]+)\]/g) ) {
      const effect = await linkedEffect(m[1]);
      if ( effect ) uuids.push(m[1]);
      const read = modsFromRules(effect?.system?.rules ?? [], { rank: spell.rank ?? 1, options: own });
      Object.assign(mods, read.mods);
      tempHp = Math.max(tempHp, read.tempHp);
      oneRoll ||= read.oneRoll;
    }
    // Haste: quickened, an extra action each turn (for Strikes and Strides).
    if ( /\bquickened\b/i.test(text) ) mods.actions = Math.max(mods.actions ?? 0, 1);
    const rounds = spellRounds(sys.duration?.value) ?? 10;
    const save = sys.defense?.save;
    const area = sys.area;
    const feet = parseFeet(sys.range?.value) ?? area?.value ?? 30;
    const reachFoes = { melee: false, range: { increment: feet, max: feet, noPenalty: true } };
    const many = areaTargets(area, sys.target?.value);
    if ( Object.keys(mods).length || tempHp ) {
      const outcome = { mods: Object.keys(mods).length ? mods : undefined, tempHp: tempHp || undefined, rounds, label: describeMods(mods, { tempHp }) };
      // (Its Spell Effect, to leave on a creature still under it when the fight ends.)
      const effectRef = uuids.length ? { uuids: [...new Set(uuids)] } : undefined;
      if ( save ) {
        return { kind: "control", ...reachFoes, save: { type: save.statistic, dc: stat.dc?.value ?? 10 + (spell.actor?.level ?? 0), basic: false },
          onSave: [outcome, outcome, null, null], area: many > 1 ? { targets: many } : undefined, effectRef };
      }
      // Good for one roll (Guidance: "one attack roll, Perception check, saving throw, or skill check"; Sure Strike:
      // "the next time you make an attack roll").
      if ( oneRoll || ONE_ROLL.test(text) ) outcome.uses = 1;
      if ( helps(mods) || (!outcome.mods && tempHp) ) return { kind: "buff", outcome, ...spellReach({ area, target: sys.target?.value, range: sys.range?.value }), effectRef };
      return { kind: "control", auto: true, ...reachFoes, outcome, effectRef };
    }
    // Conditions on enemies, no save (Dirge of Doom: "Enemies within the area are Frightened 1").
    const conditions = !save && !spell.isAttack && /\benem(?:y|ies)\b/i.test(text) ? conditionsIn(text) : {};
    if ( Object.keys(conditions).length ) {
      return { kind: "control", auto: true, ...reachFoes, area: many > 1 ? { targets: many } : undefined,
        outcome: { conditions, rounds: Math.max(rounds, conditions.frightened ?? 1), label: Object.entries(conditions).map(([k, v]) => `${k === "offGuard" ? "off-guard" : k}${v > 1 ? ` ${v}` : ""}`).join(", ") } };
    }
    return null;
  }

  /**
   * Actions that put an effect on their user (Rage, and the like): a buff on itself, read from the effect's rule
   * elements and the action's own rules for while it's on (Rage: +2 to melee Strike damage, temporary hit points of
   * level + Constitution), with the actor's own numbers. Its effect is left on after the fight for the time it has
   * left.
   */
  async #selfEffects(actor) {
    const out = [];
    const data = { level: actor.level ?? 0, abilities: Object.fromEntries(Object.entries(actor.system.abilities ?? {}).map(([k, v]) => [k, { mod: Number(v?.mod) || 0 }])) };
    for ( const item of actor.items ) {
      const uuid = item.system?.selfEffect?.uuid;
      if ( !uuid || !["action", "feat"].includes(item.type) ) continue;
      const type = item.system.actionType?.value;
      if ( type === "reaction" || type === "passive" ) continue;
      const effect = await linkedEffect(uuid);
      if ( !effect ) continue;
      const slug = String(effect.system?.slug ?? slugOf(effect) ?? "");
      const short = slug.replace(/^effect-/, "");
      // What a fight can tell: the effect is on, and the Strike is a melee one.
      const options = new Set(["item:melee", "item:type:weapon", `self:effect:${short}`, `self:effect:${slug}`, short]);
      const own = modsFromRules(effect.system?.rules ?? [], { rank: item.level ?? 1, actor: data, options });
      const whileOn = modsFromRules(item.system?.rules ?? [], { rank: item.level ?? 1, actor: data, options, only: `self:effect:${short}` });
      const mods = { ...own.mods };
      for ( const [k, v] of Object.entries(whileOn.mods) ) mods[k] = (mods[k] ?? 0) + v;
      const tempHp = Math.max(own.tempHp, whileOn.tempHp);
      if ( !Object.keys(mods).length && !tempHp ) continue;
      out.push({
        id: `${actor.id}.self.${item.id}`, name: item.name, kind: "buff", targets: "self", itemId: item.id,
        cost: type === "free" ? 0 : (item.system.actions?.value ?? 1), economy: type === "free" ? "free" : undefined, traits: [...(item.system.traits?.value ?? [])],
        outcome: { mods: Object.keys(mods).length ? mods : undefined, tempHp: tempHp || undefined, rounds: effectRounds(effect.system?.duration) ?? 10, label: describeMods(mods, { tempHp }) },
        effectRef: { uuids: [uuid] }
      });
    }
    return out;
  }

  /**
   * Reactions that answer an attack (see the core's responses.js): Shield Block (the raised shield's hardness off a
   * physical blow), Reactive Shield (raising it as the blow comes, perhaps a miss after all), Nimble Dodge (+2 AC
   * against one attack). By slug, on characters and monsters alike. Null when it has none.
   */
  /**
   * Its own abilities that ask for a save and hurt or hinder (Breath Weapon, Trample, a Drain): read from their text
   * (abilities.js), with a cooldown ("can't use it again for 1d4 rounds") or a frequency (once per day) as uses.
   */
  async #abilities(actor, actions) {
    const strikes = actions.filter(a => a.kind === "strike" && a.damage?.length).map(a => ({ name: a.name, damage: a.damage }));
    const out = [];
    for ( const item of actor.items ) {
      // Its actions, and feats that are actions of their own (a kineticist's impulses, Dragon's Rage Breath).
      if ( item.type !== "action" && !(item.type === "feat" && item.system.actionType?.value === "action") ) continue;
      if ( item.type === "feat" && !/@Check\[/i.test(item.system.description?.value ?? "") ) continue;
      const action = abilityAction({
        id: `${actor.id}.${item.id}`, name: item.name, html: await resolvedText(item),
        // (A hazard's reaction is what it does when it's set off: its action.)
        actions: item.system.actions?.value, traits: item.system.traits?.value ?? [], strikes,
        actionType: actor.type === "hazard" && item.system.actionType?.value === "reaction" ? "action" : item.system.actionType?.value
      });
      if ( !action ) continue;
      const often = Number(item.system.frequency?.max);
      if ( !action.cooldown && often > 0 ) action.uses = often;
      out.push({ ...action, itemId: item.id });
    }
    return out;
  }

  /**
   * A thaumaturge's Exploit Vulnerability: one action marks a foe, and its own hits on it deal more (its personal
   * antithesis, a weakness of 2 + half its level to the thaumaturge's attacks).
   */
  #marks(actor) {
    if ( !actor.items.some(i => slugOf(i) === "exploit-vulnerability") ) return [];
    const level = actor.level ?? 1;
    const flat = 2 + Math.floor(level / 2);
    return [{ id: `${actor.id}.exploit-vulnerability`, name: featureName(ownNames(actor), "exploit-vulnerability"), kind: "control", auto: true, cost: 1, oncePerTurn: true,
      traits: ["esoterica", "manipulate"], melee: false, range: { increment: 60, max: 60, noPenalty: true },
      outcome: { mark: [{ dice: [], flat, type: "untyped", persistent: false, category: null }], rounds: 10, label: t("Exploited", { n: flat }) } }];
  }

  /** Regeneration (deactivated by acid, fire ...) and fast healing, from the FastHealing rule elements on its abilities. */
  #mending(actor) {
    const out = {};
    for ( const item of actor.items ) {
      for ( const rule of item.system.rules ?? [] ) {
        if ( rule.key !== "FastHealing" ) continue;
        const value = Number(ruleValue(rule.value, { actor })) || 0;
        if ( value <= 0 ) continue;
        if ( rule.type === "regeneration" ) out.regen = { amount: value, stoppedBy: [...(rule.deactivatedBy ?? [])] };
        else out.fastHealing = (out.fastHealing ?? 0) + value;
      }
    }
    return out;
  }

  #reactions(actor) {
    const out = [];
    const shield = actor.system.attributes?.shield;
    const hasShield = shield?.ac > 0 && !shield.broken && !shield.destroyed;
    const seen = new Set(); // (a feat and the action it grants share a slug)
    for ( const item of actor.items ) {
      if ( !["feat", "action"].includes(item.type) ) continue;
      const slug = slugOf(item);
      if ( seen.has(slug) ) continue;
      seen.add(slug);
      if ( slug === "shield-block" && hasShield && shield.hardness > 0 ) {
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "hit", needsShield: true, physical: true, reduce: { dice: [], flat: shield.hardness, type: "untyped", persistent: false, category: null } });
      } else if ( slug === "reactive-shield" && hasShield ) {
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "hit", melee: true, ac: shield.ac });
      } else if ( slug === "nimble-dodge" ) {
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "attacked", ac: 2 });
      } else if ( slug === "intercept-attack" ) {
        // A guardian's: an ally within 10 feet taking physical damage, it takes the blow instead (its own resistances).
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "allyHit", range: 10, physical: true, redirect: true, tell: "intercept" });
      } else if ( ["retributive-strike", "glimpse-of-redemption", "liberating-step"].includes(slug) ) {
        // A champion's reaction: a friend within 15 feet hit takes 2 + its level less (and the attacker, in reach of a
        // Retributive Strike, gets struck).
        const level = actor.level ?? 1;
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "allyHit", range: 15,
          reduce: { dice: [], flat: 2 + level, type: "untyped", persistent: false, category: null }, strike: slug === "retributive-strike" || undefined });
      }
    }
    return out.length ? out : null;
  }

  /**
   * Skill actions anyone (or the trained) can take in a fight: Demoralize (Intimidation against Will: frightened),
   * Trip (Athletics against Reflex, an attack: prone, or prone yourself on a critical failure), Feint (Deception
   * against Perception: off-guard to you), Bon Mot for those with the feat (Diplomacy against Will), and Aid.
   */
  #skillActions(actor, traits, strikes = []) {
    if ( traits.includes("mindless") ) return [];
    const skill = slug => actor.skills?.[slug] ?? null;
    const trained = slug => !!skill(slug) && ((skill(slug).rank ?? 0) >= 1 || (actor.type === "npc" && !!actor.system.skills?.[slug]));
    const out = [];
    const near = { melee: false, range: { increment: 30, max: 30, noPenalty: true } };
    // Aid: for a friend's next roll at whoever it's set on (edges.js); for one that can tell a friend what it means to
    // do (a language: not a wolf).
    const aid = !(actor.system.details?.languages?.value ?? []).length ? null : aidAction({ id: `${actor.id}.aid`, name: game.i18n.localize("FFPF2E.Aid"), strikes,
      skills: ["diplomacy", "medicine", "intimidation", "deception"].map(skill).filter(Boolean).map(s => ({ mod: s.mod, rank: s.rank ?? 0 })) });
    if ( aid ) out.push(aid);
    const intimidation = skill("intimidation");
    if ( intimidation ) {
      out.push({ id: `${actor.id}.demoralize`, name: actionName("Demoralize"), kind: "control", cost: 1, traits: ["auditory", "concentrate", "emotion", "fear", "mental"], ...near,
        check: { mod: intimidation.mod ?? 0, against: "will" }, oncePerTarget: true,
        onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: conditionLabel("frightened", 1) }, { conditions: { frightened: 2 }, rounds: 2, label: conditionLabel("frightened", 2) }] });
    }
    if ( trained("athletics") ) {
      const prone = { conditions: { prone: 1 }, rounds: 1, label: conditionLabel("prone") };
      // (Only a creature at most one size larger.)
      out.push({ id: `${actor.id}.trip`, name: actionName("Trip"), kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1,
        check: { mod: skill("athletics").mod ?? 0, against: "reflex", attack: true }, onHit: [{ ...prone, self: true }, null, prone, prone] });
      // Grapple (Athletics against Fortitude, an attack): grabbed until the end of its next turn, restrained on a
      // critical success; a critical failure puts you on the ground.
      const held = { conditions: { immobilized: 1, offGuard: 1 }, rounds: 1, label: conditionLabel("grabbed") };
      out.push({ id: `${actor.id}.grapple`, name: actionName("Grapple"), kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1,
        check: { mod: skill("athletics").mod ?? 0, against: "fortitude", attack: true }, onHit: [{ ...prone, self: true }, null, held, { ...held, label: conditionLabel("restrained") }] });
      // Disarm (Athletics against Reflex, an attack; a foe with a weapon in hand, no more than one size larger): -2 to
      // its attacks with it until its next turn; on a critical success it drops it (an action gone picking it up). A
      // critical failure leaves you off-guard.
      const loosened = { mods: { attack: -2 }, rounds: 1, label: t("Loosened") };
      out.push({ id: `${actor.id}.disarm`, name: actionName("Disarm"), kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1, disarm: true,
        check: { mod: skill("athletics").mod ?? 0, against: "reflex", attack: true },
        onHit: [{ conditions: { offGuard: 1 }, rounds: 1, self: true, label: conditionLabel("off-guard") }, null, loosened, { mods: { attack: -2, actions: -1 }, rounds: 1, label: t("Dropped") }] });
    }
    if ( trained("deception") ) {
      const exposed = { conditions: { offGuard: 1 }, onlyVs: true, rounds: 1, label: conditionLabel("off-guard") };
      out.push({ id: `${actor.id}.feint`, name: actionName("Feint"), kind: "control", cost: 1, traits: ["mental"], melee: true, reach: 5,
        check: { mod: skill("deception").mod ?? 0, against: "perception" }, onHit: [null, null, exposed, exposed] });
    }
    if ( skill("diplomacy") && actor.itemTypes?.feat?.some(f => slugOf(f) === "bon-mot") ) {
      const jab = n => ({ mods: { saves: -n, checks: -n }, rounds: 10, label: t("Flustered") });
      out.push({ id: `${actor.id}.bon-mot`, name: featureName(ownNames(actor), "bon-mot"), kind: "control", cost: 1, special: true, traits: ["auditory", "concentrate", "emotion", "linguistic", "mental"], ...near,
        check: { mod: skill("diplomacy").mod ?? 0, against: "will" }, onHit: [{ ...jab(2), self: true }, null, jab(2), jab(3)] });
    }
    return out;
  }

  #consumables(actor) {
    const out = [];
    for ( const item of actor.itemTypes?.consumable ?? [] ) {
      const dmg = item.system.damage;
      if ( dmg?.kind !== "healing" || !dmg.formula ) continue;
      const quantity = (item.system.quantity ?? 1) * Math.max(1, item.system.uses?.max ?? 1);
      if ( quantity <= 0 ) continue;
      out.push({
        id: `${actor.id}.item.${item.id}`,
        name: item.name,
        kind: "heal",
        cost: 1,
        heal: [parseFormula(dmg.formula, "healing")],
        resource: `item:${item.id}`,
        pool: quantity,
        selfOnly: true,
        itemId: item.id
      });
    }
    return out;
  }

  #feats(actor) {
    const out = [];
    const medicine = actor.skills?.medicine;
    if ( actor.items.some(i => slugOf(i) === "battle-medicine") && medicine ) {
      const rank = medicine.rank ?? 1;
      const [dc, bonus] = rank >= 4 ? [40, 50] : rank >= 3 ? [30, 30] : rank >= 2 ? [20, 10] : [15, 0];
      out.push({
        id: `${actor.id}.feat.battle-medicine`,
        name: featureName(ownNames(actor), "battle-medicine"),
        kind: "heal",
        cost: 1,
        heal: [{ dice: [{ n: 2, faces: 8, mult: 1 }], flat: bonus, type: "healing", persistent: false, category: null }],
        healCheck: { mod: medicine.mod, dc },
        oncePerTarget: true,
        reach: 5 // yourself or an adjacent creature
      });
    }
    return out;
  }

  /* -------------------------------------------- */

  /** What a character's system says for setting it up by itself (auto.js): class, ancestry, traits (slugs), gear. */
  #facts(actor) {
    const armor = (actor.itemTypes?.armor ?? []).find(a => a.isEquipped);
    return {
      cls: actor.class?.slug ?? null,
      ancestry: actor.ancestry?.slug ?? null,
      traits: [...(actor.system?.traits?.value ?? [])].map(String),
      shield: !!actor.system?.attributes?.shield?.ac,
      heavy: armor?.system?.category === "heavy"
    };
  }

  /** The playstyles PF2e says fit it (auto.js). */
  playstyleHints(actor) {
    return pf2eHints(this.#facts(actor));
  }

  /**
   * Its own answers to the tactics questions, and what it offers and expects (auto.js: pf2eTactics), each with its
   * reason: its class and the choices it made in it, its feats, features and abilities (by slug, and by what their
   * triggers say they do), its traits, spellcasting, skills, languages, immunities and gear.
   */
  tacticHints(actor, spec) {
    return pf2eTactics(this.#tacticFacts(actor, spec ?? {}));
  }

  /** What pf2eTactics reads of a character (plain values, with the names the GM sees). */
  #tacticFacts(actor, spec) {
    const word = key => (key && hasWords(key) ? localize(key) : null);
    const features = {};
    const abilities = [];
    let formation = null;
    let mending = null;
    for ( const item of actor.items ?? [] ) {
      const rules = item.system?.rules ?? [];
      // (Fighting in formation: an ability whose rules turn on the "formation" roll option, a hobgoblin soldier's.)
      if ( !formation && rules.some(r => r?.key === "RollOption" && r.option === "formation") ) formation = item.name;
      if ( !mending && (spec.regen || spec.fastHealing) && rules.some(r => r?.key === "FastHealing") ) mending = item.name;
      if ( !["feat", "action", "heritage"].includes(item.type) ) continue;
      const slug = slugOf(item);
      if ( slug && !Object.hasOwn(features, slug) ) features[slug] = item.name;
      const type = item.system?.actionType?.value;
      if ( type === "reaction" || type === "action" ) abilities.push({ slug, name: item.name, type, text: englishDescription(item) });
    }
    // A cleric's divine font: what its choice selected (heal or harm).
    const fontItem = actor.items?.find(i => slugOf(i) === "divine-font");
    const fontRule = (fontItem?.system?.rules ?? []).find(r => r?.key === "ChoiceSet" && r.flag === "divineFont");
    const font = fontItem ? { value: fontItem.flags?.pf2e?.rulesSelections?.divineFont ?? fontRule?.selection ?? null, name: fontItem.name } : null;
    const deity = actor.deity ? { name: actor.deity.name, weapons: [...(actor.deity.system?.weapons ?? [])] } : null;
    // Its weapon Strikes (the ones that are its actions), and the weapons it fights with (not its fists, nor a bomb).
    const ids = new Set((spec.actions ?? []).map(a => a.id));
    const strikes = strikesOf(actor).map((s, index) => ({ id: strikeId(actor, s, index), base: s.item?.baseType ?? s.item?.system?.baseItem ?? s.item?.slug ?? null }))
      .filter(s => ids.has(s.id));
    const weapons = { melee: 0, ranged: 0 };
    for ( const a of spec.actions ?? [] ) {
      if ( a.kind !== "strike" || a.feature || a.classAction || /^item:/.test(a.resource ?? "") ) continue;
      if ( (a.traits ?? []).some(x => ["unarmed", "impulse"].includes(x)) ) continue;
      if ( a.melee ) weapons.melee++;
      else if ( a.range ) weapons.ranged++;
    }
    const bomb = (spec.actions ?? []).find(a => a.kind === "strike" && (a.traits ?? []).includes("bomb"))?.name ?? null;
    // Its spellcasting: with spell slots (prepared or spontaneous), and innate.
    let slots = null;
    let innate = null;
    for ( const entry of actor.spellcasting?.regular ?? actor.spellcasting?.contents ?? [] ) {
      const mode = entry.system?.prepared?.value;
      const ranked = Object.entries(entry.system?.slots ?? {}).some(([key, s]) => key !== "slot0" && Number(s?.max) > 0);
      if ( !slots && ranked && ["prepared", "spontaneous"].includes(mode) ) slots = entry.name;
      if ( !innate && mode === "innate" && (entry.spells?.size ?? entry.spells?.contents?.length ?? 1) > 0 ) innate = entry.name;
    }
    // Diplomacy, Deception and Intimidation: a character's proficiency; whether a creature's stat block lists them.
    const social = {};
    for ( const slug of ["diplomacy", "deception", "intimidation"] ) {
      const s = actor.skills?.[slug];
      const rank = Number(s?.rank) || 0;
      social[slug] = {
        rank, mod: s?.mod, listed: rank >= 1 || !!actor._source?.system?.skills?.[slug],
        name: s?.label ?? slug, rankName: word(CONFIG.PF2E?.proficiencyLevels?.[rank]) ?? String(rank)
      };
    }
    const coins = spec.valuables?.denominations ?? [];
    const main = coins.find(c => c.value === 100) ?? coins[0] ?? null;
    return {
      kind: spec.kind ?? (actor.type === "character" ? "pc" : "npc"),
      level: spec.level ?? actor.level ?? 0,
      cls: actor.class ? { slug: actor.class.slug ?? slugOf(actor.class), name: actor.class.name } : null,
      background: actor.background ? { slug: actor.background.slug ?? slugOf(actor.background), name: actor.background.name } : null,
      features,
      abilities,
      traits: [...(actor.system?.traits?.value ?? [])].map(String),
      font,
      deity,
      strikes,
      weapons,
      casting: { slots, innate },
      social,
      languages: (spec.social?.languages ?? actor.system?.details?.languages?.value ?? []).length,
      immune: (spec.iwr?.immune ?? []).map(type => ({ type, name: word(CONFIG.PF2E?.immunityTypes?.[type]) ?? type })),
      mending,
      formation,
      bomb,
      shield: !!spec.shield,
      purse: main ? { money: spec.valuables?.money ?? 0, coin: main.value } : null
    };
  }

  /** Its biography (a character's backstory, beliefs, edicts and anathema ...; a creature's notes and blurb) as text. */
  biography(actor) {
    const d = actor.system?.details ?? {};
    const b = d.biography ?? {};
    // What's said of the character itself (a creature's description; a character's appearance, attitude, beliefs, likes,
    // catchphrases and edicts) in full; its backstory and campaign notes, a story with others in it, a little; its
    // dislikes and anathema the other way ("dislikes cowards"). Never its allies or enemies: those are about others.
    const about = [textOf([b.appearance, b.attitude, b.beliefs, b.likes, b.catchphrases, b.edicts]), plainText(d.publicNotes), plainText(d.privateNotes), plainText(d.blurb)];
    return { about: about.filter(Boolean).join(". "), story: textOf([b.backstory, b.campaignNotes]), against: textOf([b.dislikes, b.anathema]) };
  }

  deriveTraits(actor) {
    const own = actor.items.filter(i => ["action", "feat", "heritage"].includes(i.type));
    const abilities = own.map(slugOf).filter(Boolean);
    // (Each feat, feature and action once, with its rules: what they do says something of who has them.)
    const seen = new Set();
    const items = own.map(i => ({ slug: slugOf(i), name: i.name, rules: i.system?.rules ?? [] })).filter(i => i.slug && !seen.has(i.slug) && seen.add(i.slug));
    const word = key => (key && hasWords(key) ? localize(key) : null);
    const pc = actor.type === "character";
    const skills = Object.entries(actor.skills ?? {});
    return derivePf2eTraits({
      type: actor.type,
      level: actor.level ?? 0,
      traits: actor.system.traits?.value ?? [],
      int: actor.system.abilities?.int?.mod ?? 0,
      wis: actor.system.abilities?.wis?.mod ?? 0,
      will: actor.saves?.will?.mod,
      abilities,
      items,
      hasMaster: actor.type === "familiar",
      ...(pc ? {
        con: actor.system.abilities?.con?.mod ?? 0,
        cls: actor.class?.slug ?? null,
        ancestry: actor.ancestry?.slug ?? null,
        background: actor.background?.slug ?? null,
        skills: Object.fromEntries(skills.map(([k, s]) => [k, s?.rank ?? 0])),
        perception: actor.perception?.rank ?? 1,
        inParty: actor.parties instanceof Set ? actor.parties.size > 0 : undefined,
        names: {
          abilities: Object.fromEntries(["int", "wis", "con"].map(k => [k, word(CONFIG.PF2E?.abilities?.[k]) ?? k])),
          cls: actor.class?.name, ancestry: actor.ancestry?.name, background: actor.background?.name,
          perception: actor.perception?.label ?? word("PF2E.PerceptionLabel"),
          ranks: [0, 1, 2, 3, 4].map(r => word(CONFIG.PF2E?.proficiencyLevels?.[r]) ?? String(r)),
          skills: Object.fromEntries(skills.map(([k, s]) => [k, s?.label ?? k]))
        }
      } : {})
    });
  }

  #leadershipEntry(actor, id) {
    const skills = actor.skills ?? {};
    return {
      id,
      level: actor.level ?? 0,
      skills: {
        diplomacy: skills.diplomacy?.mod,
        intimidation: skills.intimidation?.mod,
        warfareLore: skills["warfare-lore"]?.mod
      },
      isCommander: actor.class?.slug === "commander",
      tactics: actor.itemTypes?.action?.filter(i => i.system.traits?.value?.includes("tactic")).length ?? 0,
      abilities: actor.itemTypes?.action?.map(i => ({ key: slugOf(i) ?? "", name: i.name })) ?? []
    };
  }

  detectLeaders(specs) {
    return rankLeaders(specs.map(s => s.leadership).filter(Boolean));
  }

  /**
   * The kinds of thing a character can ask for in a standoff: PF2e's physical item types, precious materials and
   * rarities, in its own words.
   */
  itemCatalog() {
    const label = key => game.i18n.localize(key);
    const types = ["weapon", "armor", "shield", "ammo", "consumable", "equipment", "treasure", "book"].filter(k => CONFIG.Item.typeLabels?.[k]);
    const order = ["common", "uncommon", "rare", "unique"];
    const rarities = Object.keys(CONFIG.PF2E?.rarityTraits ?? {}).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    return {
      categories: types.map(key => ({ key, label: label(CONFIG.Item.typeLabels[key]) })),
      materials: Object.entries(CONFIG.PF2E?.preciousMaterials ?? {}).map(([key, v]) => ({ key, label: label(v) })),
      rarities: rarities.map(key => ({ key, label: label(CONFIG.PF2E.rarityTraits[key]) }))
    };
  }

  /** PF2e's own words for armor class, hit points and stamina (in the client's language). */
  term(key) {
    const own = { ac: "PF2E.ArmorClassShortLabel", hp: "PF2E.HitPointsShortLabel", sp: "PF2E.StaminaPointsShortLabel" }[key];
    return own && game.i18n.has(own) ? game.i18n.localize(own) : null;
  }

  /* -------------------------------------------- */

  async commitOutcome(tokenDoc, spec, final, options) {
    return commitPf2eOutcome(tokenDoc, spec, final, options);
  }

  resourceLabel(key) {
    if ( key === "fate" ) return game.i18n.localize("FFPF2E.HeroPoints");
    if ( key === "focus" ) return game.i18n.localize("FFPF2E.FocusPoint");
    if ( key.startsWith("slots:") ) return game.i18n.format("FFPF2E.SlotRank", { rank: key.split(":")[2] });
    return null;
  }

  describeOutcome(spec, final) {
    return describePf2eOutcome(spec, final);
  }

  async commitConcession(giverDoc, receiverDoc, concession) {
    return commitPf2eConcession(giverDoc, receiverDoc, concession);
  }
}

function level(actor) {
  return actor.level ?? 0;
}

/**
 * An item's text with its inline damage and checks worked out for this creature, as PF2e shows them: formulas that
 * use its level or ability scores, a class DC, its own rule elements (a kineticist's gate). Text with nothing to work
 * out is returned as it is.
 */
async function resolvedText(item) {
  const raw = englishDescription(item);
  if ( !/@Damage\[[^\]]*@|@Check\[(?![^\]]*\bdc:\d)/i.test(raw) ) return raw;
  let html;
  try {
    html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, { rollData: item.getRollData?.(), relativeTo: item });
  } catch ( err ) {
    return raw;
  }
  // (Parsed inert: a player's own item text never runs anything on the GM's screen.)
  const div = new DOMParser().parseFromString(String(html ?? ""), "text/html").body;
  const damage = [...div.querySelectorAll("[data-damage-roll]")].map(e => String(e.dataset.formula ?? "").replace(/^\{|\}$/g, ""));
  const checks = [...div.querySelectorAll("[data-pf2-check]")].map(e => {
    const dc = Number(e.dataset.pf2Dc) || Number(/DC (\d+)/i.exec(e.textContent)?.[1]);
    const basic = e.dataset.pf2Basic === "true" || /\bbasic\b/i.test(e.textContent);
    return Number.isFinite(dc) && dc > 0 ? `@Check[${e.dataset.pf2Check}|dc:${dc}${basic ? "|basic" : ""}]` : null;
  });
  let d = 0;
  let c = 0;
  return raw
    .replace(/@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\]/gi, m => { const f = damage[d++]; return f ? `@Damage[${f}]` : m; })
    .replace(/@Check\[[^\]]*\]/gi, m => checks[c++] ?? m);
}
