/**
 * A stand-in for Foundry's game.i18n, for the tests. It holds no words: it reads this module's languages/en.json and
 * FastFighting Core's (the core checked out beside this one, see vitest.config.js), so the tests read what a GM would.
 *
 * `npm run test:reworded` runs every test with all those words reworded (accented, in ⟦brackets⟧, {placeholders} and
 * markup kept). The tests pass whatever the wording, so any string can be rewritten without touching them.
 */
import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import { fillIn } from "../../fast-fighting/scripts/core-api.js";

const ACCENT = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
/** A string reworded (with FASTFIGHTING_REWORD set; as it is otherwise). An empty one stays empty. */
export const reword = s => (!process.env.FASTFIGHTING_REWORD || s === "" ? s
  : `⟦${String(s).split(/(\{[^}]+\}|<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(/[aeiouAEIOU]/g, c => ACCENT[c]))).join("")}⟧`);

/** A nested language file as flat keys ("FASTFIGHTING.Words.List"), its words reworded when asked. */
export function flatten(o, prefix = "", out = {}) {
  for ( const [k, v] of Object.entries(o) ) {
    if ( v && typeof v === "object" ) flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = typeof v === "string" ? reword(v) : v;
  }
  return out;
}

const readJson = url => JSON.parse(readFileSync(url, "utf8"));

/** This module's languages/en.json, flat. */
export const own = flatten(readJson(new URL("../languages/en.json", import.meta.url)));
/** FastFighting Core's languages/en.json, flat (FASTFIGHTING_CORE: the core's scripts folder, from vitest.config.js). */
const coreScripts = process.env.FASTFIGHTING_CORE;
export const core = flatten(readJson(new URL("../languages/en.json", pathToFileURL(/[\\/]$/.test(coreScripts) ? coreScripts : `${coreScripts}/`))));
/** Both. */
export const en = { ...core, ...own };

/** The text the language files have for a key (failing loudly when they have none). */
export function text(key, data = null) {
  if ( !(key in en) ) throw new Error(`no words for ${key}`);
  return fillIn(en[key], data);
}

/** game.i18n as Foundry sets it up in English, from the language files. */
export function fakeI18n() {
  return {
    lang: "en",
    has: key => key in en,
    localize: key => en[key] ?? key,
    format: (key, data) => fillIn(en[key] ?? key, data)
  };
}
