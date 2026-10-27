/**
 * A PF2e creature's own abilities that aren't Strikes or spells: an action whose text asks for a save, and deals
 * damage or lays a condition on a failure (Breath Weapon, Trample, Frightful Presence used as an action, a Drain).
 * Read from the inline checks the system writes into the text: @Check[reflex|dc:29|basic], @Damage[10d6[fire]],
 * @Template[cone|distance:40] (or "a 30-foot cone"), and "can't use Breath Weapon again for 1d4 rounds".
 * Pure, unit-tested.
 */
import { parseTypedFormula } from "./core.js";
import { parseControl, plain, conditionsIn, conditionsLabel, durationRounds, escapeAt, escapeIn, failureRiders } from "./control.js";
import { requirementOf, withoutRequirement, rollsItself } from "./requirements.js";
import { currentReading } from "./reading.js";

const SAVES = { fortitude: "fortitude", fort: "fortitude", reflex: "reflex", ref: "reflex", will: "will" };

/** @Check's parameters: the first bare word is its type; "dc:29"; "basic" (or "basic:true"). */
export function checkParams(inside) {
  const out = {};
  String(inside ?? "").split("|").forEach((raw, i) => {
    const at = raw.indexOf(":");
    if ( at < 0 ) out[i === 0 ? "type" : raw.trim().toLowerCase()] = i === 0 ? raw.trim().toLowerCase() : "true";
    else out[raw.slice(0, at).trim().toLowerCase()] = raw.slice(at + 1).trim();
  });
  return out;
}

/** Whether a text asks for a save at all: an @Check of Fortitude, Reflex or Will, whatever its DC (a class DC's too). */
export function asksSave(html) {
  for ( const m of String(html ?? "").matchAll(/@Check\[([^\]]+)\]/gi) ) if ( Object.hasOwn(SAVES, checkParams(m[1]).type ?? "") ) return true;
  return false;
}

/** The first save an ability's text asks for: {type, dc, basic} or null. */
export function saveIn(html) {
  const text = String(html ?? "");
  const check = /@Check\[([^\]]+)\]/i.exec(text);
  if ( check ) {
    const p = checkParams(check[1]);
    const type = SAVES[p.type];
    const dc = Number(p.dc);
    if ( type && Number.isFinite(dc) ) return { type, dc, basic: p.basic === "true" || p.basic === "" };
  }
  // Plain words: "DC 29 basic Reflex save".
  const words = /DC (\d+) (basic )?(Fortitude|Reflex|Will)/i.exec(plain(text));
  return words ? { type: words[3].toLowerCase(), dc: Number(words[1]), basic: !!words[2] } : null;
}

/**
 * Text with its inline rolls written out: "[[/gmr 1d4 #Recharge]]{1d4 rounds}" reads "1d4 rounds", and
 * "[[/gmr 1d4 #Recharge]] rounds" reads "1d4 rounds".
 */
function rollsWritten(html) {
  return String(html ?? "").replace(/\[\[\/\w+\s+\{?([^}\]#]*?)\}?(?:\[[^\]]*\])?\s*(?:#[^\]]*)?\]\](?:\{([^}]*)\})?/g,
    (m, formula, label) => label ?? formula.trim());
}

/**
 * Every @Damage (and old-style [[/r 4d6[fire]]] damage roll) in the text, as engine damage parts. The same dice
 * listed again under another type are alternatives (a chimera's breath, by which head it has): only the first counts.
 */
export function damageIn(html) {
  const text = String(html ?? "");
  const formulas = [];
  for ( const m of text.matchAll(/@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\]/gi) ) formulas.push(m[1].split("|")[0]);
  // (Only rolls that name a damage type: a "[[/gmr 1d4 #Recharge]]" is how long, not how much.)
  for ( const m of text.matchAll(/\[\[\/(?:r|roll|br|gmr)\s+\{?([^}\]#]+)\}?(\[[a-z,]+\])\]\]/gi) ) formulas.push(`${m[1]}${m[2]}`);
  const parts = formulas.flatMap(f => parseTypedFormula(f.replace(/\(([^()]*)\)\[/g, "$1["))).filter(p => p.dice.length || p.flat > 0);
  const seen = new Set();
  return parts.filter(p => {
    const key = `${p.dice.map(d => `${d.n}d${d.faces}`).join("+")}+${p.flat}|${!!p.persistent}`;
    if ( seen.has(key) ) return false;
    seen.add(key);
    return true;
  });
}

/** The area an ability covers: {shape, feet} from its template, or its words ("a 30-foot cone"). */
export function templateIn(html) {
  const text = String(html ?? "");
  const tpl = /@Template\[(?:type:)?(\w+)\|distance:(\d+)/i.exec(text);
  // (A cylinder, "10 feet in diameter" (distance 5, its radius), lands where it's aimed: a burst, as spells' areas are.)
  if ( tpl ) return { shape: tpl[1].toLowerCase() === "cylinder" ? "burst" : tpl[1].toLowerCase(), feet: Number(tpl[2]) };
  const words = /(\d+)-foot (cone|line|burst|emanation)/i.exec(plain(text));
  return words ? { shape: words[2].toLowerCase(), feet: Number(words[1]) } : null;
}

/**
 * Does an area spare whom its maker chooses (the core's area.selective): its text says it catches only enemies, or
 * creatures of one's choice (reading/<lang>.json areas.selective)? Else it catches everyone in it, friends too.
 */
export function selectiveIn(html, words) {
  const p = words?.areas?.selective?.pattern;
  if ( typeof p !== "string" ) return false;
  try {
    return new RegExp(p, "i").test(plain(html));
  } catch ( err ) {
    return false;
  }
}

/** About how many foes an area of this shape and size catches. (Not adapter.js areaTargets, a spell's: they differ.) */
export function areaFoes({ shape, feet }) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  if ( shape === "cone" ) return clamp(feet / 12, 2, 6);
  if ( shape === "line" ) return clamp(feet / 30 + 1, 2, 4);
  return clamp(feet / 7 + 1, 2, 8); // burst, emanation
}

/**
 * "Can't use Breath Weapon again for 1d4 rounds", "once every 1d4 rounds": {n, faces}; a fixed wait ("for 1 round") as
 * so many d1. The wordings are reading/<lang>.json's `cooldown` (named groups n and faces, or rounds).
 */
export function cooldownIn(html, words = currentReading()) {
  const text = plain(rollsWritten(html));
  for ( const { pattern } of words?.cooldown ?? [] ) {
    let m = null;
    try {
      m = new RegExp(pattern, "i").exec(text);
    } catch ( err ) {
      continue;
    }
    const g = m?.groups ?? {};
    if ( g.n && g.faces ) return { n: Number(g.n), faces: Number(g.faces) };
    if ( g.rounds ) return { n: Number(g.rounds), faces: 1 };
  }
  return null;
}

/** Healing in an ability's damage is what it does for itself (a drain), not harm to its target. */
const harmIn = html => damageIn(html).filter(p => p.type !== "healing");

/** Its first @Damage alone (several are often alternatives: thrown at a wall, or at a foe). */
const firstDamage = html => /@Damage\[(?:[^\[\]]|\[[^\]]*\])*\]/i.exec(String(html ?? ""))?.[0] ?? "";

/**
 * How far an ability that needs something of its Strikes reaches: the reach of the Strikes its requirement names (a
 * bite after a bite), else of its longest melee Strike (a squeeze on whoever it holds), else 5 feet.
 */
function reachFor(requires, strikes) {
  const named = [].concat(requires ?? []).flatMap(r => [...(r.lastHit?.with ?? []), ...(r.hits?.with ?? [])]);
  const melee = strikes.filter(s => s.melee !== false && Number(s.reach) > 0 && (!named.length || named.includes(s.id)));
  return melee.length ? Math.max(...melee.map(s => Number(s.reach))) : 5;
}

/**
 * An action for the engine from one ability, or null when it isn't something to use on a turn (a reaction, a
 * passive) or doesn't ask for a save that hurts or hinders. One with a Requirements line it can express (a foe it holds,
 * its last action a hit, a condition on its target or itself: requirements.js) carries it as the core's `requires`,
 * and may then simply deal its damage, with no save (a drain on a foe it holds); one whose line it can't express
 * ("adjacent to their hoard") isn't used at all.
 * @param {object} d
 * @param {string} d.id
 * @param {string} d.name
 * @param {string} d.html          its description
 * @param {number} [d.actions]     what it costs (1-3)
 * @param {string} [d.actionType]  "action", "reaction", "free" or "passive"
 * @param {string[]} [d.traits]
 * @param {{id?: string, name: string, slug?: string, damage: object[], reach?: number, melee?: boolean}[]} [d.strikes]
 *   its Strikes, for an ability that uses one's damage (Trample) or names one in its requirement
 * @param {object} [d.words]       the reading (reading.js), for its requirement
 */
export function abilityAction({ id, name, html: whole, actions = 1, actionType = "action", traits = [], strikes = [], words = currentReading() }) {
  if ( actionType !== "action" ) return null;
  // (What it needs first: undefined, nothing; null, something it can't express, "adjacent to their hoard".)
  const requires = requirementOf(whole, { strikes, words });
  if ( requires === null ) return null;
  const html = requires ? withoutRequirement(whole, words) : whole;
  const needs = requires ? { requires } : {};
  const save = saveIn(html);
  const damage = harmIn(html);
  // No save: with what it needs met (a foe it holds, a hit just landed), its damage simply lands; not where it rolls
  // for it (a check of its own, an action's link, a Strike: reading/en.json's "rolled").
  if ( !save ) {
    if ( !requires || !damage.length || /@Check\[|\[\[\/act\b/i.test(html) || rollsItself(html, words) ) return null;
    const cooldown = cooldownIn(html, words);
    return { id, name, kind: "auto", cost: Math.max(1, Math.min(3, Number(actions) || 1)), traits, ability: true, damage: harmIn(firstDamage(html)), melee: true,
      reach: reachFor(requires, strikes), ...needs, ...(cooldown ? { uses: 1, cooldown } : {}) };
  }
  // Trample: "Large or smaller, foot, DC 24": the named Strike's damage to each creature it moves through.
  const trample = /^\s*(?:tiny|small|medium|large|huge|gargantuan) or smaller,\s*([^,]+?)\s*,/i.exec(plain(html));
  if ( !damage.length && trample ) {
    const wanted = trample[1].toLowerCase().split(/\s+or\s+/)[0];
    const strike = strikes.find(s => s.name.toLowerCase() === wanted) ?? strikes.find(s => s.name.toLowerCase().includes(wanted));
    if ( !strike?.damage?.length ) return null;
    return { id, name, kind: "save", cost: Math.max(1, Math.min(3, Number(actions) || 3)), traits, save: { ...save, basic: true }, ability: true,
      damage: strike.damage, melee: true, reach: 5, area: { targets: 2 }, ...needs };
  }
  const text = plain(html);
  // (A hold it lays that an Escape breaks: against the DC its words name, else the ability's own.)
  let outcomes = escapeAt(parseControl({ description: html }), save.dc);
  // No list by degree: "must succeed at a Will save or become frightened 1", "becomes Frightened 1 unless it
  // succeeds": a failure lays it on. (What it requires first, "the akhana has a creature grabbed", isn't an effect.)
  if ( !damage.length && !outcomes ) {
    const effect = text.replace(/^.*?\bRequirements?\b.*?\bEffect\b/i, "");
    const conditions = conditionsIn(effect);
    if ( !Object.keys(conditions).length ) return null;
    const escape = escapeIn(effect, conditions);
    const lasting = { conditions, rounds: durationRounds(effect) ?? conditions.frightened ?? 1, label: conditionsLabel(conditions),
      ...(escape ? { escape: { ...escape, dc: escape.dc ?? save.dc } } : {}) };
    outcomes = [lasting, lasting, null, null];
  }
  const area = templateIn(html);
  const within = /within (\d+) feet/i.exec(text);
  // A cone, a line or an emanation starts from the creature; a burst lands where it's aimed.
  const feet = within ? Number(within[1]) : area && area.shape !== "burst" ? area.feet : null;
  const cooldown = cooldownIn(html, words);
  const action = {
    id, name, kind: damage.length ? "save" : "control", cost: Math.max(1, Math.min(3, Number(actions) || 1)), traits,
    save, ability: true, ...needs,
    ...(feet ? { range: { increment: feet, max: feet, noPenalty: true }, melee: false } : { melee: true, reach: requires ? reachFor(requires, strikes) : 5 }),
    ...(area ? { area: { targets: areaFoes(area), shape: area.shape, feet: area.feet } } : {}),
    ...(cooldown ? { uses: 1, cooldown } : {})
  };
  if ( damage.length ) {
    action.damage = damage;
    // What a failure (or a critical failure) also lays on it: "it's knocked prone", "it's frightened 1".
    const effects = failureRiders(outcomes);
    if ( effects.length ) action.effects = effects;
  } else action.onSave = outcomes;
  return action;
}
