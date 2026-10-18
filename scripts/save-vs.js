/**
 * Situational saves from PF2e's own rule elements (the core's spec.saveVs: its behavior/save-vs.js): a FlatModifier on
 * saves (selector saving-throw, fortitude, reflex or will) whose predicate looks only at what's being saved against.
 * PF2e leaves such a bonus out of the sheet's save total (its predicate fails without an effect to save against), so it
 * comes here, and nothing the sheet's total already holds does (a rule with no predicate, or one about anything else:
 * a stance, a toggle, its hit points). The monsters' "+1 status to all saves vs. magic" is the commonest.
 *
 * A predicate's statements, as the core's tags of the effect saved against:
 *   item:trait:<t>, origin:action:trait:<t>, and a bare trait PF2e knows   <t> (a tradition: arcane, divine ...)
 *   item:magical                                                            magical (a spell, or a magical item's)
 *   item:type:spell                                                         spell
 *   inflicts:<condition>                                                    inflicts:<the engine's key>
 *   area-effect, area-damage                                                area
 *   damaging-effect                                                         damaging
 *   origin:trait:<t>                                                        `from`: whoever set it off has trait <t>
 * A plain statement must hold (`all`; one about who set it off, `from`); {or: [...]}, one of them (`vs`; ones it
 * can't read left out, which only makes it count less often); {not: x} and {nor: [...]}, none (`not`); {and: [...]},
 * all. Anything else (two or-groups, a comparison, a statement it can't read that must hold): the rule is left out.
 * Pure, unit-tested.
 */
import { ruleValue } from "./effects.js";
import { engineKey } from "./commit.js";

/** PF2e's save selectors, by the engine's save keys (saving-throw: every save). */
const SAVES = Object.freeze({ "saving-throw": "all", fortitude: "fortitude", reflex: "reflex", will: "will" });

/** PF2e's kinds of bonus, as the core stacks them (anything else adds up, untyped). */
const KINDS = new Set(["status", "circumstance", "item"]);

/** Item types whose rules are always on (not gear, which must be worn or invested; not a spell, which is cast). */
const ALWAYS_ON = new Set(["action", "feat", "effect", "heritage", "ancestry", "background", "class"]);

/**
 * One predicate statement about the effect saved against: {tag} (the core's tag), {from} (a creature trait of whoever
 * set it off), or null (not about the effect, or not one it reads). `traits`: the trait ids PF2e knows, for a bare one.
 */
export function tagOf(statement, traits = new Set()) {
  if ( typeof statement !== "string" ) return null;
  let m;
  if ( (m = /^(?:item|origin:action):trait:([a-z0-9-]+)$/.exec(statement)) ) return { tag: m[1] };
  if ( statement === "item:magical" ) return { tag: "magical" };
  if ( statement === "item:type:spell" ) return { tag: "spell" };
  if ( (m = /^origin:trait:([a-z0-9-]+)$/.exec(statement)) ) return { from: m[1] };
  if ( (m = /^inflicts:([a-z0-9-]+)$/.exec(statement)) ) return { tag: `inflicts:${engineKey(m[1])}` };
  if ( statement === "area-effect" || statement === "area-damage" ) return { tag: "area" };
  if ( statement === "damaging-effect" ) return { tag: "damaging" };
  if ( traits.has(statement) ) return { tag: statement };
  return null;
}

/** A predicate as {vs, all, not, from}, or null where it isn't only about the effect saved against (tagOf). */
export function predicateTags(predicate, traits = new Set()) {
  if ( !Array.isArray(predicate) || !predicate.length ) return null;
  const out = { vs: [], all: [], not: [], from: [] };
  let grouped = false;
  const must = statement => {
    const t = tagOf(statement, traits);
    if ( !t ) return false;
    if ( t.from ) out.from.push(t.from);
    else out.all.push(t.tag);
    return true;
  };
  const never = statement => {
    const t = tagOf(statement, traits);
    if ( !t?.tag ) return false;
    out.not.push(t.tag);
    return true;
  };
  for ( const s of predicate ) {
    if ( typeof s === "string" ) {
      if ( !must(s) ) return null;
    } else if ( Array.isArray(s?.or) ) {
      if ( grouped ) return null;
      grouped = true;
      out.vs.push(...s.or.map(x => tagOf(x, traits)?.tag).filter(Boolean));
      if ( !out.vs.length ) return null;
    } else if ( Array.isArray(s?.and) ) {
      if ( !s.and.every(must) ) return null;
    } else if ( s && typeof s === "object" && "not" in s ) {
      if ( !never(s.not) ) return null;
    } else if ( Array.isArray(s?.nor) ) {
      if ( !s.nor.every(never) ) return null;
    } else return null;
  }
  // (Only who set it off, or only what it isn't: not about the effect enough. Several origins: not one entry.)
  if ( (!out.vs.length && !out.all.length && !out.from.length) || out.from.length > 1 ) return null;
  return out;
}

/**
 * One rule element as an entry of spec.saveVs, or null: a FlatModifier on saves, with a predicate only about the
 * effect saved against, worth something. `actor`: {level, abilities} for a formula's numbers.
 */
export function saveVsOf(rule, { traits = new Set(), actor = null } = {}) {
  if ( rule?.key !== "FlatModifier" || rule.ignored ) return null;
  const saves = [...new Set([].concat(rule.selector ?? []).map(s => SAVES[s]).filter(Boolean))];
  if ( !saves.length ) return null;
  const tags = predicateTags(rule.predicate, traits);
  if ( !tags ) return null;
  const bonus = ruleValue(rule.value, { actor });
  if ( !Number.isFinite(bonus) || !bonus ) return null;
  const out = { bonus, type: KINDS.has(rule.type) ? rule.type : "untyped" };
  if ( !saves.includes("all") ) out.saves = saves;
  for ( const k of ["vs", "all", "not", "from"] ) if ( tags[k].length ) out[k] = [...new Set(tags[k])];
  return out;
}

/**
 * A creature's situational saves (spec.saveVs) from its items' rule elements: its abilities, feats and effects (not
 * gear, whose rules hold only worn or invested, nor spells), each the same rule only once. Undefined with none.
 * @param {object[]} items   its items ({type, system: {rules}})
 * @param {object} [d]
 * @param {Set<string>} [d.traits]  the trait ids PF2e knows (CONFIG.PF2E's), for a bare trait in a predicate
 * @param {object} [d.actor]        {level, abilities}, for a formula's numbers
 */
export function saveVsFrom(items, { traits = new Set(), actor = null } = {}) {
  const out = [];
  const seen = new Set();
  for ( const item of items ?? [] ) {
    if ( !ALWAYS_ON.has(item?.type) ) continue;
    for ( const rule of item.system?.rules ?? [] ) {
      const entry = saveVsOf(rule, { traits, actor });
      if ( !entry ) continue;
      const key = JSON.stringify(entry);
      if ( seen.has(key) ) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out.length ? out : undefined;
}
