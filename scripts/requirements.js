/**
 * An ability's Requirements line, as the core's action.requires (its engine/behavior/requires.js): what the creature
 * must have set up before it can use the ability. Read by the patterns in reading/en.json's "requirements" section
 * (reading.js), each matching a whole line:
 *  - "line": finds the line in the ability's text (its `line` group);
 *  - "holding": the creature has a foe grabbed or restrained, and the ability is for that foe (Blood Drain);
 *  - "lastHit": its last action was a Strike that hit (the `strike` group names it: one of its own Strikes, by name or
 *    slug), the ability for the foe it hit (Wicked Bite);
 *  - "target": the target has one of the conditions its `conditions` group lists (each word the core's condition key,
 *    or a "word" entry's) or the entry's own `is` list (Drink Blood);
 *  - "self": the creature itself is in one of the entry's `is` conditions (hidden);
 *  - "shieldRaised": its shield is raised;
 *  - "word": a condition word that isn't the core's, and the core's key for it (`word`, `is`: dying is unconscious);
 *  - "rolled": what it does is rolled for (a Strike it makes), so its damage isn't simply dealt (rollsItself).
 * A line none of them matches can't be expressed, and the ability isn't used (abilities.js refuses it). With no reading
 * at all (the words not read yet), any line in bold as the system writes it counts as one that can't be.
 * Pure, unit-tested.
 */
import { coreKeyFor } from "./core.js";
import { currentReading } from "./reading.js";
import { plain } from "./control.js";
import { READ_MOST } from "./trigger-lines.js";

/** Before any reading is loaded: the system's own bold label, so a requirement is never mistaken for none. */
const UNREAD_LINE = /<strong>\s*Requirements?\s*<\/strong>/i;

/** A reading file's requirement entries (none before it's read). */
const entriesOf = words => (Array.isArray(words?.requirements) ? words.requirements : []);

/** One entry's pattern, compiled (case-insensitive), or null for one that doesn't compile. */
const compiled = new Map();
function patternOf(entry) {
  const source = typeof entry?.pattern === "string" ? entry.pattern : null;
  if ( !source ) return null;
  if ( !compiled.has(source) ) {
    try {
      compiled.set(source, new RegExp(source, "i"));
    } catch ( err ) {
      compiled.set(source, null);
    }
  }
  return compiled.get(source);
}

/** A slug as PF2e makes one from a name ("Tail Claw": "tail-claw"). */
const slugify = s => String(s ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** The line of its text a requirement is on: {line (plain, lower case), html (the part to leave out)}, or null. */
export function requirementLine(html, words = currentReading()) {
  const text = String(html ?? "").slice(0, READ_MOST.text);
  for ( const entry of entriesOf(words) ) {
    if ( entry.means !== "line" ) continue;
    const m = patternOf(entry)?.exec(text);
    if ( !m ) continue;
    const raw = m.groups?.line ?? m[1] ?? "";
    return { line: plain(raw).toLowerCase().replace(/[\s.;:]+$/, "").trim(), html: m[0] };
  }
  return null;
}

/** Its text without its requirement (so what the ability does is read from what's left). */
export function withoutRequirement(html, words = currentReading()) {
  const found = requirementLine(html, words);
  return found ? String(html ?? "").replace(found.html, "") : String(html ?? "");
}

/** The core's key for a condition word: a "word" entry's, else the core's own (coreKeyFor: its synonyms too). */
function conditionKey(word, words) {
  const w = String(word ?? "").toLowerCase();
  const own = entriesOf(words).find(e => e.means === "word" && String(e.word ?? "").toLowerCase() === w);
  return own?.is ?? coreKeyFor(w);
}

/** The conditions a group lists ("grabbed, paralyzed, or unconscious"): the core's keys, each once; none: null. */
function conditionsIn(group, words) {
  const keys = String(group ?? "").split(/[^\p{L}-]+/u).filter(Boolean).map(w => conditionKey(w, words)).filter(Boolean);
  return keys.length ? [...new Set(keys)] : null;
}

/** Does each word of a name begin a word of a Strike's, or the other way (claw: Iron Claws; jaws: Spectral Jaws)? */
function wordsMatch(key, wanted) {
  const have = key.split("-");
  return wanted.split("-").every(w => have.some(h => (h.length >= 3 && w.length >= 3 && (h.startsWith(w) || w.startsWith(h))) || h === w));
}

/**
 * Its Strikes a name means ("jaws", "tail claw"): the ones of that name or slug (spaced or not: battleaxe, Battle Axe),
 * else the ones whose words it names, each word the start of one of theirs or theirs of it (claw: Iron Claws). Their
 * ids; none: null.
 * @param {{id: string, name?: string, slug?: string}[]} strikes
 */
export function strikesNamed(strikes, name) {
  const wanted = slugify(name);
  if ( !wanted ) return null;
  const keys = s => [slugify(s.slug), slugify(s.name), slugify(s.english)].filter(Boolean);
  const bare = k => k.replace(/-/g, "");
  let found = strikes.filter(s => keys(s).some(k => k === wanted || bare(k) === bare(wanted)));
  if ( !found.length ) found = strikes.filter(s => keys(s).some(k => wordsMatch(k, wanted)));
  return found.length ? found.map(s => s.id) : null;
}

/**
 * What a Requirements line needs, as the core's action.requires, or null where none of the reading's patterns says.
 * @param {string} line            the line, plain and lower case (requirementLine)
 * @param {object} [d]
 * @param {object[]} [d.strikes]   its Strikes ({id, name, slug}), for a line that names one
 * @param {object} [d.words]       the reading (reading.js)
 */
export function readRequirement(line, { strikes = [], words = currentReading() } = {}) {
  const text = String(line ?? "").trim();
  // (Longer than any real one: not read, so not expressed.)
  if ( !text || text.length > READ_MOST.line ) return null;
  for ( const entry of entriesOf(words) ) {
    if ( entry.means === "line" || entry.means === "word" ) continue;
    const m = patternOf(entry)?.exec(text);
    if ( !m ) continue;
    const g = m.groups ?? {};
    switch ( entry.means ) {
      case "holding": return { holding: true };
      case "lastHit": {
        if ( !g.strike ) return { lastHit: true };
        const ids = strikesNamed(strikes, g.strike);
        return ids ? { lastHit: { with: ids } } : null;
      }
      case "target": {
        const keys = Array.isArray(entry.is) ? entry.is : conditionsIn(g.conditions, words);
        return keys?.length ? { target: keys } : null;
      }
      case "self": return Array.isArray(entry.is) && entry.is.length ? { self: entry.is } : null;
      case "shieldRaised": return { shieldRaised: true };
      default: return null;
    }
  }
  return null;
}

/**
 * Does what an ability does roll for itself (a Strike it makes, "This Strike has a +30 attack modifier"): reading/en.json's
 * "rolled" entries, over its text plain and lower case. Then its damage isn't simply dealt.
 */
export function rollsItself(html, words = currentReading()) {
  const text = plain(html).toLowerCase().slice(0, READ_MOST.text);
  return entriesOf(words).some(e => e.means === "rolled" && patternOf(e)?.test(text));
}

/**
 * What an ability needs first, from its text: undefined when it has no Requirements line, null when it has one the
 * reading can't express (so it isn't used), else the core's action.requires.
 */
export function requirementOf(html, { strikes = [], words = currentReading() } = {}) {
  if ( !entriesOf(words).some(e => e.means === "line") ) return UNREAD_LINE.test(String(html ?? "")) ? null : undefined;
  const found = requirementLine(html, words);
  if ( !found ) return undefined;
  return readRequirement(found.line, { strikes, words });
}
