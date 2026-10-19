/**
 * PF2e's standard creature abilities (the Monster Core's glossary, and the ability every dragon has), by slug, as the
 * core plays them, built from the creature's own Strikes:
 *  - Draconic Frenzy: its Strikes for two actions, the ones its text counts ("two claw Strikes and one jaws Strike",
 *    by reading/en.json's "multiattack"), in the order that loses least to the multiple attack penalty (its agile
 *    Strikes last); each part counts as the Strike it's made with (`from`).
 *  - Rend: the Strike its entry names, its damage dealt with no roll, once two of those Strikes in a row hit one foe this
 *    turn (the core's requires.hits).
 *  - Pounce: a Stride, then its best melee Strike, for one action (as Sudden Charge is played).
 *  - Constrict and Greater Constrict: read as save abilities (abilities.js), and only on a creature it holds (the core's
 *    requires.holding).
 *  - Draconic Momentum: a critical hit with a Strike recharges its breath (the core's rechargeOnCrit).
 *  - On its spec: Swarm Mind (immune to mental effects that pick out a single creature: rules.js isImmune), Camouflage
 *    (it can Hide without cover: rules.js usable), Slow (slowed, as its text says, for good), Light Blindness (dazzled
 *    in a brightly lit scene), Surprise Attack (a foe that hasn't acted yet is off-guard to it: rules.js exposed), and a
 *    constant tongues or truespeech (it talks with anyone: the core's anyLanguage).
 * NO_FIGHT_EFFECT and PLAYED_ELSEWHERE list what needs nothing more.
 * Not played: Rend's and Draconic Frenzy's use from a reaction, Pounce's staying hidden until its Strike, Light
 * Blindness's blinded on first exposure (a creature in the fight has met the light by then), Camouflage's natural
 * surroundings (it Hides without cover anywhere), Slow's no reactions, a character's Surprise Attack (its initiative's
 * skill isn't known), and a creature's that asks for Deception or Stealth initiative (played as if it had).
 * Pure, unit-tested.
 */
import { plain, conditionsIn } from "./control.js";
import { currentReading } from "./reading.js";
import { READ_MOST } from "./trigger-lines.js";
import { strikesNamed } from "./requirements.js";
import { t } from "./words.js";
import { damageMean, bestStrike } from "./class-actions.js";

/**
 * Standard abilities that do nothing in a fight the engine can play, so there is nothing to read from them. The
 * coverage scan counts them as known.
 */
export const NO_FIGHT_EFFECT = Object.freeze(new Set([
  // Speaking mind to mind still needs a language in common, all the engine asks of talking.
  "telepathy",
  // A disguise or a travel shape: it fights in the shape its sheet gives (its Strikes and Speeds there).
  "change-shape",
  // A dragon's humanoid guise: its Speed and Strikes don't change, and it has no reason to take it mid-fight.
  "dragon-change-shape",
  // Smoke's concealment: nothing in the engine makes smoke.
  "smoke-vision",
  // How long it holds its breath: nothing in a fight the engine plays has anyone hold it (no drowning, no airless gullet).
  "deep-breath",
  // A heading: the spells under it are its own spell items, each read (or skipped as always on) for itself.
  "constant-spells",
  // It re-forms days after it's destroyed, long after the fight.
  "ghost-rejuvenation",
  // How long a clockwork runs once wound: hours, never the few rounds of a fight.
  "wind-up",
  "clockwork-creature-wind-up"
]));

/** Standard abilities the engine already plays some other way: nothing more to read from them. */
export const PLAYED_ELSEWHERE = Object.freeze(new Set([
  // The throw is its Rock Strike, a ranged Strike on its sheet for one action.
  "throw-rock",
  // Drawing and striking in one action: a creature's weapons are drawn already, and a character with it draws for free
  // (adapter.js #strikes).
  "quick-draw"
]));

/** Abilities this module reads from an item of that slug (adapter.js gathers them for glossaryActions and the rest). */
export const GLOSSARY_SLUGS = Object.freeze(new Set([
  "draconic-frenzy", "rend", "rend-jaws", "pounce", "constrict", "greater-constrict", "draconic-momentum", "swarm-mind",
  "camouflage", "slow", "light-blindness", "surprise-attack"
]));

/** Abilities that act only on a creature they hold. */
const HOLDING = new Set(["constrict", "greater-constrict"]);

/** A dragon's breath, whatever it breathes: what Draconic Momentum recharges. */
const BREATH = /(?:^|-)breath(?:-|$)/;

/** Its melee Strikes with damage, as the adapter read them (not one built on another: a class action, a poison). */
const meleeOf = strikes => strikes.filter(s => s.kind === "strike" && s.melee && s.damage?.length && !s.sequence && !s.classAction);

/** Agile Strikes take a smaller multiple attack penalty: made last, they lose least. */
const agile = s => (s.traits ?? []).includes("agile") || (Number(s.maps?.[1]) || -5) > -5;

/**
 * What a multiattack's text counts: [{n, name}], by reading/en.json's "multiattack" entries (a count word and a Strike's
 * name before "Strike"), the first entry that finds any.
 */
export function countedStrikes(html, words = currentReading()) {
  const text = plain(html).toLowerCase().slice(0, READ_MOST.text);
  for ( const entry of Array.isArray(words?.multiattack) ? words.multiattack : [] ) {
    let re;
    try {
      re = new RegExp(entry.pattern, "gi");
    } catch ( err ) {
      continue;
    }
    const out = [];
    for ( const m of text.matchAll(re) ) {
      const word = String(m.groups?.n ?? "").toLowerCase();
      const n = Number(entry.numbers?.[word]) || Number(word) || 0;
      if ( n > 0 && m.groups?.strike ) out.push({ n, name: m.groups.strike.trim() });
    }
    if ( out.length ) return out;
  }
  return [];
}

/**
 * Draconic Frenzy as the core's multiattack: the Strikes its text counts, each the best of its Strikes of that name (a
 * name none of them has, "bite" for its jaws: its best melee Strike not counted yet), the non-agile first. Null when the
 * text counts fewer than two.
 */
export function frenzyAction({ actorId, ability, strikes, words = currentReading() }) {
  const melee = meleeOf(strikes);
  const counted = countedStrikes(ability.html, words);
  if ( counted.reduce((n, c) => n + c.n, 0) < 2 || !melee.length ) return null;
  const used = new Set();
  const parts = [];
  for ( const { n, name } of counted ) {
    const ids = strikesNamed(melee, name);
    const strike = bestStrike(ids ? melee.filter(s => ids.includes(s.id)) : melee.filter(s => !used.has(s.id))) ?? bestStrike(melee);
    used.add(strike.id);
    for ( let i = 0; i < Math.min(n, 4); i++ ) parts.push(strike);
  }
  parts.sort((a, b) => Number(agile(a)) - Number(agile(b)) || damageMean(b.damage) - damageMean(a.damage));
  const sequence = parts.map((s, i) => ({ ...s, id: `${s.id}.frenzy.${i}`, from: s.id }));
  return {
    ...parts[0], id: `${actorId}.${ability.id}`, name: ability.name, cost: Math.max(1, Math.min(3, Number(ability.actions) || 2)),
    reach: Math.min(...parts.map(s => Number(s.reach) || 5)), hands: Math.max(0, ...parts.map(s => Number(s.hands) || 0)),
    sequence, itemId: ability.id, glossary: "draconic-frenzy"
  };
}

/**
 * The Strikes a Rend is for: the one its entry names (its first line, "Claw": what follows a label in it, or its first
 * sentence); else the one its own words count ("two claw Strikes": reading/en.json's "multiattack"); else, naming
 * none, its one melee Strike if it has only one.
 */
function rendStrikes(ability, melee, words) {
  const named = plain(String(ability.html ?? "").split(/<hr\b/i)[0]);
  const tries = [named, named.split(/[:：]/).pop(), named.split(/[.;]/)[0], ...countedStrikes(ability.html, words).map(c => c.name)].filter(x => x && x.trim());
  for ( const name of tries ) {
    const ids = strikesNamed(melee, name);
    if ( ids ) return ids;
  }
  return !tries.length && melee.length === 1 ? [melee[0].id] : null;
}

/** Rend: the named Strike's damage, no roll, after two hits in a row on one foe with it (its entry names the Strike). */
export function rendAction({ actorId, ability, strikes, words = currentReading() }) {
  const melee = meleeOf(strikes);
  const ids = rendStrikes(ability, melee, words);
  const strike = ids ? bestStrike(melee.filter(s => ids.includes(s.id))) : null;
  if ( !strike ) return null;
  return {
    id: `${actorId}.${ability.id}`, name: ability.name, kind: "auto", cost: Math.max(1, Math.min(3, Number(ability.actions) || 1)), traits: [], ability: true,
    melee: true, reach: Number(strike.reach) || 5, damage: strike.damage, requires: { hits: { n: 2, with: ids } }, itemId: ability.id, glossary: "rend",
    // (Its damage that Strike's, rolled with PF2e's own damage roller in a live battle: action-roll.js.)
    strikeOf: strike.id
  };
}

/** Pounce: a Stride and its best melee Strike, for one action. */
export function pounceAction({ ability, strikes }) {
  const strike = bestStrike(meleeOf(strikes));
  if ( !strike ) return null;
  return { ...strike, id: `${strike.id}.pounce`, from: strike.id, name: t("WithStrike", { action: ability.name, strike: strike.name }),
    cost: Math.max(1, Math.min(3, Number(ability.actions) || 1)), charge: 1, glossary: "pounce" };
}

/**
 * The actions its standard abilities make (Draconic Frenzy, Rend, Pounce).
 * @param {object} d
 * @param {string} d.actorId
 * @param {{id: string, slug: string, name: string, html: string, actions?: number}[]} d.abilities  its abilities of
 *   GLOSSARY_SLUGS, their text worked out (adapter.js resolvedText)
 * @param {object[]} d.strikes  its Strikes, as engine actions
 * @param {object} [d.words]    the reading (reading.js)
 */
export function glossaryActions({ actorId, abilities = [], strikes = [], words = currentReading() }) {
  const out = [];
  for ( const ability of abilities ) {
    let action = null;
    if ( ability.slug === "draconic-frenzy" ) action = frenzyAction({ actorId, ability, strikes, words });
    else if ( ability.slug === "rend" || ability.slug === "rend-jaws" ) action = rendAction({ actorId, ability, strikes, words });
    else if ( ability.slug === "pounce" ) action = pounceAction({ ability, strikes });
    if ( action ) out.push(action);
  }
  return out;
}

/**
 * What its standard abilities say of actions read already (each by the item it came from, `itemId`): Constrict acts
 * only on a creature it holds; Draconic Momentum recharges its breath on a critical hit. The list, changed in place.
 * @param {object[]} actions
 * @param {{id: string, slug: string}[]} abilities  its abilities of GLOSSARY_SLUGS
 * @param {{id: string, slug: string}[]} [items]   all its abilities ({id, slug}), to tell a breath by its slug
 */
export function markGlossary(actions, abilities = [], items = []) {
  const holding = new Set(abilities.filter(a => HOLDING.has(a.slug)).map(a => a.id));
  const momentum = abilities.some(a => a.slug === "draconic-momentum");
  const breaths = new Set(items.filter(i => BREATH.test(String(i.slug ?? ""))).map(i => i.id));
  for ( const a of actions ) {
    if ( holding.has(a.itemId) ) a.requires = { holding: true };
    if ( momentum && breaths.has(a.itemId) && a.cooldown && Number.isFinite(a.uses) ) a.rechargeOnCrit = true;
  }
  return actions;
}

/** Spells that, constant, let it understand and speak every language (by slug). */
export const EVERY_LANGUAGE = Object.freeze(new Set(["tongues", "truespeech"]));

/**
 * What its standard passives put on its spec: {swarmMind, camouflage, surpriseAttack, conditions, anyLanguage}, each
 * only where it has the ability.
 * @param {object} d
 * @param {{slug: string, html: string}[]} [d.abilities]  its abilities of GLOSSARY_SLUGS
 * @param {boolean} [d.bright]          the scene is brightly lit (PF2e's own reading of its light)
 * @param {string[]} [d.constant]       its constant spells' slugs
 */
export function glossarySpec({ abilities = [], bright = false, constant = [] } = {}) {
  const has = slug => abilities.find(a => a.slug === slug) ?? null;
  const out = {};
  const conditions = {};
  if ( has("swarm-mind") ) out.swarmMind = true;
  if ( has("camouflage") ) out.camouflage = true;
  if ( has("surprise-attack") ) out.surpriseAttack = true;
  const slow = has("slow");
  if ( slow ) conditions.slowed = Math.max(1, Number(conditionsIn(plain(slow.html).toLowerCase()).slowed) || 1);
  if ( has("light-blindness") && bright ) conditions.dazzled = 1;
  if ( Object.keys(conditions).length ) out.conditions = conditions;
  if ( constant.some(s => EVERY_LANGUAGE.has(s)) ) out.anyLanguage = true;
  return out;
}
