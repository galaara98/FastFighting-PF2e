/**
 * The words this helper reads PF2e's own text by, where an item's structured data says nothing (a reaction's Trigger
 * line, an ability's Requirements): reading/en.json always, and the reader's language's reading/<lang>.json tried first
 * when there is one (a creature's text may be in either, as it was imported). Like the core's keywords, a translation
 * is a copy of the file, nothing else. Loaded once, at startup; whatever reads an actor waits for it.
 *
 * Each file is an object of sections ({"triggers": [...], "requirements": [...]}); a section is whatever its reader
 * takes. Merged: a list, the reader's language's entries first, then the English ones; an object, the English with the
 * reader's language's on top. A section a file lacks is simply the other file's.
 */
import { language } from "./core.js";

const MODULE_ID = "fast-fighting-pf2e";

let loaded = mergeReading();
let loading = null;

/** One reading file and another (the reader's language's first), merged section by section. */
export function mergeReading(english = null, local = null) {
  const out = {};
  for ( const key of new Set([...Object.keys(english ?? {}), ...Object.keys(local ?? {})]) ) {
    const en = english?.[key];
    const own = local?.[key];
    if ( key.startsWith("$") ) continue;
    if ( Array.isArray(en) || Array.isArray(own) ) out[key] = [...(Array.isArray(own) ? own : []), ...(Array.isArray(en) ? en : [])];
    else if ( (en && typeof en === "object") || (own && typeof own === "object") ) out[key] = { ...(en ?? {}), ...(own ?? {}) };
    else out[key] = own ?? en;
  }
  return out;
}

/** A reading file from this module's reading/ folder, or nothing if there isn't one. */
async function fetchFile(lang) {
  try {
    const response = await fetch(`modules/${MODULE_ID}/reading/${lang}.json`);
    return response.ok ? await response.json() : null;
  } catch ( err ) {
    return null;
  }
}

/** Read the files (once; called at startup, and by whatever needs them first). */
export function loadReading() {
  loading ??= (async () => {
    const lang = language();
    const english = await fetchFile("en");
    if ( !english ) console.warn(`${MODULE_ID} | reading/en.json could not be read`);
    loaded = mergeReading(english, lang && lang !== "en" ? await fetchFile(lang) : null);
    return loaded;
  })();
  return loading;
}

/** The reading words, once they're read. */
export const reading = () => loadReading();

/** The reading words as they are now (none, before they're read). */
export const currentReading = () => loaded;

/** For tests: the words to read by, as given (a file's contents, or a merge). */
export function setReading(words) {
  loaded = mergeReading(words);
  loading = Promise.resolve(loaded);
}
