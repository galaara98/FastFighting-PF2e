/**
 * Reading PF2e spell effects into the engine's buffs and debuffs. Pure, unit-tested: no Foundry globals.
 *
 * A PF2e buff or debuff spell links its "Spell Effect" item, whose rule elements carry the numbers: FlatModifier
 * (Bless: +1 status to attacks; Bane: -1; Heroism: +1 to attacks, saves and skills, more when heightened), TempHP.
 * An action that puts an effect on its user (Rage) reads the same way, with the actor's own numbers (its level, its
 * ability modifiers) and the few conditions a fight can tell (this effect is on; a melee Strike). What the engine
 * can't play out (a rule that only applies sometimes, an item alteration) is left out.
 */

/** FlatModifier selectors -> engine bonuses. */
const SELECTORS = {
  "attack": ["attack"], "attack-roll": ["attack"], "strike-attack-roll": ["attack"], "spell-attack-roll": ["attack"],
  "ac": ["ac"],
  "saving-throw": ["saves"],
  "damage": ["damage"], "strike-damage": ["damage"],
  "skill-check": ["checks"],
  "speed": ["speed"], "all-speeds": ["speed"], "land-speed": ["speed"]
};

/**
 * The value of a rule's number: a plain number, or a formula PF2e heightens with ("ternary(gte(@item.level,9),3,
 * ternary(gte(@item.level,6),2,1))"), worked out by a small evaluator (no eval) with @item.level as the spell's rank.
 * Returns null for anything it doesn't understand.
 */
export function ruleValue(raw, { rank = 1, actor = null, flags = {} } = {}) {
  if ( typeof raw === "number" ) return raw;
  if ( typeof raw !== "string" ) return null;
  // The actor's own numbers: @actor.level, @actor.abilities.con.mod, and flags set by the effect's other rules.
  const src = raw.replace(/@item\.(?:level|rank)/g, String(rank))
    .replace(/@actor\.level/g, String(actor?.level ?? 0))
    .replace(/@actor\.abilities\.(\w+)\.mod/g, (m, k) => String(actor?.abilities?.[k]?.mod ?? 0))
    .replace(/@actor\.flags\.system\.([\w.]+)/g, (m, k) => String(flags[k] ?? 0))
    .replace(/\s+/g, "");
  let i = 0;
  const fail = () => { throw new Error("unreadable"); };
  const FUNCS = {
    ternary: (a, b, c) => (a ? b : c), gte: (a, b) => a >= b, gt: (a, b) => a > b, lte: (a, b) => a <= b, lt: (a, b) => a < b,
    eq: (a, b) => a === b, max: Math.max, min: Math.min, floor: Math.floor, ceil: Math.ceil
  };
  const number = () => {
    const m = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
    if ( !m ) fail();
    i += m[0].length;
    return Number(m[0]);
  };
  const call = () => {
    const m = /^[a-z]+/i.exec(src.slice(i));
    if ( !m ) return number();
    const fn = FUNCS[m[0]];
    if ( !fn ) fail();
    i += m[0].length;
    if ( src[i++] !== "(" ) fail();
    const args = [];
    while ( src[i] !== ")" ) {
      args.push(sum());
      if ( src[i] === "," ) i += 1;
      else if ( src[i] !== ")" ) fail();
    }
    i += 1;
    return fn(...args);
  };
  const term = () => {
    let v = call();
    while ( src[i] === "*" || src[i] === "/" ) {
      const op = src[i++];
      const r = call();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = () => {
    let v = term();
    while ( src[i] === "+" || (src[i] === "-" && i > 0) ) {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(Number(v)) ? Number(v) : null;
  } catch ( err ) {
    return null;
  }
}

/**
 * Does a PF2e predicate hold, given the roll options known to be true? Strings must be among them; {not}, {or},
 * {and} and {nor} combine. Anything it can't tell counts as not true.
 */
export function predicateHolds(predicate, options) {
  const test = term => {
    if ( typeof term === "string" ) return options.has(term);
    if ( !term || typeof term !== "object" ) return false;
    if ( "not" in term ) return !test(term.not);
    if ( Array.isArray(term.or) ) return term.or.some(test);
    if ( Array.isArray(term.and) ) return term.and.every(test);
    if ( Array.isArray(term.nor) ) return !term.nor.some(test);
    return false;
  };
  return [].concat(predicate ?? []).every(test);
}

/**
 * Rule elements as engine bonuses and penalties (and temporary hit points).
 * @param {object[]} rules
 * @param {object} [o]
 * @param {number} [o.rank]       the spell's rank (or the item's level)
 * @param {object} [o.actor]      {level, abilities: {con: {mod}}} for formulas that use them
 * @param {Set<string>} [o.options]  roll options known to hold: with them, rules whose predicates hold count too
 *                                (without, any rule with a predicate is left out)
 * @param {string} [o.only]       only rules whose predicate names this (an action's own rules for while its effect is on)
 */
export function modsFromRules(rules, { rank = 1, actor = null, options = null, only = null } = {}) {
  const mods = {};
  let tempHp = 0;
  const flags = {};
  for ( const r of rules ?? [] ) {
    if ( !r ) continue;
    if ( only && !JSON.stringify(r.predicate ?? []).includes(only) ) continue;
    if ( r.predicate?.length && !(options && predicateHolds(r.predicate, options)) ) continue; // only sometimes: left out
    // Numbers an effect keeps for its other rules (Rage's temporary hit points).
    if ( r.key === "ActiveEffectLike" && /^flags\.system\./.test(r.path ?? "") ) {
      const key = r.path.slice("flags.system.".length);
      const v = ruleValue(r.value, { rank, actor, flags });
      if ( Number.isFinite(v) ) flags[key] = r.mode === "upgrade" ? Math.max(flags[key] ?? -Infinity, v) : r.mode === "add" ? (flags[key] ?? 0) + v : v;
      continue;
    }
    if ( r.key === "FlatModifier" ) {
      const value = ruleValue(r.value, { rank, actor, flags });
      if ( !value ) continue;
      for ( const selector of [].concat(r.selector ?? []) ) {
        for ( const key of SELECTORS[selector] ?? [] ) {
          // Bonuses of a kind don't stack: keep the larger of each sign.
          const prev = mods[key] ?? 0;
          mods[key] = value > 0 ? Math.max(prev > 0 ? prev : 0, value) + (prev < 0 ? prev : 0) : Math.min(prev < 0 ? prev : 0, value) + (prev > 0 ? prev : 0);
        }
      }
    } else if ( r.key === "RollTwice" && /attack/.test([].concat(r.selector ?? []).join(" ")) && r.keep !== "lower" ) {
      mods.adv = 1; // Sure Strike: roll the attack twice, keep the better
    } else if ( r.key === "TempHP" ) {
      tempHp = Math.max(tempHp, ruleValue(r.value, { rank, actor, flags }) ?? 0);
    }
  }
  return { mods, tempHp };
}

/** Rounds an effect item lasts ({value, unit}), or null when it doesn't say (unlimited, or until the encounter ends). */
export function effectRounds(duration) {
  const v = Number(duration?.value);
  if ( !(v > 0) ) return null;
  return v * ({ rounds: 1, minutes: 10, hours: 600, days: 14400 }[duration.unit] ?? 1);
}

/** Rounds from a PF2e duration ("1 minute" = 10, "10 minutes" = 100, "1 round", "until the start of your next turn"). */
export function spellRounds(duration) {
  const t = String(duration ?? "").toLowerCase();
  if ( /until the (?:start|end) of (?:your|its|the target's) (?:next )?turn/.test(t) ) return 1;
  const m = /(\d+)\s*(rounds?|minutes?|hours?)/.exec(t);
  if ( !m ) return null;
  return Number(m[1]) * ({ round: 1, rounds: 1, minute: 10, minutes: 10, hour: 600, hours: 600 }[m[2]] ?? 1);
}

/** Who a spell reaches: "self", an aura of friends (feet), or one creature. */
export function spellReach({ area, target, range }) {
  const t = String(target ?? "").toLowerCase();
  const r = String(range ?? "").toLowerCase();
  if ( area?.type === "emanation" && (!t || /\ballies\b|\byou and\b/.test(t)) ) return { aura: Number(area.value) || 15 };
  if ( !t && !r && !area ) return { targets: "self" };
  if ( /touch/.test(r) ) return { reach: 5 };
  const feet = /(\d+)\s*(?:feet|ft)/.exec(r);
  return feet ? { range: { increment: Number(feet[1]), max: Number(feet[1]), noPenalty: true } } : { reach: 5 };
}

/** Does this help whoever has it (a buff) or hurt them (a debuff)? */
export function helps(mods = {}) {
  return Object.values(mods).reduce((s, v) => s + Math.sign(Number(v) || 0), 0) > 0;
}
