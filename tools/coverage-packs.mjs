/**
 * Reading PF2e's own compendiums for the coverage scan (tools/coverage.mjs). Developer tool, never in the module.
 *
 * The packs are LevelDB folders inside the system (packs/<name>). Foundry may have them open, so each is copied to a
 * temporary folder first (its LOCK file left behind) and opened there with Foundry's own classic-level; the copy is
 * deleted as soon as it's read. Nothing read here is written anywhere: the scan keeps it in memory.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where Windows installs keep things, for the defaults (each can be given instead: see coverage.mjs). */
const LOCAL = process.env.LOCALAPPDATA ?? "";
export const DEFAULT_PF2E = join(LOCAL, "FoundryVTT", "Data", "systems", "pf2e");
export const DEFAULT_FOUNDRY = join(LOCAL, "Programs", "FoundryVirtualTabletop", "Foundry Virtual Tabletop", "resources", "app");

/** Foundry's own classic-level (the LevelDB binding it reads packs with), from its app folder. */
export function classicLevel(foundryApp) {
  const require = createRequire(join(foundryApp, "package.json"));
  return require("classic-level").ClassicLevel;
}

/** The system's manifest (system.json): its version and its packs ({name, type, path}). */
export function systemManifest(pf2eDir) {
  return JSON.parse(readFileSync(join(pf2eDir, "system.json"), "utf8"));
}

/**
 * The system's language files, flat ("PF2E.NPC.Abilities.Glossary.Grab": its text), for the @Localize links a
 * creature's abilities make to the glossary. Read only to classify triggers; never written out.
 */
export function systemWords(pf2eDir) {
  const out = {};
  const flatten = (o, prefix) => {
    for ( const [k, v] of Object.entries(o ?? {}) ) {
      if ( v && typeof v === "object" ) flatten(v, `${prefix}${k}.`);
      else if ( typeof v === "string" ) out[`${prefix}${k}`] = v;
    }
  };
  const dir = join(pf2eDir, "lang");
  for ( const file of readdirSync(dir).filter(f => /^(?:en|.*-en)\.json$/.test(f)) ) {
    try {
      flatten(JSON.parse(readFileSync(join(dir, file), "utf8")), "");
    } catch ( err ) {
      console.warn(`coverage | could not read ${file}: ${err.message}`);
    }
  }
  return out;
}

/**
 * Every document in one pack, as {key, value} ("!actors!<id>", "!actors.items!<actor id>.<item id>", "!items!<id>" ...).
 * @param {string} pf2eDir
 * @param {string} path      the pack's folder, as system.json gives it ("packs/feats")
 * @param {Function} ClassicLevel
 */
export async function readPack(pf2eDir, path, ClassicLevel) {
  const source = join(pf2eDir, path);
  if ( !existsSync(source) ) return [];
  const temp = mkdtempSync(join(tmpdir(), "ff-pf2e-coverage-"));
  const copy = join(temp, "pack");
  mkdirSync(copy);
  try {
    for ( const file of readdirSync(source) ) if ( file !== "LOCK" ) copyFileSync(join(source, file), join(copy, file));
    const db = new ClassicLevel(copy, { valueEncoding: "json" });
    await db.open();
    const out = [];
    try {
      for await ( const [key, value] of db.iterator() ) out.push({ key, value });
    } finally {
      await db.close();
    }
    return out;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * A pack's actors, each with its own items ({actor, items}), from the pack's documents (items embedded in an actor are
 * keys of their own: "!actors.items!<actor id>.<item id>").
 */
export function actorsOf(docs) {
  const actors = new Map();
  const items = new Map();
  for ( const { key, value } of docs ) {
    if ( key.startsWith("!actors!") ) actors.set(key.slice("!actors!".length), value);
    else if ( key.startsWith("!actors.items!") ) {
      const actorId = key.slice("!actors.items!".length).split(".")[0];
      if ( !items.has(actorId) ) items.set(actorId, []);
      items.get(actorId).push(value);
    }
  }
  return [...actors].map(([id, actor]) => ({ actor, items: items.get(id) ?? [] }));
}

/** A pack's own items ("!items!<id>"). */
export const itemsOf = docs => docs.filter(d => d.key.startsWith("!items!")).map(d => d.value);
