/**
 * A reaction's Trigger line, read by the grammar in reading/en.json ("triggers", and the creature-as-"you" words in
 * "self"): the helper's reactions-read.js builds reactions by it, and the coverage scan (tools/coverage-triggers.mjs)
 * files every PF2e trigger by it, one grammar for both.
 *
 * The line is made plain and lower case, the creature's own name (or "the dragon", "the monster") read as "you", so
 * "the dragon is critically hit" reads "you is critically hit". Each entry in "triggers": {name, trigger, pattern}
 * (a regular expression over that line, case-insensitive), in the order they're tried, the first that matches filing
 * it; later matches are its other triggers. An entry marked `whole` matches a whole line and says all it means: only
 * those build reactions. Its filters: `crit`, `melee`, `ranged`, `range` (feet), as fields, or as the pattern's named
 * groups that matched (crit, melee, ranged, range: the feet, adjacent: 5 feet, reach: in its reach, so melee, strike:
 * the name of one of its own strikes, types: damage types; a name may end in a number, for its second place: crit2).
 * `alsoOn`: the other moments it answers (a foe moving in its reach, or out of it).
 * Pure: no Foundry globals, no imports (the coverage scan loads it outside Foundry).
 */

/**
 * The most of PF2e's text the reading's patterns run on: an item's text is anyone's to write (a player's own items too),
 * and the GM's browser reads every actor's. A Trigger or a Requirements line (`line`), longer, isn't read; nor an
 * Effect's sentence (`sentence`), and the reaction isn't built; a text read whole (`text`: an aura's words, a
 * multiattack's, what an ability rolls) only so far. Real lines are under 300 characters, sentences under 700.
 */
export const READ_MOST = Object.freeze({ line: 300, sentence: 1000, text: 4000 });

/** Defaults for the "self" words, should a reading file have none. */
const SELF = Object.freeze({
  you: "you", your: "your", articles: [], definite: [], plain: [], stock: [], possessive: "'s", replace: []
});

const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A reading file's "self" words, filled in. */
export const selfWords = reading => ({ ...SELF, ...(reading?.self ?? {}) });

/**
 * A trigger's words ready for the grammar: plain text, lower case, its own creature's name (or kind) as "you".
 * @param {string} text        the line as plain text
 * @param {object} [o]
 * @param {string} [o.name]    the creature's name (none for a character's feat: "you" already)
 * @param {string[]} [o.kinds] its traits (dragon, devil ...), for "the dragon"
 * @param {object} [o.words]   the reading file's "self" words (selfWords)
 */
export function normalizeLine(text, { name = "", kinds = [], words = SELF } = {}) {
  const w = { ...SELF, ...words };
  const plain = new Set((w.plain ?? []).map(x => String(x).toLowerCase()));
  const articles = (w.articles ?? []).map(escape).join("|");
  const definite = (w.definite ?? []).map(escape).join("|");
  const before = articles ? `(?:\\b(?:${articles}) )?` : "";
  const after = definite ? `\\b(?:${definite}) (?:[\\w-]+ ){0,3}` : null;
  // (Not after an article, in either case: "the Taljjae" is a word of the creature's, not its name.)
  const notAfter = (w.articles ?? []).flatMap(a => [a, a.charAt(0).toUpperCase() + a.slice(1)]).map(escape).join("|");
  const poss = escape(w.possessive ?? "'s");
  let s = ` ${String(text ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()} `;
  const own = m => (new RegExp(`${poss}$`, "i").test(m) ? w.your : w.you);
  const full = String(name).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Its whole name ("a bog mummy", "Blue Viper's"), then a word of it after an article ("the dragon", "the goblin pyro's").
  if ( /\s/.test(full) ) s = s.replace(new RegExp(`${before}\\b${escape(full)}(?:${poss})?\\b`, "gi"), own);
  const nameWords = [...new Set([...String(name).toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^\p{L}'-]+/u), ...kinds.map(k => String(k).toLowerCase())])]
    .map(x => x.replace(new RegExp(`${poss}$`), "")).filter(x => x.length > 2 && !plain.has(x));
  if ( nameWords.length && after ) {
    const any = `(?:${nameWords.map(x => escape(x).replace(/-/g, "[- ]")).join("|")})`;
    s = s.replace(new RegExp(`${after}${any}(?:${poss})?\\b`, "gi"), own);
    // A named creature, by its own name, capitalized as names are ("Taljjae's turn begins").
    const first = full.split(/[\s,]+/)[0] ?? "";
    if ( /^\p{Lu}[\p{Ll}'-]{2,}$/u.test(first) && !plain.has(first.toLowerCase()) ) {
      s = s.replace(new RegExp(`${notAfter ? `(?<!\\b(?:${notAfter}) )` : ""}\\b${escape(first)}(?:${poss})?\\b`, "g"), own);
    }
  }
  for ( const phrase of w.stock ?? [] ) s = s.replace(new RegExp(`${escape(phrase)}(?:${poss})?`, "gi"), own);
  for ( const [from, to] of w.replace ?? [] ) s = s.replace(new RegExp(from, "gi"), to);
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The entries' expressions, compiled once (a bad one never matches). */
const compiled = new WeakMap();
function expr(entry) {
  if ( !compiled.has(entry) ) {
    let re = null;
    try {
      re = new RegExp(entry.pattern, "i");
    } catch ( err ) {
      re = null;
    }
    compiled.set(entry, re);
  }
  return compiled.get(entry);
}

/**
 * The master trigger a normalized line means: {trigger, pattern (the entry's name), also, entry, match}, `also` the other
 * triggers later entries find in it; null when nothing matches.
 * @param {string} norm        normalizeLine's
 * @param {object[]} entries   the reading file's "triggers"
 */
export function classifyLine(norm, entries = []) {
  const text = String(norm ?? "").replace(/[.;:,\s]+$/, "");
  if ( !text || text.length > READ_MOST.line ) return null;
  let first = null;
  const also = [];
  for ( const entry of entries ) {
    const re = entry?.pattern ? expr(entry) : null;
    const m = re?.exec(text);
    if ( !m ) continue;
    if ( !first ) first = { trigger: entry.trigger, pattern: entry.name ?? "", entry, match: m };
    else if ( entry.trigger !== first.trigger && !also.includes(entry.trigger) ) also.push(entry.trigger);
  }
  return first ? { ...first, also } : null;
}

/**
 * What a whole-line entry's match says: {trigger, crit, melee, ranged, range, strike, types}, from its fields and the
 * named groups that matched; null when the line's filing isn't a whole entry's.
 * @param {object|null} filed   classifyLine's
 */
export function wholeLine(filed) {
  if ( !filed?.entry?.whole ) return null;
  const e = filed.entry;
  // (A group's name may end in a number, its second place in one pattern: crit2 is crit.)
  const g = {};
  for ( const [k, v] of Object.entries(filed.match?.groups ?? {}) ) if ( typeof v === "string" && v.trim() ) g[k.replace(/\d+$/, "")] ??= v;
  const has = k => typeof g[k] === "string";
  const out = { trigger: e.trigger };
  if ( e.crit || has("crit") ) out.crit = true;
  if ( e.melee || has("melee") || has("reach") ) out.melee = true;
  if ( e.ranged || has("ranged") ) out.ranged = true;
  const range = Number(g.range) || (has("adjacent") ? 5 : Number(e.range) || 0);
  if ( range > 0 ) out.range = range;
  if ( has("strike") ) out.strike = g.strike.trim();
  if ( has("types") ) out.types = g.types.trim();
  if ( Array.isArray(e.alsoOn) && e.alsoOn.length ) out.alsoOn = [...e.alsoOn];
  if ( out.melee && out.ranged ) {
    delete out.melee;
    delete out.ranged;
  }
  return out;
}
