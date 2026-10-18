/**
 * Reading PF2e's own compendiums for the developer tools (tools/coverage.mjs, tools/review.mjs). Never in the module.
 *
 * Three places the packs can come from, all read the same way afterwards (openPacks, by what the folder holds):
 *  - install: the system as Foundry installs it (system.json, packs/<folder> as LevelDB, lang/). Foundry may have a
 *    pack open, so each is copied to a temporary folder first (its LOCK file left behind) and opened there with
 *    Foundry's own classic-level; the copy is deleted as soon as it's read.
 *  - json: a GitHub release's json-assets.zip unpacked, its system.json beside it (packs/<folder>.json, lang/): the
 *    packs as that release built them (PF2e's build-packs.ts --json), the same documents the LevelDB packs hold, links
 *    by id and every item's slug set. What CI reads: one download, no Foundry needed.
 *  - source: the system's GitHub repository checked out at a release tag (system.pf2e.json, packs/pf2e/<folder>/**.json,
 *    static/lang/): the packs before the build, links by name and a pack item's slug not yet set. Worked into what the
 *    build makes as they're read (finalized: links by id, an item's slug from its name), so the same fingerprints come
 *    out. The fallback, should a release ever lack json-assets.zip.
 * Nothing read here is written anywhere: the tools keep it in memory.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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
  const file = ["system.json", "system.pf2e.json"].map(f => join(pf2eDir, f)).find(f => existsSync(f));
  if ( !file ) throw new Error(`no system.json in ${pf2eDir}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The system's language files, flat ("PF2E.NPC.Abilities.Glossary.Grab": its text), for the @Localize links a
 * creature's abilities make to the glossary. Read only to classify triggers; never written out.
 * @param {string} pf2eDir
 * @param {string} [langDir]   where its language files are (lang/, a source checkout's static/lang/)
 */
export function systemWords(pf2eDir, langDir = join(pf2eDir, "lang")) {
  const out = {};
  const flatten = (o, prefix) => {
    for ( const [k, v] of Object.entries(o ?? {}) ) {
      if ( v && typeof v === "object" ) flatten(v, `${prefix}${k}.`);
      else if ( typeof v === "string" ) out[`${prefix}${k}`] = v;
    }
  };
  if ( !existsSync(langDir) ) return out;
  for ( const file of readdirSync(langDir).filter(f => /^(?:en|.*-en)\.json$/.test(f)) ) {
    try {
      flatten(JSON.parse(readFileSync(join(langDir, file), "utf8")), "");
    } catch ( err ) {
      console.warn(`packs | could not read ${file}: ${err.message}`);
    }
  }
  return out;
}

/**
 * Every document in one LevelDB pack, as {key, value} ("!actors!<id>", "!actors.items!<actor id>.<item id>",
 * "!items!<id>" ...).
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
 * keys of their own: "!actors.items!<actor id>.<item id>"). Its items in the actor's own order (its `items` list, as
 * Foundry makes them), whatever order the pack keeps them in, so every source reads the same.
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
  return [...actors].map(([id, actor]) => {
    const order = new Map((Array.isArray(actor.items) ? actor.items : []).map((itemId, i) => [itemId, i]));
    const at = item => order.get(item?._id) ?? Infinity;
    const own = [...(items.get(id) ?? [])].sort((a, b) => at(a) - at(b) || String(a?._id).localeCompare(String(b?._id)));
    return { actor, items: own };
  });
}

/** A pack's own items ("!items!<id>"). */
export const itemsOf = docs => docs.filter(d => d.key.startsWith("!items!")).map(d => d.value);

/* -------------------------------------------- */
/*  JSON packs                                  */
/* -------------------------------------------- */

/** Documents as a JSON pack holds them (an actor's items inside it), in the LevelDB pack's keys. */
function asEntries(docs, type) {
  const out = [];
  for ( const doc of docs ?? [] ) {
    if ( !doc || typeof doc !== "object" ) continue;
    if ( type === "Actor" ) {
      const items = Array.isArray(doc.items) ? doc.items.filter(i => i && typeof i === "object") : [];
      out.push({ key: `!actors!${doc._id}`, value: { ...doc, items: items.map(i => i._id) } });
      for ( const item of items ) out.push({ key: `!actors.items!${doc._id}.${item._id}`, value: item });
    } else if ( type === "Item" ) out.push({ key: `!items!${doc._id}`, value: doc });
    else out.push({ key: `!${String(type).toLowerCase()}!${doc._id}`, value: doc });
  }
  return out;
}

/** Every .json file in a folder and those under it (not _folders.json), as PF2e's build finds them. */
function jsonFiles(dir) {
  if ( !existsSync(dir) ) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(".json") && basename(f) !== "_folders.json")
    .map(f => join(dir, f)).filter(f => statSync(f).isFile());
}

/**
 * PF2e's sluggify (its src/util/misc.ts, the plain style): how its build makes a pack item's slug from its name.
 * @param {string} text
 */
export function sluggify(text) {
  if ( typeof text !== "string" ) return "";
  if ( text === "-" ) return text;
  const word = String.raw`[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
  return text.replace(new RegExp(String.raw`(\p{Lowercase_Letter})(\p{Uppercase_Letter}(?=^|$|${word}))`, "gu"), "$1-$2").toLowerCase()
    .replace(/['’]/g, "").replace(new RegExp(String.raw`[^\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`, "gu"), " ").trim()
    .replace(/[-\s]+/g, "-");
}

/** Every string in a value, changed by `fn` (PF2e's recursiveReplaceString). */
const replaceStrings = (v, fn) => (typeof v === "string" ? fn(v) : Array.isArray(v) ? v.map(x => replaceStrings(x, fn))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceStrings(x, fn)])) : v);

/**
 * A source checkout's documents worked into what PF2e's build makes of them (its compendium-pack.ts #finalize): a pack
 * item's slug from its name; a rule element's compendium uuid, a self-effect's, and every @UUID and @Compendium link by
 * the linked document's id instead of its name. A name it can't find stays as it is (the build would stop there).
 * @param {object[]} docs
 * @param {string} type        the pack's document type
 * @param {object} namesToIds  {[document type]: Map<pack name, Map<document name, id>>}
 */
function finalizeSource(docs, type, namesToIds) {
  const items = namesToIds.Item;
  const byId = uuid => {
    const m = /^(Compendium\.(?:pf2e|sf2e)\.)([^.]+)\.([^.]+)\.(.+)$/.exec(uuid);
    const id = m ? items.get(m[2])?.get(m[4]) : null;
    return id ? `${m[1]}${m[2]}.${m[3]}.${id}` : uuid;
  };
  const convertItem = item => {
    const system = item.system ?? {};
    if ( system.selfEffect?.uuid && ["feat", "action"].includes(item.type) ) system.selfEffect.uuid = byId(system.selfEffect.uuid);
    if ( Array.isArray(system.rules) ) system.rules = system.rules.map(r => replaceStrings(r, s => (s.startsWith("Compendium.") ? byId(s) : s)));
    return item;
  };
  const link = (match, pack, docType, name) => {
    if ( match.includes("JournalEntryPage") ) return match;
    const id = namesToIds[docType]?.get(pack)?.get(name);
    if ( !id ) return match;
    return `@UUID[Compendium.pf2e.${pack}.${docType}.${id}]${match.endsWith("{") ? "{" : `{${name}}`}`;
  };
  const UUID = /@UUID\[Compendium\.(?:pf2e|sf2e)\.(?<pack>[^.]+)\.(?:(?<docType>Actor|JournalEntry|Item|Macro|RollTable)\.)?(?<name>[^\]]+)\]\{?/g;
  const COMPENDIUM = /@Compendium\[(?:pf2e|sf2e)\.(?<pack>[^.]+)\.(?<docType>Actor|JournalEntry|Item|Macro|RollTable)\.(?<name>[^\]]+)\]\{?/g;
  return docs.map(doc => {
    if ( type === "Actor" ) for ( const item of doc.items ?? [] ) convertItem(item);
    else if ( type === "Item" ) {
      doc.system ??= {};
      doc.system.slug = sluggify(doc.name);
      convertItem(doc);
    }
    return JSON.parse(JSON.stringify(doc).replace(UUID, link).replace(COMPENDIUM, link));
  });
}

/* -------------------------------------------- */
/*  Opening the packs                           */
/* -------------------------------------------- */

/** What a folder holds: "source" (a checkout), "json" (json-assets), or "install". */
export function packKind(dir) {
  if ( existsSync(join(dir, "system.pf2e.json")) && existsSync(join(dir, "packs", "pf2e")) ) return "source";
  const packs = join(dir, "packs");
  if ( existsSync(packs) && readdirSync(packs).some(f => f.endsWith(".json")) ) return "json";
  return "install";
}

/**
 * PF2e's packs, wherever they are: {kind, dir, manifest, words, packs, read(name)}. `read` gives a pack's documents as a
 * LevelDB pack's {key, value} (actorsOf, itemsOf), read afresh each time (all of them at once would be a lot to hold).
 * @param {object} o
 * @param {string} o.pf2e       the folder: an install, an unpacked json-assets.zip with its system.json, or a checkout
 * @param {string} [o.foundry]  Foundry's app folder (an install only: its classic-level)
 */
export function openPacks({ pf2e, foundry = DEFAULT_FOUNDRY }) {
  const kind = packKind(pf2e);
  const manifest = systemManifest(pf2e);
  const packs = manifest.packs ?? [];
  const folder = p => basename(p.path);
  const words = systemWords(pf2e, kind === "source" ? join(pf2e, "static", "lang") : join(pf2e, "lang"));
  let ClassicLevel = null;
  let namesToIds = null;
  const sourceFiles = p => jsonFiles(join(pf2e, "packs", "pf2e", folder(p)));

  /** A source checkout's documents' ids by name, every pack's (a link may name a document in any of them). */
  const names = () => {
    if ( namesToIds ) return namesToIds;
    namesToIds = { Actor: new Map(), Item: new Map(), JournalEntry: new Map(), Macro: new Map(), RollTable: new Map() };
    for ( const p of packs ) {
      const map = new Map();
      for ( const f of sourceFiles(p) ) {
        const { name, _id } = JSON.parse(readFileSync(f, "utf8"));
        map.set(name, _id ?? "");
      }
      namesToIds[p.type]?.set(p.name, map);
    }
    return namesToIds;
  };

  const readOne = async p => {
    if ( kind === "install" ) {
      ClassicLevel ??= classicLevel(foundry);
      return readPack(pf2e, p.path, ClassicLevel);
    }
    if ( kind === "json" ) {
      const file = join(pf2e, "packs", `${folder(p)}.json`);
      return existsSync(file) ? asEntries(JSON.parse(readFileSync(file, "utf8")), p.type) : [];
    }
    const docs = sourceFiles(p).map(f => JSON.parse(readFileSync(f, "utf8")));
    return asEntries(finalizeSource(docs, p.type, names()), p.type);
  };

  return {
    kind, dir: pf2e, manifest, words, packs,
    /** A pack's documents, by its name (none for a pack it hasn't). */
    async read(name) {
      const p = packs.find(x => x.name === name);
      return p ? readOne(p) : [];
    }
  };
}
