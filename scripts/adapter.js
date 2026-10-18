/**
 * Pathfinder 2e adapter: reads PF2e actors into CombatantSpecs and commits outcomes back.
 * Data paths verified against pf2e 8.6.0 on Foundry v14.
 */
// (In a translated world, a Babele translation of PF2e's compendiums, an item's rules are read from the English Babele
// keeps of it, so they're understood whatever the language: the core's englishName and englishDescription.)
import { SystemAdapter, parseTypedFormula, parseFormula, describeMods, localize, hasWords, meanPart, part, englishName, englishDescription, plainText } from "./core.js";
import { pf2eRules } from "./rules.js";
import { parseAffliction, spellAffliction } from "./afflictions.js";
import { derivePf2eTraits, creatureKindOf, animalisticOf } from "./traits.js";
import { pf2eHints, pf2eTactics, healsOthers, textOf } from "./auto.js";
import { rankLeaders } from "./leadership.js";
import { commitPf2eChanges, describePf2eOutcome, commitPf2eConcession, commitPf2eBound, applyPf2eDamageCard, conditionSlug, engineKey, resourceName, IMPLIES } from "./commit.js";
import { readPf2eTurn, pf2eOpening, pf2eDamageCard, pf2eDisrupts } from "./read-turn.js";
import { strikesOf, strikeId, rollPf2eStrike } from "./strike-roll.js";
import { rollPf2eSave, rollPf2eCheck } from "./check-roll.js";
import { usePf2eAction, rollPf2eDamage } from "./action-roll.js";
import { parseControl, parseCritRider, conditionsIn, conditionsLabel, plain, escapeAt, failureRiders } from "./control.js";
import { abilityAction } from "./abilities.js";
import { classActions, extraParts } from "./class-actions.js";
import { t, actionName, traitName, featureName, coin, wordList, conditionLabel as conditionName } from "./words.js";
import { modsFromRules, spellRounds, spellReach, helps, effectRounds, ruleValue, ONE_ROLL } from "./effects.js";
import { aidAction, AID_SKILLS } from "./edges.js";
import { loreBoost } from "./lore.js";
import { escapeOf } from "./holds.js";
import { strikeHands, traitHands } from "./hands.js";
import { skillManeuvers, attackEffectOf, effectManeuver, keepHold, bonMot } from "./maneuvers.js";
import { GULLETS, gulletAction, lightStrike } from "./gullet.js";
import { linkedEffect, theirsToOpen } from "./granted.js";
import { AURA_REACTIONS, championReaction } from "./champion.js";
import { auraOf } from "./auras.js";
import { saveVsFrom } from "./save-vs.js";
import { reading } from "./reading.js";
import { GLOSSARY_SLUGS, glossaryActions, markGlossary, glossarySpec } from "./glossary.js";
import { itemReactions } from "./reactions-item.js";

const AFFLICTION_TRAITS = new Set(["poison", "disease", "curse"]);
const HEAL_SPELLS_TWO_ACTION_BONUS = new Set(["heal", "heal-animal", "heal-companion", "harm"]);
const SPEED_KEYS = { land: "walk", fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" };
/** A creature's rarity, as the core counts it (spec.rarity). */
const RARITY = Object.freeze({ common: 0, uncommon: 1, rare: 2, unique: 3 });
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

/** PF2e conditions the engine keeps elsewhere (its own numbers and its persistent damage), not as conditions. */
const NOT_CONDITIONS = new Set(["dying", "wounded", "doomed", "persistent-damage"]);

/** What a character calls its feats, features and actions, by slug (a translated compendium's names). */
function ownNames(actor) {
  const out = {};
  for ( const i of actor.items ?? [] ) {
    const slug = slugOf(i);
    if ( slug && !(slug in out) ) out[slug] = i.name;
  }
  return out;
}

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

/**
 * Does a spell reach only its caster? PF2e leaves a spell on yourself with no range, no area and no target (Harmonize
 * Self, Cloak of Light); one with an area around you reaches those in it.
 */
export function selfOnlySpell(system) {
  return !String(system?.range?.value ?? "").trim() && !system?.area && !String(system?.target?.value ?? "").trim();
}

/** Rough number of enemies caught by an area. */
/** A spell's area as the core takes it: how many it catches, and its shape and size where pf2e gives them. */
function areaSpec(area, targets) {
  return area?.type ? { targets, shape: area.type === "cylinder" ? "burst" : area.type, feet: Number(area.value) || 5 } : { targets };
}

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

/**
 * Its dying numbers (spec.dyingMax, spec.recoveryDC), as PF2e works them out from its feats' rules: the dying value it
 * dies at with no doom (PF2e's maximum has its doomed value off already) and the DC its recovery checks start from.
 * Nothing for a creature without them (a hazard): the rules' own 4 and 10 stand.
 */
export function dyingOf(attributes) {
  const dying = attributes?.dying;
  const out = {};
  if ( Number.isFinite(dying?.max) ) out.dyingMax = dying.max + (Number(attributes.doomed?.value) || 0);
  if ( Number.isFinite(dying?.recoveryDC) ) out.recoveryDC = dying.recoveryDC;
  return out;
}

/**
 * Its immunities, weaknesses and resistances as PF2e prepared them (actor.attributes), for iwr.js: {immune: [keys],
 * weak: {key: n}, resist: {key: n}}, with `except` ({immune|weak|resist: {key: [keys]}}: a resistance to physical damage
 * but not silver's) and `doubleVs` ({key: [keys]}: a ghost's resistance doubled against non-magical damage) where it
 * has them. Of two of a key, the higher. An exception PF2e words itself (a custom label, not a key) is left out.
 */
export function iwrOf(attributes) {
  const iwr = { immune: [], weak: {}, resist: {} };
  const keys = list => (Array.isArray(list) ? list.filter(x => typeof x === "string" && x) : []);
  const except = (kind, entry) => {
    const list = keys(entry.exceptions);
    if ( list.length ) ((iwr.except ??= {})[kind] ??= {})[entry.type] = list;
  };
  for ( const i of attributes?.immunities ?? [] ) {
    if ( !i?.type ) continue;
    if ( !iwr.immune.includes(i.type) ) iwr.immune.push(i.type);
    except("immune", i);
  }
  for ( const [kind, list] of [["weak", attributes?.weaknesses], ["resist", attributes?.resistances]] ) {
    for ( const e of list ?? [] ) {
      const value = Number(e?.value) || 0;
      if ( !e?.type || (iwr[kind][e.type] ?? -Infinity) >= value ) continue;
      iwr[kind][e.type] = value;
      if ( iwr.except?.[kind] ) delete iwr.except[kind][e.type];
      except(kind, e);
      const doubled = kind === "resist" ? keys(e.doubleVs) : [];
      if ( doubled.length ) (iwr.doubleVs ??= {})[e.type] = doubled;
      else if ( iwr.doubleVs ) delete iwr.doubleVs[e.type];
    }
  }
  return iwr;
}

/**
 * What a Strike's damage is made of, as PF2e's own damage roll has it (a weakness to cold iron, a resistance but to
 * silver): its weapon's precious material, a creature's attack's material traits, and what rule elements add or take
 * away (PF2e's strike adjustments, called as its damage roll calls them). `materialKeys`: PF2e's material damage
 * effects (CONFIG.PF2E.materialDamageEffects).
 * @returns {string[]}
 */
export function strikeMaterials(item, { materialKeys = [], adjustments = [] } = {}) {
  const known = new Set(materialKeys);
  const out = new Set();
  if ( item?.type === "melee" ) for ( const t of item.system?.traits?.value ?? [] ) if ( known.has(t) ) out.add(t);
  const type = item?.system?.material?.type;
  if ( known.has(type) ) out.add(type);
  for ( const a of adjustments ?? [] ) {
    try {
      a?.adjustDamageRoll?.(item, { materials: out });
    } catch ( err ) {
      // (One that can't be worked out here: as if it weren't there.)
    }
  }
  return [...out].filter(m => known.has(m));
}

/** A Strike's weapon's property runes (ghost touch, for iwr.js): their keys. */
export function propertyRunesOf(item) {
  const runes = item?.system?.runes?.property;
  return Array.isArray(runes) ? runes.filter(r => typeof r === "string" && r) : [];
}

/** {[key]: list}, or nothing for an empty one (so a spec carries no empty lists). */
const nonEmpty = (key, list) => (list?.length ? { [key]: list } : {});

/** A creature's Ferocity, a character's Orc Ferocity (by slug). */
const FEROCITY = new Set(["ferocity", "orc-ferocity"]);

/**
 * Reactions read their own way, by slug (#reactions, champion.js, traits.js's Reactive Strike, Ferocity): never read
 * again by reactions-read.js.
 */
export const OWN_READING = new Set(["shield-block", "reactive-shield", "nimble-dodge", "intercept-attack", "nimble-reprisal", "reactive-strike",
  "attack-of-opportunity", "undying-ferocity", ...FEROCITY, ...AURA_REACTIONS]);

/**
 * Its Ferocity (spec.ferocity, for rules.onDropped): a reaction as it would fall, to stay up at 1 Hit Point. A
 * character's as often as its frequency has left (once a day); a creature's until it's wounded 3. Undying Ferocity
 * adds temporary Hit Points, its level. Null when it has none.
 */
export function ferocityOf(items, level) {
  const list = [...(items ?? [])];
  const item = list.find(i => FEROCITY.has(slugOf(i)));
  if ( !item ) return null;
  const often = item.system?.frequency;
  return {
    label: item.name ?? "",
    uses: Number(often?.max) > 0 ? Math.max(0, Number(often.value ?? often.max) || 0) : null,
    untilWounded: slugOf(item) === "ferocity" ? 3 : null,
    temp: list.some(i => slugOf(i) === "undying-ferocity") ? Math.max(0, Number(level) || 0) : 0
  };
}

/** Is it trained in a skill (by slug): its rank, or for a creature, a skill its stat block lists. */
function trainedIn(actor, slug) {
  const skill = actor?.skills?.[slug];
  return !!skill && ((skill.rank ?? 0) >= 1 || (actor.type === "npc" && !!actor.system?.skills?.[slug]));
}

/** Its Acrobatics, for Tumble Through (rules.passThrough): {mod}, for one trained in it; undefined otherwise. */
export function acrobaticsOf(actor) {
  return trainedIn(actor, "acrobatics") ? { mod: Number(actor.skills.acrobatics.mod) || 0 } : undefined;
}

/** A Strike's reach, in feet: its reach trait's, else the item's (5). */
function reachOf(item) {
  const trait = (item?.system?.traits?.value ?? []).find(t => /^reach(-\d+)?$/.test(t));
  return trait ? (Number(trait.split("-")[1]) || 10) : (Number(item?.reach) || 5);
}

/** A PF2e key's word, if the system has one (its attack effects' names: PF2E.AttackEffectGrab). */
const systemWord = key => (hasWords(key) ? localize(key) : null);

/**
 * An attack effect's maneuver, as the creature tries it (maneuvers.js effectManeuver): named for its ability (the
 * creature's own item, else PF2e's name for the effect, else the maneuver's), and the maneuver's too where it has two
 * (Push or Pull); its id the ability's item's, else the effect's slug; its Athletics, and its size one up.
 */
function effectAction(actor, slug, source, tries, how, { reach = 5, cost = 1 } = {}) {
  const pascal = String(slug).replace(/(?:^|-)(\w)/g, (m, c) => c.toUpperCase());
  const maneuver = actionName(how.action.charAt(0).toUpperCase() + how.action.slice(1));
  const named = source?.name ?? systemWord(`PF2E.AttackEffect${pascal}`) ?? maneuver;
  const name = tries.maneuvers.length > 1 ? t("EffectManeuver", { effect: named, maneuver }) : named;
  return effectManeuver({
    id: `${actor.id}.${source?.id ?? slug}`, name, how, feet: tries.feet, attack: tries.attack, reach, cost,
    athletics: Number(actor.skills?.athletics?.mod) || 0, maxSize: sizeOf(actor.size ?? actor.system?.traits?.size?.value) + 1
  });
}

/**
 * What a Strike carries beyond its damage, by the attack effects it lists (their slugs): a poison, disease or curse of
 * the creature's (afflictions.js), and the Improved maneuvers (maneuvers.js attackEffectOf: Improved Grab, Knockdown
 * and Push), each tried free at the one it hit, with a roll of its own (the core's maneuver rider: {kind: "control"}).
 * The plain ones (Grab, Knockdown, Push, Pull) are actions after the hit: effectFollowUps.
 */
export function attackEffects(actor, item) {
  const effects = [];
  const items = [...(actor?.items ?? [])];
  for ( const slug of item?.system?.attackEffects?.value ?? [] ) {
    const source = items.find(i => slugOf(i) === slug);
    const traits = source?.system?.traits?.value ?? [];
    const tries = attackEffectOf(slug, englishName(source));
    if ( source && traits.some(t => AFFLICTION_TRAITS.has(t)) ) {
      const parsed = parseAffliction({
        id: `${actor.id}.${slug}`,
        name: source.name,
        slug,
        description: englishDescription(source),
        traits
      });
      if ( parsed ) effects.push(parsed);
    } else if ( tries?.free ) {
      for ( const how of tries.maneuvers ) effects.push({ kind: "control", control: effectAction(actor, slug, source, tries, how, { reach: reachOf(item), cost: 0 }) });
    }
  }
  return effects;
}

/**
 * The actions its Strikes' plain attack effects give it (maneuvers.js): Grab, Knockdown, Push and Pull (and a listed
 * Trip), each an action straight after a hit with a Strike that lists it (the core's requires.lastHit, those Strikes'
 * ids), one for each ability; and, for a creature with Grab or Improved Grab, Grab used to keep hold of a creature it
 * holds (keepHold).
 * @param {object} actor
 * @param {{id: string, slugs: string[], reach: number}[]} strikes  its Strikes' ids, the attack effects each lists, and
 *   its reach
 */
export function effectFollowUps(actor, strikes = []) {
  const items = [...(actor?.items ?? [])];
  const listed = new Map();
  for ( const s of strikes ) {
    for ( const slug of s.slugs ?? [] ) {
      const at = listed.get(slug) ?? { ids: [], reach: 0 };
      at.ids.push(s.id);
      at.reach = Math.max(at.reach, Number(s.reach) || 5);
      listed.set(slug, at);
    }
  }
  const out = [];
  let keep = null;
  for ( const [slug, { ids, reach }] of listed ) {
    const source = items.find(i => slugOf(i) === slug);
    const tries = attackEffectOf(slug, englishName(source));
    if ( !tries || (source && (source.system?.traits?.value ?? []).some(t => AFFLICTION_TRAITS.has(t))) ) continue;
    if ( tries.maneuvers.some(m => m.maneuver === "grapple") ) keep ??= keepHold({ id: `${actor.id}.${source?.id ?? slug}`, name: effectAction(actor, slug, source, tries, tries.maneuvers[0]).name, reach });
    if ( tries.free ) continue;
    for ( const how of tries.maneuvers ) out.push({ ...effectAction(actor, slug, source, tries, how, { reach }), requires: { lastHit: { with: ids } } });
  }
  if ( keep ) out.push(keep);
  return out;
}

/** Elements that show in the story (an attack's trait, by slug), and the damage they may be told over: a plain blow. */
const ELEMENT_LOOKS = Object.freeze({ air: "wind", water: "water", earth: "earth", wood: "plant", plant: "plant" });
const PLAIN_DAMAGE = new Set(["bludgeoning", "piercing", "slashing", "untyped", "force"]);

/**
 * How an attack looks in the story, where its group or traits say more than its damage (the core's story families): a
 * firearm's shot is gunfire; an air, water, earth or wood attack is that element when its harm is a plain blow (a
 * lightning bolt with the air trait is still lightning). Undefined: its damage says.
 */
function storyLook(traits = [], group = null, damage = []) {
  if ( group === "firearm" ) return "ballistic";
  if ( !damage.length || !damage.every(p => PLAIN_DAMAGE.has(p.type)) ) return undefined;
  return traits.map(t => ELEMENT_LOOKS[t]).find(Boolean);
}

/** The system's senses (by slug) that are the core's lowlight or smell; any other, but these, is felt. */
const SENSES = Object.freeze({
  darkvision: "lowlight", "greater-darkvision": "lowlight", "infrared-vision": "lowlight", truesight: "lowlight",
  scent: "smell"
});
const NOT_SENSES = new Set(["vision", "low-light-vision", "see-invisibility"]);
/** The senses that see (dazzled clouds them all). */
const SIGHTS = new Set([...NOT_SENSES, "darkvision", "greater-darkvision", "infrared-vision", "truesight"]);

/** Has it a precise sense besides sight (so dazzled doesn't conceal everything from it: rules.js flatCheck)? */
export const otherPrecise = senses => Array.from(senses ?? []).some(s => s?.acuity === "precise" && !SIGHTS.has(String(s?.type ?? "")));

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

  /** The real fight leaves a fallen creature's gear as loot: a lootable corpse, or a pile (that may take the body's place). */
  get supportsLoot() {
    return true;
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
    const { strikes, variants, listed } = await this.#strikes(actor);
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
      ...this.#poisons(actor, martial.strikes),
      ...own(this.#feats(actor)),
      ...own(await this.#selfEffects(actor)),
      ...this.#skillActions(actor, traits, martial.strikes),
      // (Grab, Knockdown, Push and Pull: an action after a hit with a Strike that lists one; Grab kept up.)
      ...own(effectFollowUps(actor, listed))
    ];
    actions.push(...own(await this.#abilities(actor, actions)));
    // Its standard abilities, by slug (glossary.js): Draconic Frenzy, Rend and Pounce from its Strikes; Constrict only
    // on a creature it holds; Draconic Momentum's breath back on a critical hit; and its passives, on the spec.
    const glossed = await this.#glossary(actor);
    actions.push(...own(glossaryActions({ actorId: actor.id, abilities: glossed, strikes: martial.strikes })));
    markGlossary(actions, glossed, actor.items.map(i => ({ id: i.id, slug: slugOf(i) })));
    const passives = glossarySpec({ abilities: glossed, bright: !!tokenDoc.parent?.isBright, constant: constantSpells(actor) });
    // The free hands each needs (hands.js): what hasn't said already (a Strike by its weapon's grip), by its traits.
    for ( const a of actions ) a.hands ??= traitHands(a.traits);

    const speeds = {};
    for ( const [key, value] of Object.entries(sys.movement?.speeds ?? {}) ) {
      const mode = SPEED_KEYS[key];
      const v = typeof value === "number" ? value : value?.value;
      if ( mode && v > 0 ) speeds[mode] = v;
    }
    if ( !hazard && !speeds.walk && !Object.keys(speeds).length ) speeds.walk = 25; // (a hazard stays where it is)

    // (With their exceptions and a resistance's doubleVs, as PF2e prepared them: iwr.js applies them.)
    const iwr = iwrOf(actor.attributes);

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
    // (A formula's numbers in its rule elements: its level and attribute modifiers.)
    const ruleActor = { level, abilities: Object.fromEntries(Object.entries(sys.abilities ?? {}).map(([k, v]) => [k, { mod: Number(v?.mod) || 0 }])) };
    return {
      ...mending,
      ...(passives.swarmMind ? { swarmMind: true } : {}),
      ...(passives.camouflage ? { camouflage: true } : {}),
      ...(passives.surpriseAttack && actor.type !== "character" ? { surpriseAttack: true } : {}),
      saveUpgrades: upgrades.length ? upgrades : undefined,
      // Bonuses to its saves against some effects only, that its sheet's saves leave out (save-vs.js), and its auras
      // that make foes save (auras.js).
      saveVs: saveVsFrom(actor.items, { traits: knownTraits(), actor: ruleActor }),
      auras: await this.#auras(actor, ruleActor),
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
      // Void healing (PF2e's negativeHealing: the undead, or an ability that gives it): vitality harms it, void doesn't,
      // and only void heals it (iwr.js).
      ...(hp.negativeHealing ? { voidHealing: true } : {}),
      resources,
      reactions: await this.#reactions(actor, actions),
      traits: Object.fromEntries(Object.entries(derived.traits).map(([k, v]) => [k, { base: v, fudge: 0 }])),
      traitReasons: derived.reasons,
      flags: { ...derived.flags, ...(hazard ? { fearless: true, mindless: true } : {}), masterActorId: actor.type === "familiar" ? sys.master?.id ?? null : null },
      diesAtZero: actor.type !== "character",
      wounded: sys.attributes?.wounded?.value ?? 0,
      doomed: sys.attributes?.doomed?.value ?? 0,
      dying: sys.attributes?.dying?.value ?? 0,
      // The dying value it dies at before any doom (4; 5 with Diehard) and its recovery checks' DC (10; 9 with
      // Toughness), as PF2e works them out from its feats' rules.
      ...dyingOf(sys.attributes),
      // Ferocity, Orc Ferocity: a reaction that keeps it up at 1 Hit Point (rules.onDropped).
      ferocity: ferocityOf(actor.items, level),
      // A fight resumed mid-way starts from where things stand.
      conditions: withConditions(this.#conditions(actor), passives.conditions),
      persistent: this.#persistent(actor),
      perception: actor.perception?.mod ?? actor.initiative?.mod ?? 0,
      senses: this.#senses(actor),
      otherPrecise: otherPrecise(actor.perception?.senses) || undefined,
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
      // Breaking free (holds.js): its best way out (escapeWork), and how hard its own grab (escapeDC, Athletics) and its
      // knots (tiesDC, Thievery) are to break. (A hazard doesn't struggle.)
      ...(hazard ? {} : escapeOf(actor)),
      // Getting past a foe on the way: Tumble Through, for those trained in Acrobatics (rules.passThrough).
      acrobatics: hazard ? undefined : acrobaticsOf(actor),
      // What its Swallow Whole or Engulf does to whoever is inside it (gullet.js; rules.conditionHarm and cutFree).
      gullet: gulletsOf(actions),
      creatureTraits: traits,
      // (Whether it fights as an animal does: the core's behavior/animal.js.)
      animalistic: !hazard && actor.type !== "character" && animalisticOf({ traits, int: actor.system.abilities?.int?.mod ?? 0, languages: [...(actor.system.details?.languages?.value ?? [])] }),
      creatureKind: creatureKindOf(traits, Object.keys(CONFIG.PF2E?.ancestryTraits ?? {})), // (the planner groups neutrals by it)
      size: sizeOf(actor.size ?? sys.traits?.size?.value),
      social: hazard ? { mindless: true, languages: [], pitches: {}, resist: {} } : { ...this.#social(actor, level, traits), ...(passives.anyLanguage ? { anyLanguage: true } : {}) },
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
   * Its senses, sorted into the core's (spec.senses), the farthest of each in feet (no range: no limit): darkvision
   * and its kin see in the dark (lowlight); scent is smell; every other sense of its own (tremorsense, lifesense,
   * echolocation, electromagnetic sense ...) is felt. No vision: no sight. Low-light vision sees only in dim light,
   * which the core doesn't tell apart from bright, and see invisibility only what's invisible: neither counts.
   */
  #senses(actor) {
    const out = {};
    for ( const s of Array.from(actor.perception?.senses ?? []) ) {
      const type = String(s?.type ?? "");
      const sense = SENSES[type] ?? (type && !NOT_SENSES.has(type) ? "feel" : null);
      if ( !sense || out[sense] === null ) continue;
      const range = Number.isFinite(Number(s?.range)) ? Number(s.range) : null;
      out[sense] = range === null ? null : Math.max(out[sense] ?? 0, range);
    }
    if ( actor.perception?.hasVision === false ) out.sight = 0;
    return out;
  }

  /** Its conditions as the engine's keys: each one's own (off-guard: offGuard), and what it also means (IMPLIES). */
  #conditions(actor) {
    const out = {};
    const raise = (key, value) => { out[key] = Math.max(out[key] ?? 0, value); };
    for ( const c of actor.itemTypes?.condition ?? [] ) {
      if ( !c.slug || NOT_CONDITIONS.has(c.slug) ) continue;
      raise(engineKey(c.slug), typeof c.value === "number" ? c.value : 1);
      for ( const key of IMPLIES[c.slug] ?? [] ) raise(key, 1);
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
   *  - what an off-guard target adds (Sneak Attack, and the archetypes' and other classes' like it) is extra
   *    precision damage against an off-guard foe;
   *  - a Strike set up by a class action is an action of its own: an investigator's Devise a Stratagem (Strategic
   *    Strike), a swashbuckler's finisher with panache (Precise Strike).
   * A bomb or other consumable weapon can be thrown only as many times as it has.
   * @returns {Promise<{strikes: object[], variants: object[], listed: object[]}>}  `listed`: each Strike's attack effects
   *   that try a maneuver (effectFollowUps)
   */
  async #strikes(actor) {
    const out = [];
    const variants = [];
    const listed = []; // (the attack effects each lists that try a maneuver: effectFollowUps)
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
          console.warn(`fast-fighting-pf2e | could not read damage for ${actor.name} ${s.label}`, err);
          return null;
        }
      };
      const normal = await formula();
      const crit = await formula([], true);
      const damage = normal ? parseTypedFormula(normal) : [];
      const effects = attackEffects(actor, item);
      // (An attack effect that tries a maneuver: an action after its hit, or Grab kept up: effectFollowUps.)
      const follows = (item?.system?.attackEffects?.value ?? []).filter(slug => attackEffectOf(slug));
      if ( !damage.length && !effects.length && !follows.length ) continue;
      // (A magic weapon's blow is magical, as PF2e's item:magical has it, its runes and all: iwr.js, against a
      // resistance doubled against non-magical damage.)
      const traits = [...(item?.system?.traits?.value ?? [])];
      if ( item?.isMagical && !traits.includes("magical") ) traits.push("magical");
      const ranged = !!item?.isRanged;
      const range = item?.range ?? item?.system?.range ?? null;
      const reach = reachOf(item);
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
        slug: s.slug ?? undefined, // (its item's, for a requirement or a multiattack that names it: glossary.js)
        kind: "strike",
        cost: 1 + reload,
        bonus: s.totalModifier ?? 0,
        maps: traits.includes("agile") ? [0, -4, -8] : [0, -5, -10],
        melee: !ranged,
        // (Thrown, the weapon flies itself; any other ranged weapon sends a shot: the story tells which.)
        thrown: ranged && traits.some(x => x === "thrown" || x.startsWith("thrown-") || x === "bomb"),
        reach,
        range: ranged && range ? { increment: range.increment ?? range.max ?? 30, max: range.max ?? (range.increment ?? 30) * 6 } : null,
        damage,
        critDamage: crit ? parseTypedFormula(crit) : null,
        effects,
        bonusDamage,
        // (Quick Draw: drawing it is part of the Strike.)
        drawCost: s.ready === false && character && !has("quick-draw") ? 1 : 0,
        traits,
        storyType: storyLook(traits, item?.system?.group ?? null, damage),
        // (A weapon in hand, one that can be knocked away: a character's weapon, or a creature's that has one.)
        held: ["simple", "martial", "advanced"].includes(item?.category) || undefined,
        // The free hands it takes (hands.js): its grip; a fist one, jaws none.
        hands: strikeHands(item),
        // (Light enough to attack with from inside a gullet: unarmed, a creature's own, a weapon of light Bulk.)
        light: lightStrike(item) || undefined,
        // (What its damage is made of, and its property runes: a weakness to cold iron, a ghost's resistance but to a
        // ghost touch weapon. iwr.js.)
        ...nonEmpty("materials", strikeMaterials(item, { materialKeys: Object.keys(CONFIG.PF2E?.materialDamageEffects ?? {}), adjustments: actor.synthetics?.strikeAdjustments })),
        ...nonEmpty("propertyRunes", propertyRunesOf(item)),
        ...(consumable ? { resource: `item:${item.id}`, pool: quantity, itemId: item.id } : {})
      };
      out.push(strike);
      if ( follows.length ) listed.push({ id: strike.id, slugs: follows, reach });
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
    const mean = a => (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0);
    const picked = [];
    for ( const setup of setups ) {
      const best = variants.filter(v => v.setup === setup).map(v => v.strike).sort((a, b) => mean(b) - mean(a))[0];
      if ( best ) picked.push(best);
    }
    return { strikes: out, variants: picked, listed };
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
      console.warn(`fast-fighting-pf2e | could not read ${actor.name}'s Elemental Blast`, err);
    }
    return out.filter(a => a.damage.length);
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
        // (Its traits, and the tradition it's cast in, as PF2e's own roll options have it: a save against arcane magic.)
        const tradition = entry.tradition ?? entry.system?.tradition?.value ?? null;
        const own = spell.system.traits?.value ?? [];
        const traits = tradition && !own.includes(tradition) ? [...own, tradition] : own;
        const parts = roll ? parseTypedFormula(roll.formula) : [];
        // An affliction it lays (Spider Sting's spider venom, Goblin Pox): its save the exposure, then stages worked off
        // with saves against the spell DC (afflictions.js).
        const saved = spell.system.defense?.save;
        const afflicts = saved ? spellAffliction({ id: `${actor.id}.spell.${spell.id}.affliction`, html: await resolvedText(spell), name: spell.name, traits,
          save: { type: saved.statistic, dc: stat.dc?.value ?? 10 + levelOf(actor) } }) : null;
        // No damage: maybe it's crowd control, conditions by degree of the target's save or of a spell attack.
        const control = !parts.length && !afflicts && (saved || spell.isAttack)
          ? parseControl({ description: englishDescription(spell), duration: spell.system.duration?.value })
          : null;
        // No damage and no conditions by degree: a buff for friends or a debuff for foes, from its Spell Effect.
        const support = !parts.length && !control && !afflicts ? await this.#spellSupport(spell, stat) : null;
        // A summon spell: the creature it most likely calls, which must be Sustained.
        const summon = traits.includes("summon") && !this.#summoning ? await this.#summon(spell) : null;
        if ( !parts.length && !control && !support && !summon && !afflicts ) continue;

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
          // (PF2e says "at will" and "constant" only in brackets in the spell's name: "Translocate (At Will)", in the
          // compendium's language. At will is as often as it likes; a constant one is always on, not cast. The words
          // are FFPF2E.Innate's, in the reader's language and in English.)
          const tags = new Set([...`${englishName(spell)} ${spell.name}`.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim().toLowerCase().replace(/\s+/g, " ")));
          if ( wordList("Innate.Constant").some(w => tags.has(w)) ) continue;
          uses = wordList("Innate.AtWill").some(w => tags.has(w)) ? undefined : spell.system.location?.uses?.value ?? 1;
        }
        const id = `${actor.id}.spell.${spell.id}`;
        const rangeFeet = parseFeet(spell.system.range?.value);
        const area = spell.system.area;
        // (Healing: a spell with the healing trait, or one that harms some and heals others, Harm. One with a save that
        // does both, Heal and Harm, is both: a heal for whom its energy mends, and its damage for whom it harms, by void
        // healing, rules.js usable and iwr.js. The use that isn't its own trait's has its own id: `.heal`, `.harm`.)
        const isHeal = kinds.has?.("healing") && (traits.includes("healing") || kinds.has?.("damage"));
        const both = isHeal && kinds.has?.("damage") && !!spell.system.defense?.save;
        const healId = traits.includes("healing") ? id : `${id}.heal`;
        // (A hand for one cast with gestures: the manipulate trait.)
        const hands = traitHands(traits);
        if ( summon ) {
          out.push({ id, name: spell.name, cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, hands, ...summon });
          continue;
        }
        if ( support ) {
          out.push({ id, name: spell.name, cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, hands, ...support });
          continue;
        }

        if ( isHeal ) {
          let heal = parts.map(p => ({ ...p, type: "healing" }));
          if ( HEAL_SPELLS_TWO_ACTION_BONUS.has(spell.slug) && cost === 2 ) {
            heal = heal.map((p, i) => i === 0 ? { ...p, flat: p.flat + 8 * (spell.rank ?? 1) } : p);
          }
          const animalOnly = /animal/i.test(spell.system.target?.value ?? "");
          // One-action heal is a touch; two actions reach 30 feet (its range "varies" with the actions spent).
          const variable = HEAL_SPELLS_TWO_ACTION_BONUS.has(spell.slug);
          const touch = variable ? cost === 1 : /touch/i.test(spell.system.range?.value ?? "");
          const feet = variable ? 30 : rangeFeet;
          const reach = touch ? { reach: 5 } : feet ? { range: { increment: feet, max: feet, noPenalty: true } } : {};
          out.push({
            id: healId, name: spell.name, kind: "heal", cost, heal, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, hands,
            targetTrait: animalOnly ? "animal" : null, ...reach, ...(selfOnlySpell(spell.system) ? { selfOnly: true } : {})
          });
          if ( !both ) continue;
        }
        const defense = spell.system.defense;
        if ( control ) {
          const action = {
            id, name: spell.name, kind: "control", cost, resource, pool, uses, spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, hands,
            melee: false, range: { increment: rangeFeet ?? area?.value ?? 30, max: rangeFeet ?? area?.value ?? 30, noPenalty: true }
          };
          // (A hold it lays that an Escape breaks, Web's, Tangle Vine's: against the spell DC.)
          const spellDC = stat.dc?.value ?? 10 + levelOf(actor);
          if ( defense?.save ) {
            action.save = { type: defense.save.statistic, dc: spellDC, basic: false };
            // (Dominate: a save at the end of each of its turns, against the caster's DC.)
            action.onSave = escapeAt(control.map(o => (o?.repeatSave ? { ...o, repeatSave: { type: action.save.type, dc: action.save.dc } } : o)), spellDC);
          } else {
            // A spell attack: the degrees are the caster's (critical success, success ...).
            action.bonus = stat.check?.mod ?? 0;
            action.maps = [0, -5, -10];
            action.onHit = escapeAt(control, spellDC);
          }
          const targets = areaTargets(area, spell.system.target?.value);
          if ( targets > 1 ) action.area = areaSpec(area, targets);
          out.push(action);
          continue;
        }
        if ( !kinds.has?.("damage") && !afflicts ) continue;
        const action = {
          id: isHeal && healId === id ? `${id}.harm` : id, name: spell.name, cost, damage: parts, resource, pool, uses,
          spellId: spell.id, entryId: entry.id, rank: spell.rank, traits, hands, storyType: storyLook(traits, null, parts),
          melee: false,
          range: { increment: rangeFeet ?? area?.value ?? 30, max: rangeFeet ?? area?.value ?? 30, noPenalty: true }
        };
        if ( /touch/i.test(spell.system.range?.value ?? "") ) {
          action.melee = true;
          action.reach = 5;
          action.range = null;
        }
        const targets = areaTargets(area, spell.system.target?.value);
        if ( targets > 1 ) action.area = areaSpec(area, targets);
        if ( spell.isAttack ) {
          action.kind = "spell-attack";
          action.bonus = stat.check?.mod ?? 0;
          action.maps = [0, -5, -10];
        } else if ( defense?.save ) {
          action.kind = "save";
          action.save = { type: defense.save.statistic, dc: stat.dc?.value ?? 10 + levelOf(actor), basic: !!defense.save.basic };
          // "If the target critically fails the save, it is also stunned 1." Else what a failure (or a critical failure)
          // lays by degree: Impaling Spike's immobilized, an Escape against the spell DC away.
          const rider = parseCritRider(englishDescription(spell));
          const laid = rider ? [rider] : failureRiders(escapeAt(parseControl({ description: englishDescription(spell), duration: spell.system.duration?.value }), action.save.dc));
          // (And its affliction, on a failed save.)
          if ( afflicts ) laid.unshift(afflicts);
          if ( laid.length ) action.effects = laid;
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
    spec.sourceUuid = src.uuid; // (a live battle places it from here)
    // (How far off it appears: the spell's range, 30 feet for most; the core's, where it gives none.)
    const feet = parseFeet(spell.system.range?.value);
    return { kind: "summon", creatures: [spec], rounds: spellRounds(spell.system.duration?.value) ?? 10, sustain: { actions: 1 }, sustainOrEnd: true, ...(feet ? { range: { increment: feet, max: feet, noPenalty: true } } : {}) };
  }

  /**
   * A spell that works through its Spell Effect: a buff for friends (Bless, Heroism, Courageous Anthem, Protection,
   * Haste), a debuff on foes who fail a save (Bane, Malediction), or conditions laid on enemies with no save at all
   * (Dirge of Doom). Null when it does nothing the engine plays out.
   */
  async #spellSupport(spell, stat) {
    const sys = spell.system;
    const html = englishDescription(spell);
    const text = plain(html);
    const mods = {};
    let tempHp = 0;
    let oneRoll = false;
    // (Healing over time its Spell Effect lends: Life Boost's fast healing, Regenerate's regeneration.)
    let fastHealing = 0;
    let regen = null;
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
      fastHealing = Math.max(fastHealing, read.fastHealing ?? 0);
      if ( read.regen && (!regen || read.regen.amount > regen.amount) ) regen = read.regen;
    }
    // Haste: quickened, an extra action each turn (for Strikes and Strides).
    if ( /\bquickened\b/i.test(text) ) mods.actions = Math.max(mods.actions ?? 0, 1);
    const rounds = spellRounds(sys.duration?.value) ?? 10;
    const save = sys.defense?.save;
    const area = sys.area;
    const feet = parseFeet(sys.range?.value) ?? area?.value ?? 30;
    const reachFoes = { melee: false, range: { increment: feet, max: feet, noPenalty: true } };
    const many = areaTargets(area, sys.target?.value);
    if ( Object.keys(mods).length || tempHp || fastHealing || regen ) {
      // (Healing over time alone: named as its spell.)
      const named = Object.keys(mods).length || tempHp;
      const outcome = {
        mods: Object.keys(mods).length ? mods : undefined, tempHp: tempHp || undefined, fastHealing: fastHealing || undefined, regen: regen ?? undefined, rounds,
        label: named ? describeMods(mods, { tempHp }) : spell.name
      };
      // (Its Spell Effect, to leave on a creature still under it when the fight ends.)
      const effectRef = uuids.length ? { uuids: [...new Set(uuids)] } : undefined;
      if ( save ) {
        return { kind: "control", ...reachFoes, save: { type: save.statistic, dc: stat.dc?.value ?? 10 + (spell.actor?.level ?? 0), basic: false },
          onSave: [outcome, outcome, null, null], area: many > 1 ? areaSpec(area, many) : undefined, effectRef };
      }
      // Good for one roll (Guidance: "one attack roll, Perception check, saving throw, or skill check"; Sure Strike:
      // "the next time you make an attack roll").
      if ( oneRoll || ONE_ROLL.test(text) ) outcome.uses = 1;
      if ( helps(mods) || (!outcome.mods && (tempHp || fastHealing || regen)) ) return { kind: "buff", outcome, ...spellReach({ area, target: sys.target?.value, range: sys.range?.value }), effectRef };
      return { kind: "control", auto: true, ...reachFoes, outcome, effectRef };
    }
    // Conditions on enemies, no save (Dirge of Doom: "Enemies within the area are Frightened 1").
    const conditions = !save && !spell.isAttack && /\benem(?:y|ies)\b/i.test(text) ? conditionsIn(text) : {};
    if ( Object.keys(conditions).length ) {
      return { kind: "control", auto: true, ...reachFoes, area: many > 1 ? areaSpec(area, many) : undefined,
        outcome: { conditions, rounds: Math.max(rounds, conditions.frightened ?? 1), label: conditionsLabel(conditions) } };
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
      if ( !effect || !theirsToOpen(actor, effect) ) continue;
      const slug = String(effect.system?.slug ?? slugOf(effect) ?? "");
      const short = slug.replace(/^effect-/, "");
      // What a fight can tell: the effect is on, and the Strike is a melee one.
      const options = new Set(["item:melee", "item:type:weapon", `self:effect:${short}`, `self:effect:${slug}`, short]);
      const own = modsFromRules(effect.system?.rules ?? [], { rank: item.level ?? 1, actor: data, options });
      const whileOn = modsFromRules(item.system?.rules ?? [], { rank: item.level ?? 1, actor: data, options, only: `self:effect:${short}` });
      const mods = { ...own.mods };
      for ( const [k, v] of Object.entries(whileOn.mods) ) mods[k] = (mods[k] ?? 0) + v;
      const tempHp = Math.max(own.tempHp, whileOn.tempHp);
      // (And healing over time its effect lends: fast healing, regeneration.)
      const { fastHealing, regen } = own;
      if ( !Object.keys(mods).length && !tempHp && !fastHealing && !regen ) continue;
      const named = Object.keys(mods).length || tempHp;
      out.push({
        id: `${actor.id}.self.${item.id}`, name: item.name, kind: "buff", targets: "self", itemId: item.id,
        cost: type === "free" ? 0 : (item.system.actions?.value ?? 1), economy: type === "free" ? "free" : undefined, traits: [...(item.system.traits?.value ?? [])],
        outcome: {
          mods: Object.keys(mods).length ? mods : undefined, tempHp: tempHp || undefined, fastHealing, regen, rounds: effectRounds(effect.system?.duration) ?? 10,
          label: named ? describeMods(mods, { tempHp }) : item.name
        },
        effectRef: { uuids: [uuid] }
      });
    }
    return out;
  }

  /** Its abilities of the standard ones glossary.js knows, by slug: {id, slug, name, html (worked out), actions}. */
  async #glossary(actor) {
    const out = [];
    for ( const item of actor.items ) {
      if ( !["action", "feat"].includes(item.type) || !GLOSSARY_SLUGS.has(slugOf(item)) ) continue;
      out.push({ id: item.id, slug: slugOf(item), name: item.name, html: await resolvedText(item), actions: item.system.actions?.value });
    }
    return out;
  }

  /**
   * Its own abilities that ask for a save and hurt or hinder (Breath Weapon, Trample, a Drain): read from their text
   * (abilities.js), with a cooldown ("can't use it again for 1d4 rounds") or a frequency (once per day) as uses. One
   * with a Requirements line it can express carries it (requirements.js), its Strikes named there by their ids.
   */
  async #abilities(actor, actions) {
    const strikes = actions.filter(a => a.kind === "strike" && a.damage?.length)
      .map(a => ({ id: a.id, name: a.name, slug: a.slug, damage: a.damage, reach: a.reach, melee: a.melee }));
    const out = [];
    for ( const item of actor.items ) {
      // Its actions, and feats that are actions of their own (a kineticist's impulses, Dragon's Rage Breath).
      if ( item.type !== "action" && !(item.type === "feat" && item.system.actionType?.value === "action") ) continue;
      // Swallow Whole and Engulf (gullet.js), by slug: the core's swallowed and engulfed.
      if ( GULLETS[slugOf(item)] ) {
        const reach = Math.max(5, ...actions.filter(a => a.kind === "strike" && a.melee).map(a => Number(a.reach) || 5));
        const speed = Number(actor.system.movement?.speeds?.land?.value ?? actor.system.movement?.speeds?.land) || 25;
        const gulp = gulletAction({
          id: `${actor.id}.${item.id}`, name: item.name, slug: slugOf(item), html: await resolvedText(item), traits: item.system.traits?.value ?? [],
          actions: item.system.actions?.value, athletics: actor.skills?.athletics?.mod, athleticsDC: escapeOf(actor).escapeDC,
          size: sizeOf(actor.size ?? actor.system.traits?.size?.value), speed, reach
        });
        if ( gulp ) out.push({ ...gulp.action, gullet: gulp.gullet, itemId: item.id });
        continue;
      }
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
   * Its auras that make foes save (auras.js): a passive ability with the aura trait or an Aura rule element whose text
   * asks for a save (Frightful Presence, Stench, a dragon's heat). Undefined with none.
   */
  async #auras(actor, ruleActor) {
    const auraLike = item => ["action", "feat"].includes(item.type)
      && ((item.system?.traits?.value ?? []).includes("aura") || (item.system?.rules ?? []).some(r => r?.key === "Aura"));
    const items = actor.items.filter(auraLike);
    if ( !items.length ) return undefined;
    const words = (await reading()).auras ?? {};
    const out = [];
    for ( const item of items ) {
      const aura = auraOf({
        id: `${actor.id}.${item.id}`, slug: slugOf(item), name: item.name, html: await resolvedText(item), source: englishDescription(item),
        traits: [...(item.system?.traits?.value ?? [])],
        rules: item.system?.rules ?? [], actionType: item.system?.actionType?.value ?? "passive", actor: ruleActor, words
      });
      if ( aura ) out.push(aura);
    }
    return out.length ? out : undefined;
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
      outcome: { mark: [part([], flat)], rounds: 10, label: t("Exploited", { n: flat }) } }];
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

  /**
   * Reactions that answer an attack (see the core's responses.js): Shield Block (the raised shield's hardness off a
   * physical blow), Reactive Shield (raising it as the blow comes, perhaps a miss after all), Nimble Dodge (+2 AC
   * against one attack), a guardian's Intercept Attack and a champion's reaction for an ally (champion.js). By slug, on
   * characters and monsters alike. Any other reaction or triggered free action as reactions-read.js reads it
   * (reactions-item.js), where it reads it whole; not a Strike's rider (attackEffects: Grab,
   * Knockdown), Reactive Strike or Ferocity, nor a hazard's (its reaction is its action). Null when it has none.
   */
  async #reactions(actor, actions = []) {
    const out = [];
    const shield = actor.system.attributes?.shield;
    const hasShield = shield?.ac > 0 && !shield.broken && !shield.destroyed;
    const slugs = new Set(actor.items.map(i => slugOf(i)).filter(Boolean));
    const seen = new Set(); // (a feat and the action it grants share a slug)
    const riders = new Set((actor.itemTypes?.melee ?? []).flatMap(m => m.system?.attackEffects?.value ?? []));
    const toRead = [];
    for ( const item of actor.items ) {
      if ( !["feat", "action"].includes(item.type) ) continue;
      const slug = slugOf(item);
      if ( seen.has(slug) ) continue;
      seen.add(slug);
      if ( slug === "shield-block" && hasShield && shield.hardness > 0 ) {
        // (In a live battle, PF2e's own damage application blocks with it: its hardness, the rest to the shield.)
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "hit", needsShield: true, physical: true, reduce: part([], shield.hardness), applies: "shieldBlock" });
      } else if ( slug === "reactive-shield" && hasShield ) {
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "hit", melee: true, ac: shield.ac });
      } else if ( slug === "nimble-dodge" ) {
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "attacked", ac: 2 });
      } else if ( slug === "intercept-attack" ) {
        // A guardian's: an ally within 10 feet taking physical damage, it takes the blow instead (its own resistances).
        out.push({ id: `${actor.id}.${slug}`, label: item.name, on: "allyHit", range: 10, physical: true, redirect: true, tell: "intercept" });
      } else if ( AURA_REACTIONS.has(slug) ) {
        // A champion's reaction: a friend hit in its aura, the foe in it too, resists the blow (and the foe, in reach of
        // a Retributive Strike, gets struck).
        out.push(await championReaction(actor, item, { slug, slugs }));
      } else if ( ["reaction", "free"].includes(item.system.actionType?.value) && !OWN_READING.has(slug) && !riders.has(slug) && actor.type !== "hazard" ) {
        toRead.push(item);
      }
    }
    out.push(...await itemReactions(actor, toRead, { actions, resolve: resolvedText, slugOf }));
    return out.length ? out : null;
  }

  /**
   * Skill actions anyone (or the trained) can take in a fight: the maneuvers (maneuvers.js: Demoralize, Trip, Grapple,
   * Disarm, Shove, Reposition, Feint), Bon Mot for those with the feat (Diplomacy against Will), and Aid.
   */
  #skillActions(actor, traits, strikes = []) {
    if ( traits.includes("mindless") ) return [];
    const skill = slug => actor.skills?.[slug] ?? null;
    const trained = slug => trainedIn(actor, slug);
    const out = [];
    const near = { melee: false, range: { increment: 30, max: 30, noPenalty: true } };
    // Aid: for a friend's next roll at whoever it's set on (edges.js); for one that can tell a friend what it means to
    // do (a language: not a wolf). (Helping with Medicine takes a hand, as tending does; with words, none.)
    const aid = !(actor.system.details?.languages?.value ?? []).length ? null : aidAction({ id: `${actor.id}.aid`, name: game.i18n.localize("FFPF2E.Aid"), strikes,
      skills: AID_SKILLS.filter(skill).map(slug => ({ mod: skill(slug).mod, rank: skill(slug).rank ?? 0, hands: slug === "medicine" ? 1 : 0 })) });
    if ( aid ) out.push(aid);
    out.push(...skillManeuvers({
      actorId: actor.id, maxSize: sizeOf(actor.size ?? actor.system.traits?.size?.value) + 1,
      athletics: trained("athletics") ? skill("athletics").mod ?? 0 : null,
      deception: trained("deception") ? skill("deception").mod ?? 0 : null,
      intimidation: skill("intimidation") ? skill("intimidation").mod ?? 0 : null
    }));
    out.push(...coverActions({ actorId: actor.id, hazard: actor.type === "hazard", stealth: skill("stealth") }));
    if ( skill("diplomacy") && actor.itemTypes?.feat?.some(f => slugOf(f) === "bon-mot") ) {
      // (Will saves and Perception alone: maneuvers.js bonMot.)
      out.push(bonMot({ id: `${actor.id}.bon-mot`, name: featureName(ownNames(actor), "bon-mot"), diplomacy: skill("diplomacy").mod ?? 0 }));
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
        // (Its traits: a healing potion's vitality mends no one with void healing, rules.js usable.)
        traits: [...(item.system.traits?.value ?? [])],
        resource: `item:${item.id}`,
        pool: quantity,
        selfOnly: true,
        itemId: item.id,
        hands: 1 // (drinking it, or applying it, is an Interact action)
      });
    }
    return out;
  }

  /**
   * The injury poisons it carries (by trait): each as its best piercing or slashing Strike with the poison applied first
   * (the poison's activation, two actions as a rule), the hit's target saving against it (afflictions.js). One use a
   * dose. Not played: a missed Strike keeping the poison on the weapon for the next.
   */
  #poisons(actor, strikes) {
    const best = injuryWeapon(strikes);
    if ( !best ) return [];
    const out = [];
    for ( const item of actor.itemTypes?.consumable ?? [] ) {
      const traits = item.system.traits?.value ?? [];
      const quantity = Number(item.system.quantity ?? 1);
      if ( !traits.includes("injury") || !traits.includes("poison") || !(quantity > 0) ) continue;
      const html = englishDescription(item);
      const poison = parseAffliction({ id: `${actor.id}.poison.${item.id}`, name: item.name, slug: slugOf(item), description: html, traits });
      if ( poison ) out.push(poisonedStrike(best, { item, poison, quantity, apply: activationOf(html) }));
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
        heal: [part([{ n: 2, faces: 8, mult: 1 }], bonus, "healing")],
        healCheck: { mod: medicine.mod, dc },
        oncePerTarget: true,
        reach: 5, // yourself or an adjacent creature
        hands: 1 // (manipulate, with a healer's toolkit)
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
    // Its spellcasting: with spell slots (prepared or spontaneous), innate, and focus spells (with a focus pool).
    let slots = null;
    let innate = null;
    let focus = null;
    const pool = Number(actor.system?.resources?.focus?.max) || 0;
    for ( const entry of actor.spellcasting?.regular ?? actor.spellcasting?.contents ?? [] ) {
      const mode = entry.system?.prepared?.value;
      const ranked = Object.entries(entry.system?.slots ?? {}).some(([key, s]) => key !== "slot0" && Number(s?.max) > 0);
      if ( !slots && ranked && ["prepared", "spontaneous"].includes(mode) ) slots = entry.name;
      if ( !innate && mode === "innate" && (entry.spells?.size ?? entry.spells?.contents?.length ?? 1) > 0 ) innate = entry.name;
      if ( !focus && mode === "focus" && pool > 0 && (entry.spells?.size ?? entry.spells?.contents?.length ?? 1) > 0 ) focus = entry.name;
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
      casting: { slots, innate, focus },
      heals: healsOthers(spec.actions),
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

  get supportsLive() {
    return true;
  }

  /** A live battle: one turn's changes, and only those (commit.js commitPf2eChanges). */
  async commitChanges(tokenDoc, spec, changes, final, options) {
    return commitPf2eChanges(tokenDoc, spec, changes, final, options);
  }

  /**
   * What PF2e does itself in a live battle: the persistent damage roll at the end of a creature's turn, and the
   * recovery check of one dying (FastFighting leaves them to it, and reads what came of them from the sheet).
   */
  liveOwnership() {
    return { persistent: true, recovery: true };
  }

  /**
   * A token's sheet mid-fight (see the core's readLiveState): only what a turn changes, read straight off the actor,
   * not a whole CombatantSpec (its spells' damage, its effects' rules) for every creature every turn. Its resources are
   * the ones the engine counts (context.unit), each read as toCombatantSpec reads it; one used up reads 0.
   */
  async readLiveState(tokenDoc, context = {}) {
    const actor = tokenDoc.actor;
    if ( !context.unit?.resources ) return super.readLiveState(tokenDoc, context);
    if ( !this.canHandle(actor) ) return null;
    const sys = actor.system;
    const hp = sys.attributes.hp ?? {};
    // (As toCombatantSpec has it: a hazard with no Hit Points is always set.)
    const unbroken = actor.type === "hazard" && !(hp.max > 0);
    const value = unbroken ? 1 : hp.value ?? 0;
    const dead = actor.statuses?.has?.("dead") || [...actor.effects].some(e => !e.disabled && e.statuses?.has?.("dead"))
      || (value <= 0 && actor.type !== "character");
    const resources = {};
    for ( const key of Object.keys(context.unit.resources) ) {
      const n = this.#resourceLeft(actor, key);
      if ( n !== undefined ) resources[key] = n;
    }
    return {
      hp: value, temp: unbroken ? 0 : hp.temp ?? 0, stamina: staminaOf(actor, hp).stamina?.value, maxHp: unbroken ? 1 : hp.max ?? 1,
      dying: sys.attributes?.dying?.value ?? 0, wounded: sys.attributes?.wounded?.value ?? 0, doomed: sys.attributes?.doomed?.value ?? 0,
      status: dead ? "dead" : value > 0 ? "standing" : "down",
      conditions: this.#conditions(actor), persistent: this.#persistent(actor), resources
    };
  }

  /** What's left of one of its resources (a key toCombatantSpec gave it), or undefined for one it doesn't know. */
  #resourceLeft(actor, key) {
    const sys = actor.system;
    if ( key === "fate" ) return actor.type === "character" ? Number(sys.resources?.heroPoints?.value) || 0 : 0;
    if ( key === "focus" ) return sys.resources?.focus?.value ?? 0;
    const [kind, id, more] = key.split(":");
    const item = actor.items.get(id);
    if ( kind === "item" ) {
      if ( !item ) return 0;
      // (A healing potion counts each of its uses, as #consumables does; a bomb, its quantity.)
      const healing = item.type === "consumable" && item.system.damage?.kind === "healing";
      return Math.max(0, (Number(item.system.quantity ?? 1) || 0) * (healing ? Math.max(1, item.system.uses?.max ?? 1) : 1));
    }
    if ( kind === "prep" ) {
      let count = 0;
      for ( const [slotKey, slot] of Object.entries(item?.system?.slots ?? {}) ) {
        if ( slotKey !== "slot0" ) count += (slot.prepared ?? []).filter(p => p.id === more && !p.expended).length;
      }
      return count;
    }
    if ( kind === "slots" ) return item?.system?.slots?.[`slot${more}`]?.value ?? 0;
    return undefined;
  }

  /**
   * Its reactions, for its player to say always / ask / never: its own (Shield Block, Nimble Dodge ...) and Reactive Strike
   * where it has it (by that name, as PF2e has it).
   */
  reactionsOf(spec) {
    const out = (spec?.reactions ?? []).map(r => ({ id: r.id, label: r.label ?? r.id }));
    if ( spec?.flags?.reactiveStrike ) out.push({ id: "opportunity", label: actionName("ReactiveStrike") });
    return out;
  }

  /** A player's turn in a live battle, read from the cards PF2e made for it (read-turn.js). */
  readTurn(messages, context) {
    return readPf2eTurn(messages, context);
  }

  /** API 19. A player's damage card (read-turn.js): its total, damage or healing, the token it's at, a save first. */
  damageCard(message) {
    return pf2eDamageCard(message);
  }

  /** API 19. A damage card applied to a token as PF2e's own card applies it (commit.js), with its undo record. */
  async applyDamageCard(message, token, options) {
    return applyPf2eDamageCard(message, token, options);
  }

  /**
   * API 19. None: PF2e applies no one's damage by itself (its automation settings are rules-based vision, IWR, removing
   * expired effects, flanking, encumbrance, lootable NPCs, reach and NPCs dead at 0 HP; its Apply Damage buttons are
   * clicked by hand). A module's setting is named here only once its key and meaning are read from the module's own
   * source; none has been.
   */
  appliesPlayerDamage() {
    return null;
  }

  /** An area on the map as pf2e draws its own (its shapeDataFromEffectArea): a cone a quarter turn wide. */
  areaShape(data) {
    if ( data?.type === "cone" ) return { ...data, angle: 90 };
    return data ?? null;
  }

  /**
   * Do token nameplates decide whether players learn an NPC's name? pf2e's own Tokens Determine NPC Name Visibility:
   * on, its cards hide an NPC's name its token doesn't show, and a live battle's story does the same.
   */
  namesFollowNameplates() {
    try {
      return !!game.settings.get("pf2e", "metagame_tokenSetsNameVisibility");
    } catch ( err ) {
      return false;
    }
  }

  /**
   * API 19. A Strike rolled with PF2e's own roller, its cards in the chat (strike-roll.js): the attack at the target,
   * the variant for the attacks before it, and on a hit its damage by type as rolled. A spell attack as its card rolls it.
   */
  async rollStrike(token, options) {
    return rollPf2eStrike(token, options);
  }

  /**
   * API 19. An action's own card, as its user shows it from the sheet (action-roll.js): a spell's (cast, nothing spent),
   * an ability's, a self-buff's, a consumable's; none for an action with no item, or a spell attack rollStrike rolls.
   */
  async useAction(token, options) {
    return usePf2eAction(token, options);
  }

  /**
   * API 19. An action's damage, rolled once for all it catches (action-roll.js): a spell's as its card's Damage button
   * rolls it, an ability's as the first @Damage link on its card; nothing applied.
   */
  async rollDamage(token, options) {
    return rollPf2eDamage(token, options);
  }

  /** API 19. A save rolled with PF2e's own roller, its card in the chat (check-roll.js): the actor's save against the DC. */
  async rollSave(token, options) {
    return rollPf2eSave(token, options);
  }

  /**
   * API 19. A check rolled with PF2e's own roller, its card in the chat (check-roll.js): PF2e's own action where it has
   * one (Trip, Demoralize, Escape ...), else the skill; a maneuver with the core's multiple attack penalty.
   */
  async rollCheck(token, options) {
    return rollPf2eCheck(token, options);
  }

  /** API 19. Does a critical Reactive Strike disrupt what this card did: a manipulate action (read-turn.js)? */
  disruptsAction(message) {
    return pf2eDisrupts(message);
  }

  /** Tied up in a live battle: Restrained, PF2e's own condition (commit.js). */
  async commitBound(tokenDoc, bound) {
    return commitPf2eBound(tokenDoc, bound);
  }

  /**
   * PF2e's sheets carry every one of its own conditions (written as its condition, read back as the same key); the
   * engine's others (incapacitated: losing a turn to Command) the core keeps.
   */
  sheetCarries(key) {
    return key === "prone" || !!conditionSlug(key);
  }

  /** PF2e's own name for a condition (its word, in the table's language); taking cover (inCover), its action's. */
  conditionLabel(key) {
    if ( key === "inCover" ) return actionName("TakeCover");
    const slug = conditionSlug(key);
    const name = slug ? CONFIG.PF2E?.conditionTypes?.[slug] : null;
    return name ? game.i18n.localize(name) : null;
  }

  /** Every PF2e condition (as the engine's key; the counted ones marked), then the core's own. */
  conditionChoices() {
    const own = Object.keys(CONFIG.PF2E?.conditionTypes ?? {}).filter(slug => !NOT_CONDITIONS.has(slug))
      .map(slug => ({ key: engineKey(slug), valued: !!game.pf2e?.ConditionManager?.getCondition(slug)?.system?.value?.isValued }));
    // (One the core has too, dazzled or fascinated: PF2e's.)
    return [...own, ...super.conditionChoices().filter(c => !own.some(o => o.key === c.key))];
  }

  /** A ranged attack or a manipulate action in a foe's reach: Reactive Strike's other triggers (read-turn.js). */
  liveOpening(message, tokenId) {
    return pf2eOpening(message, tokenId);
  }

  /** Hero Points buy a reroll (and, all of them, a way back from death). */
  rerollResource() {
    return game.i18n.localize("FFPF2E.HeroPoints");
  }

  resourceLabel(key) {
    return resourceName(key);
  }

  describeOutcome(spec, final) {
    return describePf2eOutcome(spec, final);
  }

  async commitConcession(giverDoc, receiverDoc, concession) {
    return commitPf2eConcession(giverDoc, receiverDoc, concession);
  }
}

function levelOf(actor) {
  return actor.level ?? 0;
}

/** The trait ids PF2e knows (CONFIG.PF2E's), for a bare trait in a rule element's predicate (save-vs.js). */
function knownTraits() {
  const config = globalThis.CONFIG?.PF2E ?? {};
  return new Set(["actionTraits", "spellTraits", "effectTraits", "magicTraditions"].flatMap(k => Object.keys(config[k] ?? {})));
}

/**
 * Hide and Take Cover, for any creature but a hazard (rules.usable says where it has the cover or concealment they
 * need): Hide is Stealth against the foes' best Perception DC, hidden until it does anything (an attack's target still
 * off guard to that one); Take Cover makes standard cover greater (prone, greater against ranged attacks) until it
 * moves or attacks. Each one action, until the end of its next turn. Not played: cover's bonus to the Stealth check.
 * @param {object} d
 * @param {string} d.actorId
 * @param {boolean} [d.hazard]
 * @param {object} [d.stealth]  its Stealth ({mod, label}), for Hide
 */
export function coverActions({ actorId, hazard = false, stealth = null }) {
  if ( hazard ) return [];
  const out = [];
  if ( Number.isFinite(stealth?.mod) ) {
    const hidden = { conditions: { hidden: 1 }, rounds: 1, label: conditionName("hidden") };
    out.push({ id: `${actorId}.hide`, name: actionName("Hide"), kind: "buff", targets: "self", cost: 1, traits: ["secret"], hands: 0, maneuver: "hide", hide: true,
      setup: true, leans: ["lowProfile"], check: { mod: stealth.mod, against: "perception", label: stealth.label ?? "" }, onDegree: [null, null, hidden, hidden] });
  }
  out.push({ id: `${actorId}.take-cover`, name: actionName("TakeCover"), kind: "buff", targets: "self", cost: 1, traits: [], hands: 0, maneuver: "takeCover", takeCover: true,
    setup: true, leans: ["lowProfile"], outcome: { conditions: { inCover: 1 }, rounds: 1, label: actionName("TakeCover") } });
  return out;
}

/** The damage types an injury poison gets in by. */
const INJURES = new Set(["piercing", "slashing"]);

/** Its best Strike to carry an injury poison: a weapon's (not a bomb), dealing piercing or slashing damage. */
export function injuryWeapon(strikes) {
  const mean = a => (a.damage ?? []).reduce((s, p) => s + meanPart(p), 0) + (a.bonus ?? 0);
  return (strikes ?? []).filter(a => a.kind === "strike" && !a.resource && (a.damage ?? []).some(p => INJURES.has(p.type) && !p.persistent))
    .sort((a, b) => mean(b) - mean(a))[0] ?? null;
}

/** How many actions its activation takes ("Activate ◆◆": the action glyph), two where it doesn't say. */
export function activationOf(html) {
  const m = /<strong>\s*Activate\s*<\/strong>\s*<span class="action-glyph">\s*(\d)\s*<\/span>/i.exec(String(html ?? ""));
  return m ? Number(m[1]) : 2;
}

/** A Strike with an injury poison applied first: the activation and then the Strike, the poison on a hit, a dose a use. */
export function poisonedStrike(strike, { item, poison, quantity, apply = 2 }) {
  return {
    ...strike, id: `${strike.id}.poison.${item.id}`, name: t("Poisoned", { strike: strike.name, poison: item.name }), cost: (strike.cost ?? 1) + apply, oncePerTurn: true,
    effects: [...(strike.effects ?? []), poison], resource: `item:${item.id}`, pool: quantity, itemId: item.id
  };
}

/** Conditions on top of others, the higher value of each (a passive's slowed over a sheet's). */
export function withConditions(base, more) {
  if ( !more ) return base;
  const out = { ...(base ?? {}) };
  for ( const [k, v] of Object.entries(more) ) out[k] = Math.max(Number(out[k]) || 0, Number(v) || 0);
  return out;
}

/**
 * Its constant spells' slugs: innate spells PF2e marks "constant" in brackets in their names (the words FFPF2E.Innate's,
 * in the reader's language and in English, as #spells reads them).
 */
export function constantSpells(actor) {
  const out = [];
  for ( const entry of actor?.spellcasting?.regular ?? actor?.spellcasting?.contents ?? [] ) {
    if ( entry.system?.prepared?.value !== "innate" ) continue;
    for ( const spell of entry.spells?.contents ?? [] ) {
      const tags = new Set([...`${englishName(spell)} ${spell.name}`.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim().toLowerCase().replace(/\s+/g, " ")));
      if ( wordList("Innate.Constant").some(w => tags.has(w)) ) out.push(slugOf(spell));
    }
  }
  return out;
}

/** Its gullets (spec.gullet), by the core's condition each lays: {swallowed: {damage, rupture, most}}; undefined with none. */
export function gulletsOf(actions) {
  const out = {};
  for ( const a of actions ?? [] ) if ( a.gullet?.key ) out[a.gullet.key] = { damage: a.gullet.damage, rupture: a.gullet.rupture, most: a.gullet.most };
  return Object.keys(out).length ? out : undefined;
}

/**
 * An item's text with its inline damage and checks worked out for this creature, as PF2e shows them: formulas that
 * use its level or ability scores, a class DC, its own rule elements (a kineticist's gate). Text with nothing to work
 * out is returned as it is. `keepLinks`: its @UUID links kept as they are (reactions-read.js reads what they link).
 */
export async function resolvedText(item, { keepLinks = false } = {}) {
  // (Its links as their labels, embeds left out: only its formulas are worked out, and no link is ever followed.)
  const embedless = String(englishDescription(item) ?? "").replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/g, " ");
  const raw = keepLinks ? embedless : embedless.replace(/@(?:UUID|Compendium)\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? " ");
  if ( !/@Damage\[[^\]]*@|@Check\[(?![^\]]*\bdc:\d)/i.test(raw) ) return raw;
  let html;
  try {
    // (PF2e's own enrichers only, @Damage and @Check among them: no inline roll is made, no document link, hyperlink or
    // embed is worked out, and no secret is shown, whoever's screen it is on.)
    html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
      rollData: item.getRollData?.(), relativeTo: item, rolls: false, embeds: false, documents: false, links: false, secrets: false
    });
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
