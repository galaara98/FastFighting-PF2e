/**
 * What PF2e says about a character, for the one time FastFighting sets it up by itself (the core's
 * foundry/auto-config.js): the playstyles that fit it and its own answers to the tactics questions ("Let this character
 * decide"), from its class and the choices it made in it (by slug), its feats, features and abilities (by slug, and by
 * what they do), a creature's traits (by slug: undead, mindless, devil, holy ...), its spellcasting, skills, languages
 * and gear; and its biography as plain text for the keywords. Pure.
 */
import { listJoin } from "./core.js";
import { t, traitName } from "./words.js";

/** What each class leans toward. */
const CLASSES = Object.freeze({
  alchemist: { puzzleManiac: 0.5 }, animist: { unmundane: 0.4, enabler: 0.2 }, barbarian: { brawler: 0.5, impatient: 0.3 },
  bard: { peoplePleaser: 0.3, diplomat: 0.3, enabler: 0.2 }, champion: { tank: 0.5, martyr: 0.3 }, cleric: { enabler: 0.5, moralist: 0.2 },
  commander: { leader: 0.7 }, druid: { unmundane: 0.3, loreCollector: 0.2 }, exemplar: { brawler: 0.3, instigator: 0.2 },
  fighter: { brawler: 0.3, tank: 0.2 }, guardian: { tank: 0.7 }, gunslinger: { wallflower: 0.4 }, inventor: { puzzleManiac: 0.6 },
  investigator: { loreCollector: 0.5, puzzleManiac: 0.3 }, kineticist: { unmundane: 0.5 }, magus: { unmundane: 0.4 },
  monk: { speedRunner: 0.4 }, oracle: { unmundane: 0.4 }, psychic: { unmundane: 0.5 }, ranger: { wallflower: 0.4, relentless: 0.2 },
  rogue: { thief: 0.5, wallflower: 0.2 }, sorcerer: { unmundane: 0.6 }, summoner: { unmundane: 0.4 }, swashbuckler: { instigator: 0.5 },
  thaumaturge: { puzzleManiac: 0.4, loreCollector: 0.3 }, witch: { unmundane: 0.5 }, wizard: { unmundane: 0.4, loreCollector: 0.4 }
});

/** Ancestries (and a creature's traits naming one), only where an ancestry's own abilities lean somewhere. */
const ANCESTRIES = Object.freeze({
  goblin: { impatient: 0.15 }, kobold: { puzzleManiac: 0.15 }, orc: { relentless: 0.2 }, dwarf: { tank: 0.15 }
});

/** What a creature's traits lean toward. */
const TRAITS = Object.freeze({
  undead: { relentless: 0.3 }, mindless: { relentless: 0.5 }, animal: { brawler: 0.3 }, beast: { brawler: 0.2 },
  fiend: { cruel: 0.4 }, unholy: { cruel: 0.3 }, holy: { moralist: 0.3 }, celestial: { moralist: 0.3, martyr: 0.2 },
  construct: { relentless: 0.5 }, fey: { wildcard: 0.4 }, aberration: { instigator: 0.2, wildcard: 0.2 }, ooze: { relentless: 0.4 },
  plant: { relentless: 0.3 }, dragon: { leader: 0.2 }, giant: { brawler: 0.3 }, elemental: { relentless: 0.2 }, troll: { relentless: 0.2 }
});

/** The playstyles that fit: {id: -1 to 1}. */
export function pf2eHints({ cls = null, ancestry = null, traits = [], shield = false, heavy = false } = {}) {
  const out = {};
  const add = map => { for ( const [k, v] of Object.entries(map ?? {}) ) out[k] = (out[k] ?? 0) + v; };
  add(CLASSES[cls]);
  add(ANCESTRIES[ancestry]);
  for ( const t of new Set(traits) ) add(TRAITS[t] ?? (t !== ancestry ? ANCESTRIES[t] : null));
  if ( shield ) add({ tank: 0.2 });
  if ( heavy ) add({ tank: 0.2 });
  for ( const k of Object.keys(out) ) out[k] = Math.max(-1, Math.min(1, out[k]));
  return out;
}

/* -------------------------------------------- */
/*  The tactics questions                       */
/* -------------------------------------------- */

/** A class's fighting style. */
const CLASS_STYLE = Object.freeze({
  champion: "protector", guardian: "protector", barbarian: "frontline", fighter: "frontline", exemplar: "frontline", magus: "frontline",
  monk: "skirmisher", rogue: "skirmisher", swashbuckler: "skirmisher", ranger: "ranged", gunslinger: "ranged",
  wizard: "caster", sorcerer: "caster", witch: "caster", psychic: "caster", oracle: "caster", druid: "caster", cleric: "caster",
  bard: "caster", summoner: "caster", animist: "caster", kineticist: "caster", necromancer: "caster"
});

/**
 * What a choice made in a class makes of its fighting style, by the choice's slug (a granted class feature: a
 * cleric's doctrine, a druid's order, a rogue's racket, a magus's hybrid study, a gunslinger's way, an alchemist's
 * research field, an inventor's innovation).
 */
const SUBCLASS_STYLE = Object.freeze({
  cleric: { warpriest: "frontline", "battle-creed": "frontline", "cloistered-cleric": "caster" },
  druid: { "untamed-order": "frontline" },
  rogue: { ruffian: "frontline" },
  magus: { "laughing-shadow": "skirmisher", "starlit-span": "ranged" },
  gunslinger: { "way-of-the-vanguard": "frontline", "way-of-the-drifter": "skirmisher", "way-of-the-triggerbrand": "skirmisher",
    "way-of-the-pistolero": "ranged", "way-of-the-sniper": "ranged", "way-of-the-spellshot": "ranged" },
  alchemist: { bomber: "ranged", mutagenist: "frontline" },
  inventor: { "weapon-innovation": "frontline", "armor-innovation": "frontline", "light-mortar-innovation": "ranged" }
});

/** Classes built on their spells (or a kineticist's impulses): they reach for them first. */
const CASTERS = new Set(["wizard", "sorcerer", "witch", "psychic", "oracle", "druid", "cleric", "bard", "animist", "summoner", "magus", "necromancer"]);

/** Reactions that guard an ally (a champion's reaction for a holy cause, a guardian's Intercept Attack ...), by slug. */
const GUARD_SLUGS = new Set(["intercept-attack", "retributive-strike", "glimpse-of-redemption", "liberating-step", "flash-of-grandeur",
  "guardians-deflection-fighter", "shield-from-arrows", "shield-of-reckoning", "defensive-swap", "standard-bearers-sacrifice"]);
/** A champion's reaction that guards only itself (an unholy cause's, obedience's), by slug. */
const SELF_GUARD_SLUGS = new Set(["iron-command", "selfish-shield", "destructive-vengeance"]);
/** Reactions for an ally who falls, by slug. */
const RESCUE_SLUGS = new Set(["rapid-response"]);

/** Archetypes and methods built on consumables (an alchemist's, a talisman dabbler's, a scroll trickster's), by slug. */
const CONSUMABLE_FEATS = ["alchemist-dedication", "talisman-dabbler-dedication", "scroll-trickster-dedication", "alchemical-sciences-methodology"];

/** Skills that end an argument with words: persuading, bluffing, threatening. */
const SOCIAL = ["diplomacy", "deception", "intimidation"];

/**
 * A creature's high skill modifier at its level (the Monster Core's and NPC Core's social skills: about three in four
 * creatures with one are below it).
 */
export const highSkill = level => Math.floor((Number(level) || 0) * 1.45) + 7;

/* Reading what a reaction or action does: its trigger, as PF2e writes it (in English, which a translation keeps). */

const words = html => String(html ?? "").replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** A reaction's trigger, as plain words ("" when it has none). */
export function triggerOf(html) {
  const m = /<strong>\s*Trigger\s*<\/strong>([\s\S]*?)(?:<\/p>|<hr|<strong>)/i.exec(String(html ?? ""));
  return m ? words(m[1]) : "";
}

/**
 * Does one sentence of the text (up to a full stop) say these, in this order? Each a word pattern with the g flag. Each
 * found from where the last ended, the first time it's there: one pass a pattern, however long the text (a reaction's
 * text is item data a player can write, and a search that backtracks could keep the GM's client at it for minutes).
 */
export function saysInOrder(text, ...patterns) {
  for ( const sentence of String(text ?? "").split(".") ) {
    let at = 0;
    const found = patterns.every(re => {
      re.lastIndex = at;
      const m = re.exec(sentence);
      if ( m ) at = m.index + m[0].length;
      return !!m;
    });
    if ( found ) return true;
  }
  return false;
}

const FOE = /\b(?:enem(?:y|ies)|creatures?|opponents?|foes?)\b/gi;
const ENEMY = /\benem(?:y|ies)\b/gi;
const STRIKES = /\b(?:damages?|attacks?|hits?|targets?|grabs?)\b/gi;
const ALLY = /\ball(?:y|ies)\b/gi;
const STRUCK = /\b(?:would take|takes?|is hit|are hit|is the target|are the target|is targeted|are targeted)\b/gi;
const FALLS = /\b(?:reduced to 0 Hit Points|falls? unconscious|is dying|gains? the dying condition)\b/gi;
const DAMAGES_YOU = /\bdamages you\b/gi;
const GRANTS = /\b(?:grants?|gives?)\b/gi;
const AC_BONUS = /\bbonus to (?:AC|Armor Class)\b/gi;

/**
 * Does it guard an ally? A reaction set off by a foe striking an ally (or an ally about to be hurt), or an action that
 * shields one (a bonus to its AC).
 * @param {{type: string, text: string}} ability   its action type ("reaction", "action") and description (HTML)
 */
export function guardsAllies({ type, text } = {}) {
  if ( type === "reaction" ) {
    const trigger = triggerOf(text);
    return saysInOrder(trigger, FOE, STRIKES, ALLY) || saysInOrder(trigger, ALLY, STRUCK);
  }
  return type === "action" && saysInOrder(words(text), GRANTS, ALLY, AC_BONUS);
}

/** Is it a reaction to an ally falling (reduced to 0 Hit Points, dying)? */
export const rescuesAllies = ({ type, text } = {}) => type === "reaction" && saysInOrder(triggerOf(text), ALLY, FALLS);

/** Is it a reaction that guards only itself (set off by a foe damaging it)? */
export const guardsSelf = ({ type, text } = {}) => type === "reaction" && saysInOrder(triggerOf(text), ENEMY, DAMAGES_YOU);

/**
 * What it heals others with, by name, from its actions (spec.actions): its heal spells, Battle Medicine. Not one that
 * heals only itself (selfOnly: a spell on yourself, a potion), an elixir (its own), nor first aid (which mends nobody).
 * @param {object[]} actions
 * @returns {string[]}
 */
export function healsOthers(actions = []) {
  const out = [];
  for ( const a of actions ?? [] ) {
    if ( a?.kind !== "heal" || a.selfOnly || a.firstAid || /^item:/.test(a.resource ?? "") ) continue;
    if ( a.name && !out.includes(a.name) ) out.push(a.name);
  }
  return out;
}

/**
 * PF2e's own answers to the tactics questions, and what a character offers and expects to end an argument: what its
 * class and the choices it made in it, its feats and features, its kind and its stat block say, each with its reason
 * (the system's own name for it). Questions its data says nothing about are left out (the core's reading stands).
 *
 * @param {object} f
 * @param {string} [f.kind]       "pc" | "npc" | "companion" | "minion" (spec.kind)
 * @param {number} [f.level]
 * @param {{slug: string, name: string}} [f.cls]          a character's class
 * @param {{slug: string, name: string}} [f.background]   a character's background
 * @param {Record<string, string>} [f.features]   its feats, features and actions: slug -> its name
 * @param {{slug: string, name: string, type: string, text: string}[]} [f.abilities]   its actions and reactions, with
 *   their descriptions (HTML)
 * @param {string[]} [f.traits]    its traits (slugs: undead, mindless, holy, summoned ...)
 * @param {{value: string, name: string}} [f.font]   a cleric's divine font ("heal" or "harm")
 * @param {{name: string, weapons: string[]}} [f.deity]   its deity and favored weapons (base weapon slugs)
 * @param {{id: string, base: string}[]} [f.strikes]   its weapon Strikes: the action's id, the base weapon
 * @param {{melee: number, ranged: number}} [f.weapons]   how many melee and ranged weapons it fights with
 * @param {{slots: string|null, innate: string|null, focus: string|null}} [f.casting]   its spellcasting with spell slots
 *   (prepared or spontaneous), innate, and focus spells (with Focus Points to cast them): each one's name, or null
 * @param {string[]} [f.heals]   what it heals others with, by name (healsOthers: its spells, Battle Medicine)
 * @param {Record<string, {rank: number, mod: number, listed: boolean, name: string, rankName: string}>} [f.social]
 *   Diplomacy, Deception and Intimidation
 * @param {number} [f.languages]   how many languages it speaks
 * @param {{type: string, name: string}[]} [f.immune]   its immunities
 * @param {string|null} [f.mending]    the name of its regeneration or fast healing
 * @param {string|null} [f.formation]  the name of an ability that has it fight in formation
 * @param {string|null} [f.bomb]       the name of a bomb it throws
 * @param {boolean} [f.shield]         a shield, ready
 * @param {{money: number, coin: number}} [f.purse]   its money (in the smallest coin), and its main coin's value
 * @returns {Record<string, {value: *, why: string}>}
 */
export function pf2eTactics(f = {}) {
  const out = {};
  // (The first answer to a question stands: the rules below go from the surest reading to the least. One with no
  // reason to give isn't an answer.)
  const say = (key, value, why) => {
    if ( key in out || value === undefined || value === null || value === "" || !why ) return;
    out[key] = { value, why: String(why) };
  };
  const features = f.features ?? {};
  const has = slug => Object.hasOwn(features, slug);
  const named = slug => features[slug] || slug;
  const traits = new Set(f.traits ?? []);
  const trait = slug => (traits.has(slug) ? traitName(slug) : null);
  const pc = f.kind === "pc";
  const cls = f.cls?.slug ?? null;
  const clsName = f.cls?.name || cls;
  const abilities = f.abilities ?? [];
  const find = (slugs, reads) => abilities.find(a => slugs.has(a.slug) || reads(a)) ?? null;
  const guard = find(GUARD_SLUGS, guardsAllies);
  const rescue = find(RESCUE_SLUGS, rescuesAllies);
  const selfGuard = find(SELF_GUARD_SLUGS, guardsSelf);
  // (The choice it made in its class that changes its style, if any.)
  const choice = Object.keys(SUBCLASS_STYLE[cls] ?? {}).find(has) ?? null;
  const choiceStyle = choice ? SUBCLASS_STYLE[cls][choice] : null;
  const unthinking = trait("mindless") ?? trait("construct");
  const summoned = trait("summoned");
  // (A creature known to speak no language: a player character always has one.)
  const noWords = !pc && Number.isFinite(f.languages) && f.languages <= 0 ? t("Why.NoLanguage") : null;
  // A champion guards its friends, unless its cause's reaction guards only itself (an unholy cause's, obedience's).
  const selfish = cls === "champion" && !!selfGuard && !guard;
  const guardian = ["champion", "guardian"].includes(cls) && !selfish;
  const guardWhy = guard?.name ?? clsName;
  // What it heals others with; and, with something to heal with, one who's a healer by its choices (a cleric with a
  // healing font, a chirurgeon, an oracle of life, a medic).
  const heals = (f.heals ?? []).filter(Boolean);
  const healNames = heals.length ? listJoin(heals.slice(0, 3)) : null;
  const healer = !heals.length ? null : (cls === "cleric" && f.font?.value === "heal" && f.font.name)
    || (cls === "alchemist" && has("chirurgeon") && named("chirurgeon"))
    || (cls === "oracle" && has("life") && named("life"))
    || (has("medic-dedication") && named("medic-dedication")) || null;
  const immune = type => (f.immune ?? []).find(i => i.type === type) ?? null;
  const immuneWhy = i => t("Why.Immune", { what: i.name || i.type });

  // Its favorite weapon: its deity's favored weapon, for one trained to fight with it (a champion's Deific Weapon, a
  // warpriest's doctrine).
  const fighting = cls === "champion" || (cls === "cleric" && choiceStyle === "frontline");
  if ( fighting && f.deity ) {
    const favored = (f.strikes ?? []).find(s => (f.deity.weapons ?? []).includes(s.base));
    if ( favored ) say("preferredAction", favored.id, f.deity.name);
  }

  // Its fighting style.
  if ( pc && cls ) {
    let style = CLASS_STYLE[cls] ?? null;
    let why = clsName;
    if ( choiceStyle ) { style = choiceStyle; why = named(choice); }
    if ( guardian && style === "protector" ) why = guardWhy;
    if ( selfish ) { style = "frontline"; why = selfGuard.name; }
    // (A martial character's weapons: one with nothing but ranged weapons shoots; a ranger with none closes in.)
    const w = f.weapons;
    if ( w && !choiceStyle && style === "ranged" && !w.ranged && w.melee ) style = "skirmisher";
    else if ( w && ["frontline", "skirmisher"].includes(style) && w.ranged && !w.melee ) style = "ranged";
    say("style", style, why);
  } else if ( !pc ) {
    const crowd = trait("troop") ?? trait("swarm");
    if ( crowd ) say("style", "frontline", crowd);
    if ( guard ) say("style", "protector", guard.name);
    if ( f.casting?.slots ) say("style", "caster", f.casting.slots);
    for ( const slug of ["pack-attack", "sneak-attack"] ) if ( has(slug) ) say("style", "skirmisher", named(slug));
    if ( f.weapons?.melee ) {
      if ( f.formation ) say("style", "frontline", f.formation);
      if ( has("reactive-strike") ) say("style", "frontline", named("reactive-strike"));
    }
  }

  // Whom it goes for.
  const crowd = trait("mindless") ?? trait("swarm") ?? trait("troop");
  if ( crowd ) say("target", "nearest", crowd);
  if ( guardian ) say("target", "protect", guardWhy);
  if ( guard ) say("target", "protect", guard.name);
  if ( cls === "commander" ) say("target", "dangerous", clsName);

  // Spell slots and other limited abilities: a summoned creature has nothing to save them for; a caster's spell slots
  // last the day; Focus Points come back after ten minutes' Refocus, so they're for this fight.
  if ( summoned ) say("resourceUse", "nova", summoned);
  if ( pc && CASTERS.has(cls) ) say("resourceUse", "conserve", f.casting?.slots);
  if ( pc ) say("resourceUse", "nova", f.casting?.focus);

  // Magic and its specialties.
  if ( pc && cls ) {
    if ( cls === "kineticist" ) say("specialty", "always", clsName);
    if ( cls === "cleric" && choiceStyle === "frontline" ) say("specialty", "some", named(choice));
    if ( CASTERS.has(cls) ) say("specialty", "strong", clsName);
    if ( cls === "investigator" ) say("specialty", "strong", has("devise-a-stratagem") ? named("devise-a-stratagem") : clsName);
    if ( cls === "thaumaturge" ) say("specialty", "some", has("exploit-vulnerability") ? named("exploit-vulnerability") : clsName);
  } else if ( !pc ) {
    if ( f.casting?.slots ) say("specialty", "strong", f.casting.slots);
    if ( f.casting?.innate ) say("specialty", "some", f.casting.innate);
  }

  // Consumables: an alchemist's and those built on them, freely; a merchant's eye for what things cost, sparingly.
  if ( cls === "alchemist" ) say("consumables", "freely", clsName);
  for ( const slug of CONSUMABLE_FEATS ) if ( has(slug) ) say("consumables", "freely", named(slug));
  if ( !pc && f.bomb ) say("consumables", "freely", f.bomb);
  if ( f.background?.slug === "merchant" ) say("consumables", "sparing", f.background.name || f.background.slug);
  if ( has("bargain-hunter") ) say("consumables", "sparing", named("bargain-hunter"));

  // Talking: the mindless and those without a language never; a devil deals; otherwise its social skills.
  if ( trait("mindless") ) say("talk", "never", trait("mindless"));
  if ( noWords ) say("talk", "never", noWords);
  if ( trait("devil") ) say("talk", "first", trait("devil"));
  const social = SOCIAL.map(slug => ({ slug, ...(f.social?.[slug] ?? {}) }));
  if ( pc && f.social ) {
    const best = social.reduce((a, b) => ((b.rank ?? 0) > (a.rank ?? 0) ? b : a));
    const rank = best.rank ?? 0;
    const why = t("Reason.Proficient", { name: best.name || best.slug, rank: best.rankName ?? rank });
    if ( rank >= 2 ) say("talk", "first", why);
    else if ( rank === 1 ) say("talk", "opportune", why);
    else say("talk", "never", t("Why.Untrained", { rank: best.rankName ?? rank, skills: listJoin(social.map(s => s.name || s.slug)) }));
  } else if ( f.social ) {
    const listed = social.filter(s => s.listed && Number.isFinite(s.mod));
    const best = listed.reduce((a, b) => (!a || b.mod > a.mod ? b : a), null);
    const sign = n => `${n >= 0 ? "+" : ""}${n}`;
    if ( best ) say("talk", best.mod >= highSkill(f.level) ? "first" : "opportune", t("Why.Skill", { skill: best.name || best.slug, mod: sign(best.mod) }));
  }

  // Healing others (with what it heals others with): a healer eagerly, anyone else as the fight allows. An ally dying:
  // one who heals goes to it.
  if ( healer ) say("healAggro", "aggressive", healer);
  say("healAggro", "balanced", healNames);
  if ( unthinking ) say("allyDying", "fight", unthinking);
  if ( rescue ) say("allyDying", "rescue", rescue.name);
  if ( guardian ) say("allyDying", "rescue", guardWhy);
  if ( healer ) say("allyDying", "rescue", healer);
  say("allyDying", "rescue", healNames);

  // Its own potions: vitality hurts the undead (void healing), and some can't be healed at all; one that mends by
  // itself waits until it's dire.
  const voidHealing = has("void-healing") ? named("void-healing") : trait("undead");
  if ( voidHealing ) say("potionThreshold", "never", voidHealing);
  const unhealable = immune("healing") ?? immune("vitality");
  if ( unhealable ) say("potionThreshold", "never", immuneWhy(unhealable));
  if ( f.mending ) say("potionThreshold", "25", f.mending);

  // Back up after going down.
  if ( f.mending ) say("selfRevived", "rejoin", f.mending);
  if ( unthinking ) say("selfRevived", "rejoin", unthinking);

  // Running: never for the mindless, constructs, the summoned, or one immune to fear.
  if ( unthinking ) say("retreat", "never", unthinking);
  if ( summoned ) say("retreat", "never", summoned);
  const fearless = immune("fear-effects");
  if ( fearless ) say("retreat", "never", immuneWhy(fearless));

  // Its shield: Reactive Shield raises it as the blow comes; Shield Block wants it up.
  if ( f.shield ) {
    if ( has("reactive-shield") ) say("shield", "spare", named("reactive-shield"));
    if ( has("shield-block") ) say("shield", "always", named("shield-block"));
  }

  // Others nearby: a pack hunts; the mindless, constructs, the summoned and animals stay with the fight.
  if ( has("pack-attack") ) say("beyond", "hunt", named("pack-attack"));
  for ( const why of [unthinking, summoned, trait("minion"), trait("animal")] ) if ( why ) say("beyond", "stay", why);

  // What it offers and expects to end an argument.
  const quiet = trait("mindless") ?? noWords ?? summoned;
  if ( quiet ) {
    say("offer", { kind: "" }, quiet);
    say("expect", { kind: "" }, quiet);
  }
  const coin = Number(f.purse?.coin) || 0;
  // (So much of its main coin by its level, as the core asks it: tens of gold.)
  const price = () => (coin ? { kind: "money", amount: coin >= 100 ? 10 * Math.max(1, Number(f.level) || 1) : Math.max(1, Math.ceil((Number(f.level) || 1) / 2)), coin } : null);
  // (A tenth of what it carries.)
  const share = () => {
    const amount = coin ? Math.floor((Number(f.purse?.money) || 0) / coin / 10) : 0;
    return amount >= 1 ? { kind: "money", amount, coin } : null;
  };
  const devil = trait("devil");
  if ( devil ) {
    say("offer", { kind: "passage" }, devil);
    say("expect", price(), devil);
  }
  const mercy = (cls === "champion" && has("redemption") ? named("redemption") : null) ?? trait("holy");
  if ( mercy ) say("offer", { kind: "noHarm" }, mercy);
  const background = f.background?.name || f.background?.slug;
  if ( f.background?.slug === "merchant" ) say("offer", share(), background);
  if ( f.background?.slug === "bandit" ) say("expect", price(), background);
  return out;
}

/** Text from the sheet's HTML. */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}

/** Every string in it (a biography's fields, edicts and anathema), as one text. */
export function textOf(value) {
  const parts = [];
  const walk = v => {
    if ( typeof v === "string" ) parts.push(plainText(v));
    else if ( Array.isArray(v) ) v.forEach(walk);
    else if ( v && typeof v === "object" ) Object.values(v).forEach(walk);
  };
  walk(value);
  return parts.filter(Boolean).join(". ");
}
