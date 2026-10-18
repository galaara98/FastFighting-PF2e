/**
 * PF2e reactions and triggered free actions the helper doesn't know by slug, read into the core's reactions (its
 * responses.js and reaction-effects.js): the moment from the Trigger line, what it does from the item's structure.
 *
 *  - The moment: the Trigger line, read by the grammar in reading/en.json (trigger-lines.js): only a line a "whole"
 *    entry matches builds a reaction, with that entry's filters (a critical hit, melee or ranged, how near, the
 *    damage types, which of its own strikes).
 *  - What it does, from the Effect: @Damage at whoever set it off (harm; a basic @Check its save, or a plain one: a
 *    save that spares it all), or around itself (areaBurst: those beside it, those within so many feet, an
 *    emanation); healing @Damage, hit points for itself (heal); conditions its text links (@UUID to PF2e's
 *    conditions), on whoever set it off (afflict), by degree where its degrees list them (as abilities.js and
 *    control.js read degrees: Critical Success, Success, Failure, Critical Failure), or a failed save's where its words
 *    say "or" (the same condition linked twice: the higher a critical failure's); an effect it links, a buff on itself
 *    (boost: effects.js reads the effect's rules), or one on the foe where all it does is hinder; a Strike, a bonus to
 *    AC against the attack, one of its own actions ready again, by reading/en.json's "effects" patterns.
 *  - Uses: its frequency (as abilities.js reads it), or once where it can't be used again for a while.
 * A reaction is built only where the engine can play what it read: a sentence that happens only sometimes ("if the
 * attack misses") is left out of it, and one with a choice, a teleport, a counteraction or the like keeps it from
 * being built at all.
 * Pure: the item's links come resolved (`conditionOf`, `effectOf`), and the words from reading/en.json.
 */
import { classifyLine, normalizeLine, selfWords, wholeLine } from "./trigger-lines.js";
import { damageIn, saveIn, cooldownIn, checkParams } from "./abilities.js";
import { plain, durationRounds, conditionsLabel } from "./control.js";
import { modsFromRules, ruleValue, effectRounds, helps } from "./effects.js";

/** The core's moments this reader builds for. */
export const READ_TRIGGERS = Object.freeze(["attacked", "hit", "missed", "damaged", "slain", "ownHit", "foeCasts", "foeApproaches"]);

/** PF2e's damage types (its identifiers), and "physical" for bludgeoning, piercing and slashing. */
const DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic",
  "spirit", "vitality", "void", "bleed", "holy", "unholy", "untyped", "physical"]);

/**
 * PF2e's conditions a reaction may lay on a foe, as the engine's keys (the core's and the rules' own: offGuard; a hold is
 * the engine's grab, the one who laid it holding).
 */
const ON_FOE = Object.freeze({
  blinded: { blinded: 1 }, clumsy: "clumsy", confused: { confused: 1 }, dazzled: { dazzled: 1 }, deafened: { deafened: 1 }, drained: "drained",
  enfeebled: "enfeebled", fascinated: { fascinated: 1 }, fatigued: { fatigued: 1 }, fleeing: { fleeing: 1 }, frightened: "frightened",
  immobilized: { immobilized: 1 }, "off-guard": { offGuard: 1 }, paralyzed: { paralyzed: 1 }, prone: { prone: 1 }, sickened: "sickened",
  slowed: "slowed", stunned: "stunned", stupefied: "stupefied", unconscious: { unconscious: 1, incapacitated: 1, offGuard: 1 },
  restrained: { immobilized: 1, offGuard: 1 }, grabbed: "grab"
});
/** PF2e's conditions that help the one who has them, laid on itself: a buff. */
const ON_SELF = Object.freeze({ concealed: { concealed: 1 }, invisible: { invisible: 1 }, hidden: { hidden: 1 }, quickened: { quickened: 1 } });

const DEGREES = ["Critical Failure", "Failure", "Success", "Critical Success"];
const CHECK = /@Check\[([^\]]+)\]/gi;
const SAVE_TYPES = new Set(["fortitude", "reflex", "will", "fort", "ref"]);

/** The part of a description after its Trigger (and Requirements, Frequency): its Effect. */
export function effectPart(html) {
  const text = String(html ?? "");
  const effect = /<strong>\s*Effect\s*<\/strong>/i.exec(text);
  if ( effect ) return text.slice(effect.index + effect[0].length);
  const rule = /<hr\s*\/?>/i.exec(text);
  if ( rule && /<strong>\s*Trigger\s*<\/strong>/i.test(text.slice(0, rule.index)) ) return text.slice(rule.index + rule[0].length);
  return text.replace(/<p>\s*<strong>\s*(?:Trigger|Requirements?|Frequency)\s*<\/strong>[\s\S]*?<\/p>/gi, " ");
}

/** The Trigger line's text, plain, or "". */
export function triggerText(html) {
  const m = /<strong>\s*Trigger\s*<\/strong>([\s\S]*?)(?:<\/p>|<hr|<strong>)/i.exec(String(html ?? ""));
  return m ? plain(m[1]).replace(/[.;]\s*$/, "") : "";
}

/** The html under each degree heading ([critical failure, failure, success, critical success], null where none), and before them. */
function degreeParts(html) {
  const out = [null, null, null, null];
  const re = /<strong>\s*(Critical Success|Success|Failure|Critical Failure)\s*<\/strong>([\s\S]*?)(?=<strong>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/strong>|<hr|$)/g;
  let first = null;
  for ( const m of String(html ?? "").matchAll(re) ) {
    first ??= m.index;
    out[DEGREES.indexOf(m[1])] = m[2];
  }
  return { degrees: out, before: first === null ? String(html ?? "") : String(html).slice(0, first) };
}

/** A text's sentences, its @-links kept whole (their dots aren't followed by a space). */
const sentences = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z@])/).map(s => s.trim()).filter(Boolean);

/** The conditions a text links (@UUID to PF2e's conditions), [{slug, value}] in order, by `conditionOf(uuid)`. */
function linkedConditions(text, conditionOf) {
  const out = [];
  for ( const m of String(text ?? "").matchAll(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g) ) {
    const slug = conditionOf?.(m[1]);
    if ( !slug ) continue;
    const n = /(\d+)/.exec(m[2] ?? "");
    out.push({ slug, value: n ? Number(n[1]) : 1 });
  }
  return out;
}

/** The conditions a sentence links, each with the words before it ({cond: {slug, value}, upTo}): who it's laid on. */
function conditionsWithContext(text, conditionOf) {
  const out = [];
  const s = String(text ?? "");
  for ( const m of s.matchAll(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g) ) {
    const slug = conditionOf?.(m[1]);
    if ( !slug ) continue;
    const n = /(\d+)/.exec(m[2] ?? "");
    out.push({ cond: { slug, value: n ? Number(n[1]) : 1 }, upTo: s.slice(0, m.index) });
  }
  return out;
}

/** The effects a text links: [{uuid, effect}], by `effectOf(uuid)`. */
function linkedEffects(text, effectOf) {
  const out = [];
  for ( const m of String(text ?? "").matchAll(/@UUID\[([^\]]+)\]/g) ) {
    const effect = effectOf?.(m[1]);
    if ( effect ) out.push({ uuid: m[1], effect });
  }
  return out;
}

/**
 * Conditions as an outcome on a foe: the engine's keys with their values, for how long ("for 1 round", "until the end
 * of its next turn"; frightened as long as its value), a hold as the engine's grab; null when none of them is one the
 * engine lays.
 */
function foeOutcome(conds, text) {
  const conditions = {};
  let grab = false;
  for ( const { slug, value } of conds ) {
    const k = ON_FOE[slug];
    if ( !k ) return null;
    if ( k === "grab" ) grab = true;
    else if ( typeof k === "string" ) conditions[k] = Math.max(conditions[k] ?? 0, value);
    else for ( const [key, v] of Object.entries(k) ) conditions[key] = Math.max(conditions[key] ?? 0, v);
  }
  if ( !Object.keys(conditions).length && !grab ) return null;
  const rounds = durationRounds(plain(text)) ?? conditions.frightened ?? (conditions.stunned ? 1 : null) ?? 1;
  // (A fight is soon over: a day of it is as long as the fight.)
  return { conditions, rounds: Math.min(100, Math.max(1, rounds)), label: conditionsLabel(conditions), ...(grab ? { grab: true } : {}) };
}

/** A save an @Check asks: {type, dc, basic}, or null (not a save, or no DC). */
function saveOf(text) {
  for ( const m of String(text ?? "").matchAll(CHECK) ) {
    const p = checkParams(m[1]);
    if ( !SAVE_TYPES.has(p.type) ) continue;
    const s = saveIn(`@Check[${m[1]}]`);
    if ( s ) return s;
  }
  return null;
}

/** An effect item's rules as an outcome: {outcome, helps}, or null where they do nothing the engine plays. */
function effectOutcome(effect, { level = 1, label = "" } = {}) {
  const rules = effect?.system?.rules ?? [];
  const { mods, tempHp, fastHealing, regen } = modsFromRules(rules, { rank: level, actor: { level } });
  const resist = {};
  for ( const r of rules ) {
    if ( r?.key !== "Resistance" || (Array.isArray(r.predicate) ? r.predicate.length : r.predicate) ) continue;
    const v = ruleValue(r.value, { rank: level, actor: { level } });
    for ( const type of [].concat(r.type ?? []) ) if ( Number(v) > 0 && DAMAGE_TYPES.has(type) ) resist[type] = Math.max(resist[type] ?? 0, Number(v));
  }
  const has = Object.keys(mods).length || tempHp || fastHealing || regen || Object.keys(resist).length;
  if ( !has ) return null;
  const outcome = {
    ...(Object.keys(mods).length ? { mods } : {}), ...(tempHp ? { tempHp } : {}), ...(fastHealing ? { fastHealing } : {}), ...(regen ? { regen } : {}),
    ...(Object.keys(resist).length ? { iwr: { resist } } : {}), rounds: effectRounds(effect.system?.duration) ?? 1, label: label || effect.name || ""
  };
  return { outcome, helps: !!(tempHp || fastHealing || regen || Object.keys(resist).length) || helps(mods) };
}

/** Its own strikes a name means ("jaws", "claw or tail"): their ids, or [] where none is one of them. */
function strikesNamed(name, strikes) {
  const want = String(name ?? "").toLowerCase().split(/\s+or\s+|,\s*/).map(w => w.trim()).filter(Boolean);
  const ids = [];
  for ( const w of want ) {
    const s = strikes.find(x => String(x.name ?? "").toLowerCase() === w) ?? strikes.find(x => String(x.slug ?? "") === w.replace(/[^a-z0-9]+/g, "-"));
    if ( !s ) return [];
    ids.push(s.id);
  }
  return ids;
}

/** Its own actions a name means (one it recharges): their ids. */
function actionsNamed(name, actions) {
  const w = String(name ?? "").toLowerCase().trim();
  return actions.filter(a => String(a.name ?? "").toLowerCase() === w).map(a => a.id);
}

/** The entries of reading's "effects" that say `effect`. */
const effectsSaying = (reading, effect) => (reading?.effects ?? []).filter(e => e?.effect === effect && e.pattern);
const firstMatch = (entries, text) => {
  for ( const e of entries ) {
    let re;
    try {
      re = new RegExp(e.pattern, "i");
    } catch ( err ) {
      continue;
    }
    const m = re.exec(text);
    if ( m ) return { entry: e, match: m, groups: Object.fromEntries(Object.entries(m.groups ?? {}).filter(([, v]) => v).map(([k, v]) => [k.replace(/\d+$/, ""), v])) };
  }
  return null;
};

/**
 * The trigger a reaction's line means, whole: {trigger, crit, melee, ranged, range, strike, types}, or null.
 * @param {string} line   the Trigger line, plain
 * @param {object} o      {name, kinds, reading}
 */
export function readTrigger(line, { name = "", kinds = [], reading = {} } = {}) {
  if ( !line ) return null;
  const norm = normalizeLine(line, { name, kinds, words: selfWords(reading) });
  const whole = wholeLine(classifyLine(norm, reading?.triggers ?? []));
  return whole && READ_TRIGGERS.includes(whole.trigger) ? whole : null;
}

/**
 * What a reaction's Effect does, read: the core's effect keys ({harm, afflict, boost, heal, recharge, strike, ac,
 * areaBurst, effectRef}), or null when it holds something the engine can't play (a choice, a teleport ...) or nothing it
 * can.
 * @param {string} html     its Effect (effectPart), @Damage and @Check worked out, its links kept
 * @param {object} o
 * @param {string} o.trigger                the moment (readTrigger's)
 * @param {object} o.reading                reading/en.json's sections
 * @param {string} [o.name]                 the creature's name, [o.kinds] its traits: "the dragon" is it
 * @param {number} [o.level]                its level, for an effect's formulas
 * @param {object[]} [o.strikes]            its Strikes: [{id, name, slug}]
 * @param {object[]} [o.actions]            its own actions: [{id, name}], for one it recharges
 * @param {Function} [o.conditionOf]        a link's uuid -> a PF2e condition's slug, or null
 * @param {Function} [o.effectOf]           a link's uuid -> a PF2e effect item, or null
 */
export function readEffects(html, { trigger, reading = {}, name = "", kinds = [], level = 1, strikes = [], actions = [], conditionOf = null, effectOf = null } = {}) {
  const words = selfWords(reading);
  const norm = s => normalizeLine(plain(s), { name, kinds, words });
  const whole = norm(html);
  if ( firstMatch(effectsSaying(reading, "unclear"), whole) ) return null;
  const { degrees, before } = degreeParts(html);
  const out = {};
  const harmDamage = [];
  let harmSave = null;
  let around = null;
  const foeConds = [];
  let foeText = "";
  // (The save the sentence laying its conditions calls for; or, where it says a failure lays them, its harm's.)
  let condSave = null;
  let onFail = false;
  const selfConds = {};
  const uuids = [];
  // (Who the words before it name last: the one who set it off, or itself.)
  const lastAt = (entries, text) => {
    let at = -1;
    for ( const e of entries ) {
      for ( const m of text.matchAll(new RegExp(e.pattern, "gi")) ) at = Math.max(at, m.index);
    }
    return at;
  };
  const foeAt = text => lastAt(effectsSaying(reading, "foe"), text);
  const selfAt = text => lastAt([{ pattern: `\\b${words.you}\\b` }], text);
  const foeBefore = text => foeAt(text) >= 0 && foeAt(text) > selfAt(text);
  const selfBefore = text => selfAt(text) >= 0 && selfAt(text) > foeAt(text);
  // (An area from itself: an emanation's size; a cone, a line or a burst somewhere else, not one it can play.)
  const template = /@Template\[(?:type:)?(\w+)\|distance:(\d+)/i.exec(String(html));
  if ( template ) {
    if ( template[1].toLowerCase() !== "emanation" ) return null;
    around = Number(template[2]);
  }
  for ( const s of sentences(before) ) {
    const n = norm(s);
    if ( firstMatch(effectsSaying(reading, "unless"), n) ) continue;
    const near = firstMatch(effectsSaying(reading, "around"), n);
    if ( near ) around = Number(near.groups.range) || Number(near.entry.range) || around || 5;
    // A strike back, by its name where it gives one.
    const strike = firstMatch(effectsSaying(reading, "strike"), n);
    if ( strike ) {
      const named = strike.groups.strike ? strikesNamed(strike.groups.strike, strikes) : null;
      if ( named && !named.length ) return null;
      out.strike = named ? (named.length === 1 ? named[0] : named) : true;
    }
    const ac = firstMatch(effectsSaying(reading, "ac"), n);
    if ( ac && ["attacked", "hit"].includes(trigger) ) out.ac = Number(ac.groups.value) || 0;
    const back = firstMatch(effectsSaying(reading, "recharge"), n);
    if ( back ) {
      const ids = actionsNamed(back.groups.action, actions);
      if ( ids.length ) out.recharge = ids;
    }
    // Its damage: healing for itself, anything else at whoever set it off (or around it); its save, the sentence's own.
    const damage = damageIn(s);
    // (Damage to itself, more of what it takes: nothing it can play.)
    for ( const m of s.matchAll(/@Damage\[/gi) ) if ( firstMatch(effectsSaying(reading, "selfHarm"), norm(s.slice(0, m.index))) ) return null;
    for ( const p of damage ) (p.type === "healing" ? (out.heal ??= []) : harmDamage).push(p);
    if ( damage.some(p => p.type !== "healing") ) harmSave ??= saveOf(s);
    // Conditions: on whoever set it off, named before them in the sentence; on itself, a help to itself or nothing; on
    // nobody it names, nothing.
    for ( const { cond, upTo } of conditionsWithContext(s, conditionOf) ) {
      const lead = norm(upTo);
      if ( firstMatch(effectsSaying(reading, "notLaid"), lead) ) continue;
      if ( foeBefore(lead) ) {
        foeConds.push(cond);
        foeText += ` ${s}`;
        condSave ??= saveOf(s);
        if ( firstMatch(effectsSaying(reading, "onFail"), n) ) onFail = true;
      } else if ( selfBefore(lead) && ON_SELF[cond.slug] ) Object.assign(selfConds, ON_SELF[cond.slug]);
    }
    uuids.push(...linkedEffects(s, effectOf));
  }
  // Its harm: at whoever set it off, or at everyone around it.
  if ( harmDamage.length ) {
    const save = harmSave;
    const harm = { damage: harmDamage, ...(save ? { save: { type: save.type, dc: save.dc, basic: save.basic } } : {}) };
    if ( around ) out.areaBurst = { ...harm, range: around };
    else out.harm = harm;
  }
  // What it lays: by degree, where its degrees say; else what a failed save (or nothing) lays.
  if ( degrees.some(Boolean) ) {
    const save = saveOf(html);
    if ( !save || around ) return null;
    const onSave = degrees.map(d => {
      if ( !d ) return null;
      const outcome = foeOutcome(linkedConditions(d, conditionOf), d);
      const damage = damageIn(d).filter(p => p.type !== "healing");
      if ( !outcome && !damage.length ) return null;
      return { ...(outcome ?? { rounds: 1, label: "" }), ...(damage.length ? { damage } : {}) };
    });
    // (A degree it leaves unsaid, a critical failure: as a failure.)
    if ( !onSave[0] && onSave[1] && !degrees[0] ) onSave[0] = onSave[1];
    if ( onSave.some(Boolean) ) out.afflict = { save: { type: save.type, dc: save.dc }, onSave };
  } else if ( foeConds.length && !around ) {
    // (The same condition linked twice: the higher, a critical failure's.)
    const bySlug = new Map();
    for ( const c of foeConds ) (bySlug.get(c.slug) ?? bySlug.set(c.slug, []).get(c.slug)).push(c.value);
    const twice = [...bySlug.values()].some(v => v.length > 1);
    const fail = foeOutcome([...bySlug].map(([slug, v]) => ({ slug, value: v[0] })), foeText);
    const worst = twice ? foeOutcome([...bySlug].map(([slug, v]) => ({ slug, value: Math.max(...v) })), foeText) : fail;
    if ( fail ) {
      // (Its own save; else, a failure of its harm's save; else it simply lands.)
      if ( condSave && !(harmSave && condSave.type === harmSave.type && condSave.dc === harmSave.dc) ) out.afflict = { save: { type: condSave.type, dc: condSave.dc }, onSave: [worst, fail, null, null] };
      else if ( harmSave && (onFail || condSave) ) out.afflict = { onSave: [worst, fail, null, null] };
      else out.afflict = { outcome: fail };
    }
  }
  // An effect it links: a buff on itself, or (all it does hinder) one on the foe where nothing else is laid on it.
  for ( const { uuid, effect } of uuids ) {
    const read = effectOutcome(effect, { level });
    if ( !read ) continue;
    if ( read.helps && !out.boost ) {
      out.boost = read.outcome;
      (out.effectRef ??= { uuids: [] }).uuids.push(uuid);
    } else if ( !read.helps && !out.afflict ) {
      out.afflict = { outcome: read.outcome };
      (out.effectRef ??= { uuids: [] }).uuids.push(uuid);
    }
  }
  if ( Object.keys(selfConds).length ) {
    const rounds = durationRounds(plain(html)) ?? 1;
    out.boost = { ...(out.boost ?? {}), conditions: { ...(out.boost?.conditions ?? {}), ...selfConds }, rounds: out.boost?.rounds ?? rounds,
      label: out.boost?.label ?? conditionsLabel(selfConds) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A reaction (or triggered free action) as the core's: its moment and filters from the Trigger, what it does from the
 * Effect, what it costs; null where either can't be read whole, or it needs something first (Requirements).
 * @param {object} d
 * @param {string} d.id          the action id (the actor's id and the item's: action-roll.js finds its card by it)
 * @param {string} d.label
 * @param {string} d.html        its description, @Damage and @Check worked out, its links kept
 * @param {string} d.actionType  "reaction" or "free"
 * @param {object} [d.frequency] PF2e's {max, per}
 * @param {string[]} [d.traits]  its traits (immunity)
 * @param {object} o             readEffects' options (reading, name, kinds, level, strikes, actions, conditionOf, effectOf)
 */
export function readReaction({ id, label, html, actionType, frequency = null, traits = [] }, o = {}) {
  if ( actionType !== "reaction" && actionType !== "free" ) return null;
  const text = String(html ?? "");
  if ( /<strong>\s*Requirements?\s*<\/strong>/i.test(text) ) return null;
  const when = readTrigger(triggerText(text), o);
  if ( !when ) return null;
  const effects = readEffects(effectPart(text), { ...o, trigger: when.trigger });
  if ( !effects ) return null;
  const r = { id, label, on: when.trigger, ...effects };
  if ( actionType === "free" ) r.free = true;
  if ( traits.length ) r.traits = [...traits];
  if ( r.afflict && traits.length ) r.afflict.traits = [...traits];
  if ( when.crit ) r.crit = true;
  if ( when.melee ) r.melee = true;
  if ( when.ranged ) r.ranged = true;
  if ( when.range ) r.range = when.range;
  if ( when.types ) {
    const types = when.types.split(/,?\s+or\s+|,\s*/).map(w => w.trim()).filter(Boolean);
    if ( !types.every(t => DAMAGE_TYPES.has(t)) ) return null;
    if ( types.includes("physical") ) r.physical = true;
    const rest = types.filter(t => t !== "physical");
    if ( rest.length ) r.damageTypes = [...rest, ...(r.physical ? ["bludgeoning", "piercing", "slashing"] : [])];
  }
  if ( when.strike ) {
    const ids = strikesNamed(when.strike, o.strikes ?? []);
    if ( !ids.length ) return null;
    r.actions = ids;
  }
  // (Its effects that need someone to land on: on its own blow, the one it hit; a strike on a slain creature's way down
  // or at a caster, the one who set it off, as the core plays them.)
  const often = Number(frequency?.max);
  if ( cooldownIn(text) ) r.uses = 1;
  else if ( often > 0 ) r.uses = often;
  return r;
}

/**
 * Draconic Momentum (by slug: a passive, no Trigger line): its critical hit with a Strike readies its breath weapon
 * again (ownHit, crit, free, recharge). Which action: the one its text names, among its own; else those that recharge
 * (a cooldown) whose slug says breath; else every one that recharges.
 * @param {object} d   {id, label, html, actions: its own [{id, name, slug, cooldown}], strikes: [{id}], reading}
 */
export function momentumReaction({ id, label, html, actions = [], strikes = [], reading = {}, name = "", kinds = [] }) {
  const words = selfWords(reading);
  const n = normalizeLine(plain(html), { name, kinds, words });
  const said = firstMatch(effectsSaying(reading, "recharge"), n);
  const cooling = actions.filter(a => a.cooldown || a.recharge);
  let ids = said ? actionsNamed(said.groups.action, cooling) : [];
  if ( !ids.length ) ids = cooling.filter(a => /(?:^|-)breath(?:-|$)/.test(String(a.slug ?? ""))).map(a => a.id);
  if ( !ids.length ) ids = cooling.map(a => a.id);
  if ( !ids.length ) return null;
  return { id, label, on: "ownHit", crit: true, free: true, passive: true, recharge: ids, ...(strikes.length ? { actions: strikes.map(s => s.id) } : {}) };
}
