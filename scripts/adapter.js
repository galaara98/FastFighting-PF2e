/**
 * Pathfinder 2e adapter: reads PF2e actors into CombatantSpecs and commits outcomes back.
 * Data paths verified against pf2e 8.6.0 on Foundry v14.
 */
import { SystemAdapter, parseTypedFormula, parseFormula, describeMods } from "./core.js";
import { pf2eRules } from "./rules.js";
import { parseAffliction } from "./afflictions.js";
import { derivePf2eTraits, creatureKindOf } from "./traits.js";
import { rankLeaders } from "./leadership.js";
import { commitPf2eOutcome, describePf2eOutcome, commitPf2eConcession } from "./commit.js";
import { parseControl, parseCritRider, conditionsIn, plain } from "./control.js";
import { abilityAction } from "./abilities.js";
import { classActions, extraParts } from "./class-actions.js";
import { modsFromRules, spellRounds, spellReach, helps, effectRounds, ruleValue, ONE_ROLL } from "./effects.js";
import { aidAction } from "./edges.js";

const PRONE_EFFECTS = new Set(["knockdown", "improved-knockdown", "trip", "improved-trip"]);
const GRAB_EFFECTS = new Set(["grab", "improved-grab"]);
const AFFLICTION_TRAITS = new Set(["poison", "disease", "curse"]);
const HEAL_SPELLS_TWO_ACTION_BONUS = new Set(["heal", "heal-animal", "heal-companion"]);
const SPEED_KEYS = { land: "walk", fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" };
/** Spell Effect items, fetched once a session (the same Bless serves every cleric). */
/** Creature sizes, smallest first (dnd5e and PF2e use the same keys). */
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

export class Pf2eAdapter extends SystemAdapter {
  /** Building a summoned creature (which doesn't summon in turn). */
  #summoning = false;

  static systemId = "pf2e";

  get label() {
    return "Pathfinder 2e";
  }

  get rules() {
    return pf2eRules;
  }

  canHandle(actor) {
    return !!actor && ["character", "npc", "familiar"].includes(actor.type);
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
    const kind = actor.type === "familiar" || (actor.type === "character" && traits.includes("minion")) ? "companion"
      : actor.type === "character" ? "pc"
        : traits.includes("minion") ? "minion" : "npc";

    // Its Strikes, and what its class does with them (Vicious Swing, Double Slice, Flurry of Blows, Hunter's Edge ...).
    const { strikes, variants } = await this.#strikes(actor);
    const martial = classActions({ actorId: actor.id, slugs: new Set(actor.items.map(i => slugOf(i)).filter(Boolean)), level, strikes });
    const actions = [
      ...martial.strikes,
      ...martial.actions,
      ...variants,
      ...await this.#elementalBlasts(actor),
      ...this.#marks(actor),
      ...await this.#spells(actor),
      ...this.#consumables(actor),
      ...this.#feats(actor),
      ...await this.#selfEffects(actor),
      ...this.#skillActions(actor, traits, martial.strikes)
    ];
    actions.push(...await this.#abilities(actor, actions));

    const speeds = {};
    for ( const [key, value] of Object.entries(sys.movement?.speeds ?? {}) ) {
      const mode = SPEED_KEYS[key];
      const v = typeof value === "number" ? value : value?.value;
      if ( mode && v > 0 ) speeds[mode] = v;
    }
    if ( !speeds.walk && !Object.keys(speeds).length ) speeds.walk = 25;

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
      hp: { value: hp.value ?? 0, max: hp.max ?? 1, temp: hp.temp ?? 0 },
      defenses: {
        ac: sys.attributes?.ac?.value ?? 10,
        fortitude: actor.saves?.fortitude?.mod ?? level + 5,
        reflex: actor.saves?.reflex?.mod ?? level + 5,
        will: actor.saves?.will?.mod ?? level + 5
      },
      shield: shield?.ac > 0 && !shield.broken && !shield.destroyed ? { ac: shield.ac, hardness: shield.hardness } : null,
      initiative: { mod: actor.initiative?.mod ?? actor.perception?.mod ?? 0, stealth: actor.skills?.stealth?.mod ?? 0 },
      speeds,
      actions,
      iwr,
      resources,
      reactions: this.#reactions(actor),
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags, masterActorId: actor.type === "familiar" ? sys.master?.id ?? null : null },
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
      theft: actor.skills?.thievery?.proficient ? { skill: actor.skills.thievery.label ?? "Thievery", mod: actor.skills.thievery.mod } : null,
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
      social: this.#social(actor, level, traits),
      valuables: this.#valuables(actor),
      leadership: this.#leadershipEntry(actor, tokenDoc.id)
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
      if ( !best || s.mod > best.mod ) best = { mod: s.mod, label: game.i18n.localize("FFPF2E.RecallKnowledge") };
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
    const willDC = { dc: will?.dc?.value ?? level + 15, label: will?.label ?? "Will" };
    return {
      pitches: { persuade: skill("diplomacy"), intimidate: skill("intimidation"), deceive: skill("deception") },
      resist: {
        persuade: willDC,
        intimidate: willDC,
        deceive: { dc: actor.perception?.dc?.value ?? level + 15, label: actor.perception?.label ?? "Perception" },
        steal: { dc: actor.perception?.dc?.value ?? level + 15, label: actor.perception?.label ?? "Perception" }
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
      const entry = { id: item.id, name: item.name, value: Math.round((item.assetValue?.copperValue ?? 0) / Math.max(1, item.quantity)) };
      const carry = item.system.equipped?.carryType;
      if ( carry === "held" ) wielded.push(entry);
      else if ( carry === "stowed" ) stowed.push(entry);
    }
    return {
      money: inventory.currency?.copperValue ?? 0,
      denominations: [{ label: "pp", value: 1000 }, { label: "gp", value: 100 }, { label: "sp", value: 10 }, { label: "cp", value: 1 }],
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
    if ( has("devise-a-stratagem") ) setups.push({ key: "stratagem", label: "Devise a Stratagem", options: ["check:substitution:devise-a-stratagem"], precision: true });
    if ( has("panache") || actor.items.some(i => i.system?.traits?.value?.includes("finisher")) ) setups.push({ key: "finisher", label: "Finisher", options: ["self:effect:panache", "finisher"] });
    const strikes = (actor.system.actions ?? []).filter(s => s.type === "strike" && s.visible !== false);
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
        id: `${actor.id}.strike.${s.slug ?? index}.${index}`,
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
        const name = `Elemental Blast (${config.element})`;
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.melee`, name, cost: 1, melee: true, reach: 5, damage: await read(true, 1) });
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.ranged`, name, cost: 1, melee: false, range: { increment: feet, max: feet, noPenalty: true }, damage: await read(false, 1) });
        out.push({ ...base, id: `${actor.id}.blast.${config.element}.ranged2`, name: `${name}, two actions`, cost: 2, melee: false, range: { increment: feet, max: feet, noPenalty: true }, damage: await read(false, 2) });
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
          description: source.system.description?.value,
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
    const m = /(\d+d\d+)/.exec(item.system.description?.value ?? "");
    return m?.[1] ?? null;
  }

  #sneakAttackDice(actor) {
    const item = actor.items.find(i => slugOf(i) === "sneak-attack");
    if ( !item ) return null;
    if ( actor.type === "character" ) {
      const level = actor.level ?? 1;
      return `${level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1}d6`;
    }
    return /(\d+d\d+)/.exec(item.system.description?.value ?? "")?.[1] ?? null;
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
          ? parseControl({ description: spell.system.description?.value, duration: spell.system.duration?.value })
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
          if ( /\(constant\)/i.test(spell.name) ) continue;
          uses = /\(at[- ]will\)/i.test(spell.name) ? undefined : spell.system.location?.uses?.value ?? 1;
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
          const rider = parseCritRider(spell.system.description?.value);
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
    const trait = SUMMON_TRAITS[slug] ?? (/\b(animal|fey|undead|elemental|construct|plant|dragon|fiend|celestial|monitor|giant|aberration|beast)\b/i.exec(plain(spell.system.description?.value ?? ""))?.[1]?.toLowerCase() ?? "animal");
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
    const html = sys.description?.value ?? "";
    const text = plain(html);
    const mods = {};
    let tempHp = 0;
    const uuids = [];
    for ( const m of html.matchAll(/@UUID\[(Compendium\.pf2e\.spell-effects\.Item\.[^\]]+)\]/g) ) {
      const effect = await linkedEffect(m[1]);
      if ( effect ) uuids.push(m[1]);
      const read = modsFromRules(effect?.system?.rules ?? [], { rank: spell.rank ?? 1 });
      Object.assign(mods, read.mods);
      tempHp = Math.max(tempHp, read.tempHp);
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
      if ( ONE_ROLL.test(text) ) outcome.uses = 1;
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
        actions: item.system.actions?.value, actionType: item.system.actionType?.value, traits: item.system.traits?.value ?? [], strikes
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
    return [{ id: `${actor.id}.exploit-vulnerability`, name: "Exploit Vulnerability", kind: "control", auto: true, cost: 1, oncePerTurn: true,
      traits: ["esoterica", "manipulate"], melee: false, range: { increment: 60, max: 60, noPenalty: true },
      outcome: { mark: [{ dice: [], flat, type: "untyped", persistent: false, category: null }], rounds: 10, label: `exploited (+${flat})` } }];
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
    // Aid: for a friend's next roll at whoever it's set on (edges.js).
    const aid = aidAction({ id: `${actor.id}.aid`, name: game.i18n.localize("FFPF2E.Aid"), strikes,
      skills: ["diplomacy", "medicine", "intimidation", "deception"].map(skill).filter(Boolean).map(s => ({ mod: s.mod, rank: s.rank ?? 0 })) });
    if ( aid ) out.push(aid);
    const intimidation = skill("intimidation");
    if ( intimidation ) {
      out.push({ id: `${actor.id}.demoralize`, name: "Demoralize", kind: "control", cost: 1, traits: ["auditory", "concentrate", "emotion", "fear", "mental"], ...near,
        check: { mod: intimidation.mod ?? 0, against: "will" }, oncePerTarget: true,
        onHit: [null, null, { conditions: { frightened: 1 }, rounds: 1, label: "frightened 1" }, { conditions: { frightened: 2 }, rounds: 2, label: "frightened 2" }] });
    }
    if ( trained("athletics") ) {
      const prone = { conditions: { prone: 1 }, rounds: 1, label: "prone" };
      // (Only a creature at most one size larger.)
      out.push({ id: `${actor.id}.trip`, name: "Trip", kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1,
        check: { mod: skill("athletics").mod ?? 0, against: "reflex", attack: true }, onHit: [{ ...prone, self: true }, null, prone, prone] });
      // Grapple (Athletics against Fortitude, an attack): grabbed until the end of its next turn, restrained on a
      // critical success; a critical failure puts you on the ground.
      const held = { conditions: { immobilized: 1, offGuard: 1 }, rounds: 1, label: "grabbed" };
      out.push({ id: `${actor.id}.grapple`, name: "Grapple", kind: "control", cost: 1, traits: ["attack"], melee: true, reach: 5, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1,
        check: { mod: skill("athletics").mod ?? 0, against: "fortitude", attack: true }, onHit: [{ ...prone, self: true }, null, held, { ...held, label: "restrained" }] });
    }
    if ( trained("deception") ) {
      const exposed = { conditions: { offGuard: 1 }, onlyVs: true, rounds: 1, label: "off-guard" };
      out.push({ id: `${actor.id}.feint`, name: "Feint", kind: "control", cost: 1, traits: ["mental"], melee: true, reach: 5,
        check: { mod: skill("deception").mod ?? 0, against: "perception" }, onHit: [null, null, exposed, exposed] });
    }
    if ( skill("diplomacy") && actor.itemTypes?.feat?.some(f => slugOf(f) === "bon-mot") ) {
      const jab = n => ({ mods: { saves: -n, checks: -n }, rounds: 10, label: "flustered" });
      out.push({ id: `${actor.id}.bon-mot`, name: "Bon Mot", kind: "control", cost: 1, traits: ["auditory", "concentrate", "emotion", "linguistic", "mental"], ...near,
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
        name: "Battle Medicine",
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

  deriveTraits(actor) {
    const abilities = actor.items.filter(i => ["action", "feat"].includes(i.type)).map(slugOf).filter(Boolean);
    return derivePf2eTraits({
      type: actor.type,
      level: actor.level ?? 0,
      traits: actor.system.traits?.value ?? [],
      int: actor.system.abilities?.int?.mod ?? 0,
      wis: actor.system.abilities?.wis?.mod ?? 0,
      will: actor.saves?.will?.mod,
      abilities,
      hasMaster: actor.type === "familiar"
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

  difficultyCrossCheck(friendly, hostile) {
    const calc = game.pf2e?.gm?.calculateXP;
    const pcs = friendly.filter(s => s.kind === "pc");
    if ( !calc || !pcs.length || !hostile.length ) return null;
    const partyLevel = Math.round(pcs.reduce((s, p) => s + p.level, 0) / pcs.length);
    try {
      const result = calc(partyLevel, pcs.length, hostile.filter(h => h.kind !== "hazard").map(h => h.level), [], {
        proficiencyWithoutLevel: game.pf2e.settings?.variants?.pwol?.enabled ?? false
      });
      return { label: result.rating, xp: result.totalXP, partyLevel, budgets: result.encounterBudgets };
    } catch ( err ) {
      console.warn("fast-fighting | calculateXP failed", err);
      return null;
    }
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
  const raw = item.system.description?.value ?? "";
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
