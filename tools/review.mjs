#!/usr/bin/env node
/**
 * The review check: what a PF2e update or errata changed for this helper, so nobody has to review every item. A
 * developer tool for the coders and GitHub, never in the module (the release zip leaves tools/ and review/ out).
 *
 *   node tools/review.mjs [--pf2e <folder>] [--foundry <folder>] [--core <folder>] [--out <file>] [--issue <file>]
 *                         [--accept <slug ...>] [--note <text>] [--how special|no-fight|elsewhere] [--accept-generic]
 *                         [--notes <file>]
 *
 *   --pf2e, --foundry, --core   PF2e's packs (an install, a release's unpacked json-assets.zip with its system.json, or
 *                    a checkout of the system at a release tag), Foundry's app folder, the core's scripts: as
 *                    tools/coverage.mjs takes them
 *   --out            write the report there (else it goes to stdout)
 *   --issue          also write the GitHub issue's body there (the report, cut to GitHub's limit, with a footer)
 *   --accept         re-stamp these special cases as reviewed against this version (an entry the ledger hasn't: needs
 *                    --note, and takes --how; glossary.js's NO_FIGHT_EFFECT and PLAYED_ELSEWHERE set it themselves)
 *   --accept-generic re-snapshot the generic readings and the system's slugs, and the names the code uses that aren't
 *                    slugs (the ledger's notSlugs)
 *   --notes          a JSON file {entries: {slug: note | {note, how}}, ignore: {name: why}}: every entry in it stamped
 *                    with its note, every ignore added (seeding the ledger, or many notes at once)
 * A run that leaves nothing to review records the version as the ledger's `checked`.
 *
 * What it keeps (review/, beside tools/; the files' shape and the comparing, writing and reporting are FastFighting
 * Core's tools/review, shared by every helper):
 *  - review/ledger.json: one entry per special case, a PF2e slug the scripts name (quoted, or as an object key, and
 *    PF2e has an item of that slug): `how` (special; no-fight, NO_FIGHT_EFFECT; elsewhere, PLAYED_ELSEWHERE), `note`
 *    (the team's own line on what's special and where), `reviewed` (the date), `system` (the PF2e version), `rules` (a
 *    fingerprint of its structure: rule elements, traits, action type and cost, frequency, a spell's casting and
 *    damage, a condition item's id) and `text` (a fingerprint of its description). Fingerprinted from the copies in
 *    PF2e's Item packs (its glossaries, feats, spells, conditions ...); a slug only creatures have, from every
 *    creature's copy, numbers and the creature's name masked. Also `notSlugs` (quoted kebab-case names that aren't
 *    PF2e slugs) and `ignore` (names that are PF2e slugs the code means something else by: a trait, a damage type, a
 *    word of the engine's), and `checked`, the last version every part of it was checked against.
 *  - review/snapshot.json: for the generic items (every creature ability and character option the scan in
 *    tools/coverage.mjs reads, not a special case), per slug a fingerprint of what the helper builds from it (the
 *    readers' output, numbers, ids and labels masked, each distinct shape once over every creature that has it) and
 *    how many it saw; and the other slugs PF2e has (its ability glossaries' entries, spells, conditions, classes,
 *    ancestries, heritages, backgrounds), by kind, so a new one shows.
 * The report: special cases whose structure or text changed; slugs the code names that PF2e no longer has; slugs the
 * code names with no entry, and entries it no longer names; auras.js CONDITION_ITEMS ids that no longer name their
 * condition; generic slugs whose built shape changed; new slugs, the likely special cases flagged (in PF2e's ability
 * glossaries, like a special case's slug, or common and not understood); generic slugs gone. Slugs, counts, our notes
 * and links to the code only: never PF2e's text.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_FOUNDRY, DEFAULT_PF2E, actorsOf, itemsOf, openPacks } from "./coverage-packs.mjs";
import { REPO, descriptionOf, helperModules, scan, scriptsText, slugOf } from "./coverage.mjs";

export const LEDGER = join(REPO, "review", "ledger.json");
export const SNAPSHOT = join(REPO, "review", "snapshot.json");

/** What a special case's `how` may be. */
export const HOWS = Object.freeze(["special", "no-fight", "elsewhere"]);

/** PF2e's glossaries of creature abilities: a new slug in one is likely a standard ability to know by slug. */
const GLOSSARY_PACKS = new Set(["bestiary-ability-glossary-srd", "bestiary-family-ability-glossary"]);

/** Item types whose slugs the snapshot lists (beside the abilities it fingerprints), so a new one shows. */
const OTHER_TYPES = new Set(["spell", "condition", "class", "ancestry", "heritage", "background"]);

/** A generic slug this common, not understood, is a likely candidate for a reader or a slug of its own. */
const COMMON = 5;

/** Keys left out of a built shape: ids the tool makes up, names and labels (a creature's own, or words). */
const VOLATILE = new Set(["id", "itemId", "from", "name", "label", "slug", "effectRef", "img", "tell"]);

/* -------------------------------------------- */
/*  Options                                     */
/* -------------------------------------------- */

export function options(argv) {
  const o = { out: null, issue: null, pf2e: process.env.PF2E_SYSTEM ?? DEFAULT_PF2E, foundry: process.env.FOUNDRY_APP ?? DEFAULT_FOUNDRY,
    core: process.env.FASTFIGHTING_CORE ?? join(REPO, "..", "FastFighting", "scripts"), accept: [], acceptGeneric: false, note: null, how: null, notes: null };
  for ( let i = 0; i < argv.length; i++ ) {
    const key = argv[i].replace(/^--/, "");
    if ( key === "accept" ) {
      while ( argv[i + 1] && !argv[i + 1].startsWith("--") ) o.accept.push(argv[++i]);
    } else if ( key === "accept-generic" ) o.acceptGeneric = true;
    else if ( ["out", "issue", "pf2e", "foundry", "core", "note", "how", "notes"].includes(key) && argv[i + 1] !== undefined ) o[key] = argv[++i];
    else throw new Error(`unknown option or missing value: ${argv[i]}`);
  }
  if ( o.how && !HOWS.includes(o.how) ) throw new Error(`--how is one of ${HOWS.join(", ")}`);
  return o;
}

/** FastFighting Core's shared review pieces (its tools/review), beside the core's scripts. */
export async function reviewTools(coreScripts) {
  return import(pathToFileURL(join(resolve(coreScripts), "..", "tools", "review", "index.mjs")).href);
}

/* -------------------------------------------- */
/*  Fingerprints                                */
/* -------------------------------------------- */

/**
 * An item's structure, for its `rules` fingerprint: its rule elements, traits, action type and cost, frequency and
 * self-effect; a spell's casting time, damage, defense, area, range, target and duration; a condition item's id (what
 * auras.js CONDITION_ITEMS knows it by) and its value; a Strike's damage and attack effects.
 */
export function structureOf(item) {
  const sys = item.system ?? {};
  const out = {
    type: item.type, actionType: sys.actionType?.value, actions: sys.actions?.value, category: sys.category,
    traits: [...(sys.traits?.value ?? [])].sort(), frequency: sys.frequency ? { max: sys.frequency.max, per: sys.frequency.per } : null,
    rules: sys.rules, selfEffect: sys.selfEffect?.uuid ?? null
  };
  if ( item.type === "spell" ) Object.assign(out, { time: sys.time?.value, damage: sys.damage, defense: sys.defense, area: sys.area, range: sys.range?.value,
    target: sys.target?.value, duration: sys.duration?.value });
  if ( item.type === "condition" ) Object.assign(out, { id: item._id, valued: sys.value?.isValued, group: sys.group, overrides: sys.overrides });
  if ( item.type === "melee" ) Object.assign(out, { damage: Object.values(sys.damageRolls ?? {}).map(d => ({ damage: d.damage, type: d.damageType })),
    attackEffects: sys.attackEffects?.value });
  return out;
}

const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A creature's copy of an ability, as one of many: the creature's own name and every number masked. */
function maskedText(html, actorName, tools) {
  let text = String(html ?? "");
  for ( const w of String(actorName ?? "").split(/[^\p{L}'-]+/u).filter(x => x.length > 2) ) text = text.replace(new RegExp(`\\b${escape(w)}\\b`, "giu"), "<self>");
  return tools.maskNumbers(text);
}

/** The shape of what the helper built from one item (coverage.mjs classify's `built`): ids, labels and numbers masked. */
function shapeOf(built, tools) {
  const ids = v => (typeof v === "string" ? v.replace(/^a\.[\w.-]+$/, "<id>") : Array.isArray(v) ? v.map(ids)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ids(x)])) : v);
  return tools.maskNumbers(ids(tools.withoutKeys(built, VOLATILE)));
}

/* -------------------------------------------- */
/*  The scan                                    */
/* -------------------------------------------- */

/**
 * Everything the check needs from PF2e's packs:
 *  - vocab: every slug PF2e has (Map slug -> Set of item types), from every pack, items in actors too;
 *  - prints: the fingerprints ({rules, text}) of each slug in `watch`;
 *  - conditionIds: the conditions pack's ids -> slugs;
 *  - others: slug -> kind, for PF2e's ability glossaries and OTHER_TYPES; glossary: the slugs in its ability glossaries;
 *  - generic: slug -> {built, count, level, kind} for every ability the coverage scan reads (but `special`'s).
 * @param {object} o           options
 * @param {object} tools       the core's review pieces
 * @param {Set<string>} watch  the slugs to fingerprint (the ledger's, and those the code names)
 */
export async function freshScan(o, tools, watch) {
  const packs = openPacks({ pf2e: o.pf2e, foundry: o.foundry });
  const vocab = new Map();
  const canonical = new Map();
  const embedded = new Map();
  const conditionIds = new Map();
  const others = new Map();
  const glossary = new Set();
  const add = (map, slug, v) => (map.get(slug) ?? map.set(slug, []).get(slug)).push(v);
  const note = (slug, type) => (vocab.get(slug) ?? vocab.set(slug, new Set()).get(slug)).add(type);
  for ( const p of packs.packs ) {
    if ( !["Item", "Actor"].includes(p.type) ) continue;
    const docs = await packs.read(p.name);
    if ( p.type === "Item" ) {
      for ( const item of itemsOf(docs) ) {
        const slug = slugOf(item);
        if ( !slug ) continue;
        note(slug, item.type);
        if ( GLOSSARY_PACKS.has(p.name) ) {
          glossary.add(slug);
          if ( !others.has(slug) ) others.set(slug, "glossary ability");
        } else if ( OTHER_TYPES.has(item.type) && !others.has(slug) ) others.set(slug, item.type);
        if ( item.type === "condition" ) conditionIds.set(item._id, slug);
        if ( watch.has(slug) ) add(canonical, slug, { rules: structureOf(item), text: descriptionOf(item).replace(/\s+/g, " ").trim() });
      }
    } else {
      for ( const { actor, items } of actorsOf(docs) ) {
        for ( const item of items ) {
          const slug = slugOf(item);
          if ( !slug ) continue;
          note(slug, item.type);
          if ( watch.has(slug) ) add(embedded, slug, { rules: tools.maskNumbers(structureOf(item)), text: maskedText(descriptionOf(item), actor.name, tools) });
        }
      }
    }
  }
  // (A slug in PF2e's Item packs is fingerprinted from those copies; one only creatures have, from all of theirs.)
  const prints = new Map();
  for ( const slug of watch ) {
    const copies = canonical.get(slug) ?? embedded.get(slug);
    if ( copies ) prints.set(slug, { rules: tools.setPrint(copies.map(c => c.rules)), text: tools.setPrint(copies.map(c => c.text)) });
  }

  // The generic readings: what the helper builds from each ability the coverage scan reads.
  const shapes = new Map();
  await scan(o, { visit(r, where) {
    if ( watch.has(r.slug) ) return;
    const s = shapes.get(r.slug) ?? shapes.set(r.slug, { prints: new Set(), count: 0, levels: {}, kind: where.side }).get(r.slug);
    s.prints.add(tools.fingerprint(shapeOf(r.built, tools), 64));
    s.count++;
    s.levels[r.level] = (s.levels[r.level] ?? 0) + 1;
  } });
  const generic = new Map([...shapes].map(([slug, s]) => [slug, { built: tools.printsPrint(s.prints), count: s.count,
    level: Object.entries(s.levels).sort((a, b) => b[1] - a[1])[0][0], kind: s.kind }]));
  return { version: packs.manifest.version, kind: packs.kind, vocab, prints, conditionIds, others, glossary, generic };
}

/* -------------------------------------------- */
/*  The check                                   */
/* -------------------------------------------- */

const git = args => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); } catch ( err ) { return ""; } };

/** The repository and commit to link the code at: GitHub Actions' own, else this checkout's. */
function codeAt() {
  const remote = git(["remote", "get-url", "origin"]);
  const repo = process.env.GITHUB_REPOSITORY ?? (/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(remote)?.[1] ?? null);
  return { repo, ref: process.env.GITHUB_SHA ?? (git(["rev-parse", "HEAD"]) || "main") };
}

/** Why a new slug is likely a special case: in PF2e's glossary, like a special case's slug, common and not understood. */
function whyNew(slug, { glossary, specials, families, generic }) {
  const why = [];
  if ( glossary.has(slug) ) why.push("in PF2e's ability glossary");
  const parts = slug.split("-");
  const like = specials.find(s => s.length > 3 && s !== slug && new RegExp(`(?:^|-)${escape(s)}(?:-|$)`).test(slug));
  if ( like ) why.push(`like \`${like}\``);
  else if ( parts.length > 1 && (families.get(parts[0]) ?? 0) >= 3 ) why.push(`like \`${parts[0]}-*\``);
  const g = generic?.get(slug);
  if ( g && g.count >= COMMON && ["part", "none"].includes(g.level) ) why.push(`${g.count} of them, ${g.level === "part" ? "partly" : "not"} understood`);
  return why;
}

/**
 * The check: a fresh scan against the ledger and the snapshot, accepts applied, the files written where accepted, and
 * the report. Returns {report (buildReport's), ledger, snapshot, fresh}.
 */
export async function check(o) {
  const tools = await reviewTools(o.core);
  const h = await helperModules(o.core);
  const ledger = tools.readJSON(LEDGER, null) ?? { system: "pf2e", checked: null, entries: {}, notSlugs: [], ignore: {} };
  ledger.entries ??= {};
  ledger.notSlugs ??= [];
  ledger.ignore ??= {};
  const snapshot = tools.readJSON(SNAPSHOT, null) ?? { system: "pf2e", version: null, taken: null, generic: {}, others: {} };
  const notes = o.notes ? JSON.parse(readFileSync(resolve(o.notes), "utf8")) : { entries: {}, ignore: {} };
  Object.assign(ledger.ignore, notes.ignore ?? {});

  // The names the scripts use, and those of them PF2e has as slugs (or the ledger knows as one: a slug gone from PF2e).
  const { hyphenated, words, keys } = tools.namesIn(scriptsText());
  const names = new Set([...hyphenated, ...words, ...keys]);
  const watch = new Set([...Object.keys(ledger.entries), ...Object.keys(notes.entries ?? {}), ...o.accept]);
  // (A first look at the vocabulary: which names are slugs at all, before fingerprinting them.)
  const fresh = await freshScan(o, tools, new Set([...watch, ...[...names].filter(n => !Object.hasOwn(ledger.ignore, n))]));
  const named = new Set([...names].filter(n => (fresh.vocab.has(n) || Object.hasOwn(ledger.entries, n)) && !Object.hasOwn(ledger.ignore, n)));
  const version = fresh.version;
  const date = tools.today();
  const { NO_FIGHT_EFFECT, PLAYED_ELSEWHERE } = h.glossary;
  const howOf = (slug, given) => (NO_FIGHT_EFFECT.has(slug) ? "no-fight" : PLAYED_ELSEWHERE.has(slug) ? "elsewhere" : given ?? ledger.entries[slug]?.how ?? "special");

  // Accepting: notes first (seeding), then --accept.
  const stampOne = (slug, { note, how } = {}) => {
    const entry = ledger.entries[slug];
    if ( !entry && !note ) throw new Error(`${slug}: a new ledger entry needs a note (--note "what's special, and where")`);
    ledger.entries[slug] = tools.stamp(entry, { version, date, prints: fresh.prints.get(slug) ?? { rules: null, text: null }, how: howOf(slug, how), note });
  };
  for ( const [slug, v] of Object.entries(notes.entries ?? {}) ) stampOne(slug, typeof v === "string" ? { note: v } : v);
  for ( const slug of o.accept ) stampOne(slug, { note: o.note ?? undefined, how: o.how ?? undefined });

  // The generic readings: every ability the scan reads that isn't a special case; PF2e's other slugs.
  const generic = Object.fromEntries([...fresh.generic].filter(([slug]) => !ledger.entries[slug]).map(([slug, g]) => [slug, { built: g.built, count: g.count }]));
  const others = Object.fromEntries([...fresh.others].filter(([slug]) => !ledger.entries[slug] && !generic[slug]).sort());
  const notSlugs = [...hyphenated].filter(n => !fresh.vocab.has(n) && !ledger.entries[n] && !Object.hasOwn(ledger.ignore, n)).sort();
  if ( o.acceptGeneric ) {
    Object.assign(snapshot, { system: "pf2e", version, taken: date, generic, others });
    ledger.notSlugs = notSlugs;
  }

  // What changed.
  const special = tools.compareSpecial(ledger.entries, fresh.prints);
  const { unrecorded, unnamed } = tools.compareNamed(named, ledger);
  const genericDiff = tools.compareGeneric(snapshot.generic ?? {}, generic);
  const known = new Set([...Object.keys(snapshot.generic ?? {}), ...Object.keys(snapshot.others ?? {}), ...Object.keys(ledger.entries)]);
  const newOthers = Object.keys(others).filter(s => !known.has(s)).map(slug => ({ slug, after: { kind: others[slug] } }));
  const specials = Object.entries(ledger.entries).filter(([, e]) => e.how === "special").map(([s]) => s);
  const families = new Map();
  for ( const s of specials ) families.set(s.split("-")[0], (families.get(s.split("-")[0]) ?? 0) + (s.includes("-") ? 1 : 0));
  const added = [...genericDiff.added, ...newOthers].map(({ slug, after }) => {
    const g = fresh.generic.get(slug);
    return { slug, kind: g ? (g.kind === "creature" ? "creature ability" : "character option") : after.kind, count: g?.count ?? "", level: g ? { full: "fully", known: "known", part: "partly", none: "not", plumbing: "plumbing" }[g.level] : "",
      why: whyNew(slug, { glossary: fresh.glossary, specials, families, generic: fresh.generic }) };
  });
  // (Names the ledger calls no slug that PF2e has as slugs now.)
  const nowSlugs = (ledger.notSlugs ?? []).filter(n => fresh.vocab.has(n));
  // (auras.js knows PF2e's conditions by their items' ids: an id that no longer names its condition breaks a link.)
  const moved = Object.entries(h.auras.CONDITION_ITEMS).filter(([id, slug]) => fresh.conditionIds.get(id) !== slug)
    .map(([id, slug]) => [tools.code(id), tools.code(slug), fresh.conditionIds.get(id) ? tools.code(fresh.conditionIds.get(id)) : "no such id"]);

  // The code that names each, linked.
  const at = codeAt();
  const where = tools.whereNamed(tools.sourceFiles(join(REPO, "scripts"), { root: REPO }), new Set([...Object.keys(ledger.entries), ...unrecorded]));
  const links = slug => (where.get(slug) ?? []).slice(0, 3).map(w => tools.codeLink(w, at)).concat((where.get(slug) ?? []).length > 3 ? [`+${where.get(slug).length - 3}`] : []);
  const kind = { install: "its installed packs", json: "its release's json-assets", source: "its source at the release tag" }[fresh.kind];
  const report = tools.buildReport({
    system: "PF2e", version, source: kind, checked: ledger.checked, snapshot: snapshot.version,
    special: special.changed.map(c => ({ slug: c.slug, how: c.entry.how, note: c.entry.note, fields: c.fields, code: links(c.slug) })),
    gone: special.gone.map(g => ({ slug: g.slug, how: g.entry.how, note: g.entry.note, named: named.has(g.slug), code: links(g.slug) })),
    unrecorded: unrecorded.map(slug => ({ slug, code: links(slug) })),
    unnamed: unnamed.map(slug => ({ slug, how: ledger.entries[slug].how })),
    generic: genericDiff.changed, added, removed: genericDiff.removed,
    extra: [
      { title: "Condition ids that no longer name their condition", intro: "auras.js `CONDITION_ITEMS` links conditions by these ids: put the new ids in.", head: ["id", "was", "now"], rows: moved },
      { title: "Names the ledger calls no slug that PF2e has as slugs now", intro: "Move each to an entry (it's a special case) or to `ignore` (the code means something else by it).",
        head: ["name"], rows: nowSlugs.map(n => [tools.code(n)]) }
    ],
    commands: { check: "node tools/review.mjs --pf2e <PF2e's packs>", accept: "node tools/review.mjs --pf2e <PF2e's packs> --accept", acceptGeneric: "node tools/review.mjs --pf2e <PF2e's packs> --accept-generic" }
  });

  // Written only where something was accepted; a run that leaves nothing to review records the version as checked.
  const accepting = o.accept.length || o.acceptGeneric || Object.keys(notes.entries ?? {}).length || Object.keys(notes.ignore ?? {}).length;
  if ( accepting ) {
    if ( report.clean ) ledger.checked = version;
    tools.writeJSON(LEDGER, { system: "pf2e", checked: ledger.checked ?? null, entries: ledger.entries, notSlugs: ledger.notSlugs, ignore: ledger.ignore });
    if ( o.acceptGeneric ) tools.writeJSON(SNAPSHOT, { system: "pf2e", version: snapshot.version, taken: snapshot.taken, generic: snapshot.generic, others: snapshot.others });
  }
  return { report, ledger, snapshot, fresh, tools };
}

/* -------------------------------------------- */
/*  Main                                        */
/* -------------------------------------------- */

async function main() {
  const o = options(process.argv.slice(2));
  const { report, tools } = await check(o);
  if ( o.out ) {
    const file = resolve(process.cwd(), o.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, report.text);
    console.error(`review | wrote ${file}`);
  } else process.stdout.write(report.text);
  if ( o.issue ) {
    const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";
    const footer = `Opened by the system-watch workflow${run ? ` ([its run](${run}), the full report its artifact)` : ""}. See CODING_README.md, "Reviewing system updates".`;
    const file = resolve(process.cwd(), o.issue);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, tools.issueBody(report.text, { footer }));
    console.error(`review | wrote ${file}`);
  }
  console.error(`review | ${report.clean ? "nothing changed" : Object.entries(report.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

if ( process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href ) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
