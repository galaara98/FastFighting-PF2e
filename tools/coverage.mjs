#!/usr/bin/env node
/**
 * Coverage scan: how much of what PF2e's creatures and characters can do this helper understands, sorted by how often
 * each thing turns up, so the team knows what to teach it next. A developer tool: it isn't part of the module (the
 * release zips only module.json, scripts, languages, hardcoded-toEN.json, README.md and LICENSE).
 *
 *   node tools/coverage.mjs [--out docs/coverage.md] [--pf2e <folder>] [--foundry <folder>] [--core <folder>]
 *
 *   --out      write the report there (else it goes to stdout)
 *   --pf2e     the PF2e system folder (default %LOCALAPPDATA%/FoundryVTT/Data/systems/pf2e; env PF2E_SYSTEM)
 *   --foundry  Foundry's app folder, for its classic-level (default %LOCALAPPDATA%/Programs/FoundryVirtualTabletop/
 *              Foundry Virtual Tabletop/resources/app; env FOUNDRY_APP)
 *   --core     FastFighting Core's scripts folder (default ../FastFighting/scripts beside this repository; env
 *              FASTFIGHTING_CORE, as the tests take it)
 *
 * How it reads: PF2e's own packs (coverage-packs.mjs: each copied to a temporary folder and opened with Foundry's
 * classic-level, the copy deleted once read). Creatures: every npc in the system's Actor packs (not the pregenerated
 * characters, hazards or vehicles), each of its actions and feats once per creature. Characters: the feats, class
 * features, actions and ancestry features compendiums, each item once, weighed by how many pregenerated characters
 * (iconics and adventure pregens) carry it. Strikes, spells and gear are left out: the helper reads every Strike and
 * spell as such, and this scan is about abilities.
 *
 * How it classifies, by slug (an item's own, else made from its name, as the helper's slugOf makes it):
 *  - Fully understood: the helper builds an engine action, reaction or flag from it. Where the helper's own pure
 *    functions can be called, they are, on the item's data: abilityAction and gulletAction (abilities.js, gullet.js),
 *    attackEffects and ferocityOf (adapter.js), classActions (class-actions.js), derivePf2eTraits' flags (traits.js),
 *    modsFromRules on a self-effect's rules (effects.js), champion.js's AURA_REACTIONS. What adapter.js recognizes
 *    inside its class (its reactions, save upgrades, Battle Medicine ...) is mirrored in KNOWN below, and the engine's
 *    own moves in ENGINE_ACTIONS; keep them in step with the helper (the report lists any mirrored slug the scripts no
 *    longer mention, and any slug the scripts mention that these tables don't know). A passive whose every rule
 *    element is one PF2e works into the numbers the helper reads (its AC, saves, speeds, senses, resistances, Strikes
 *    and their damage: no predicate, or for a Strike's rule one about the weapon alone), with nothing else to it,
 *    counts too ("PF2e's numbers").
 *  - Partly: none of that, but it has structure the helper could read: inline @Damage, @Check or @Template, an inline
 *    roll or action link, other rule elements, a frequency, a trigger, an effect or condition link.
 *  - Not at all: none of that.
 *  - Plumbing only: its only rules grant or choose other items (they're scanned in their own right).
 * Reactions (and free actions with a trigger) also have their Trigger line filed under the core's master triggers by
 * the grammar in coverage-triggers.mjs.
 *
 * What it writes: slugs, item types, traits, counts, categories, master trigger ids, pattern shapes with every noun
 * replaced, and which source each comes from (the free remaster core, Monster Core and Player Core, or other). Never
 * an item's description or rules text: the text is read to classify, in memory only.
 */
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_FOUNDRY, DEFAULT_PF2E, actorsOf, classicLevel, itemsOf, readPack, systemManifest, systemWords } from "./coverage-packs.mjs";
import { classifyTrigger, normalizeTrigger, refineTrigger, shapeOf } from "./coverage-triggers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/* -------------------------------------------- */
/*  Options                                     */
/* -------------------------------------------- */

export function options(argv) {
  const out = { out: null, pf2e: process.env.PF2E_SYSTEM ?? DEFAULT_PF2E, foundry: process.env.FOUNDRY_APP ?? DEFAULT_FOUNDRY,
    core: process.env.FASTFIGHTING_CORE ?? join(REPO, "..", "FastFighting", "scripts") };
  for ( let i = 0; i < argv.length; i++ ) {
    const key = argv[i].replace(/^--/, "");
    if ( !(key in out) || argv[i + 1] === undefined ) throw new Error(`unknown option or missing value: ${argv[i]}`);
    out[key] = argv[++i];
  }
  return out;
}

/* -------------------------------------------- */
/*  The helper's own code                       */
/* -------------------------------------------- */

/**
 * The helper's modules, imported as the tests import them: scripts/core.js points at the core one folder over in
 * Foundry, so the same path is sent to the core repository here (vitest.config.js's alias), and game.i18n is a
 * stand-in that has no words (the helper's labels are never looked at).
 */
async function helperModules(coreScripts) {
  const core = pathToFileURL(/[\\/]$/.test(coreScripts) ? coreScripts : `${coreScripts}/`).href;
  const hook = `export async function resolve(specifier, context, next) {
    const m = /^(?:\\.\\.\\/)+(?:fast-fighting|FastFighting)\\/scripts\\/(.*)$/.exec(specifier);
    return m ? next(new URL(m[1], ${JSON.stringify(core)}).href, context) : next(specifier, context);
  }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  globalThis.game = { i18n: { lang: "en", has: () => false, localize: key => key, format: key => key } };
  const s = name => pathToFileURL(join(REPO, "scripts", name)).href;
  const [abilities, gullet, adapter, classActions, traits, effects, holds, coreApi, master] = await Promise.all([
    import(s("abilities.js")), import(s("gullet.js")), import(s("adapter.js")), import(s("class-actions.js")), import(s("traits.js")),
    import(s("effects.js")), import(s("holds.js")), import(`${core}core-api.js`), import(`${core}story/master.js`)
  ]);
  // (A champion's reactions by slug, where the helper has them in a module of their own.)
  const champion = existsSync(join(REPO, "scripts", "champion.js")) ? await import(s("champion.js")) : {};
  return { abilities, gullet, adapter, classActions, traits, effects, holds, coreApi, master, champion };
}

/* -------------------------------------------- */
/*  What the helper knows that it doesn't export */
/* -------------------------------------------- */

/**
 * Slugs adapter.js recognizes inside Pf2eAdapter (not exported, so mirrored here), and what it builds from each.
 * Keep in step with adapter.js (#reactions, toCombatantSpec's saveUpgrades, #feats, #skillActions, #marks, #strikes,
 * #elementalBlasts, #spells, ALWAYS_ON, #sneakAttackDice, #bonusDice) and champion.js (whose AURA_REACTIONS the scan
 * imports).
 */
const KNOWN = Object.freeze({
  "shield-block": "reaction", "reactive-shield": "reaction", "nimble-dodge": "reaction", "intercept-attack": "reaction",
  "nimble-reprisal": "reaction option", "champions-aura": "reaction range",
  evasion: "save upgrade", juggernaut: "save upgrade", resolve: "save upgrade",
  "battle-medicine": "heal action", "bon-mot": "action", "exploit-vulnerability": "action",
  "devise-a-stratagem": "Strike variant", panache: "Strike variant", "elemental-blast": "Strikes", "implements-empowerment": "Strike option",
  "sneak-attack": "bonus damage", "pack-attack": "bonus damage",
  // (A label for innate spells; #spells reads the spells themselves, at will by their names' tag.)
  "at-will-spells": "spells"
});

/**
 * Slugs the scripts mention that aren't abilities to understand (so the drift check passes them by): spells (heal
 * spells' two-action bonus), senses left out on purpose (NOT_SENSES), a bonus's own id.
 */
const NOT_ABILITIES = new Set(["heal-animal", "heal-companion", "low-light-vision", "see-invisibility", "hunters-precision"]);

/**
 * PF2e's basic actions the engine plays itself, by slug (the core's moves, and the helper's maneuvers.js, edges.js,
 * coverActions, check-roll.js ACTIONS and PURPOSES, read-turn.js MANEUVERS): a character's or creature's own copy of
 * one is understood.
 */
const ENGINE_ACTIONS = Object.freeze(new Set([
  "strike", "stride", "step", "stand", "raise-a-shield", "take-cover", "hide", "aid", "demoralize", "trip", "grapple", "shove", "disarm",
  "feint", "reposition", "escape", "administer-first-aid", "tumble-through", "steal", "force-open", "pick-a-lock", "recall-knowledge",
  "create-a-diversion", "sustain", "interact"
]));

/** Senses the helper leaves out on purpose (adapter.js NOT_SENSES): the core doesn't tell dim light from bright. */
const NOT_SENSES = new Set(["vision", "low-light-vision", "see-invisibility"]);

/**
 * Slugs read only for setting a character up (auto.js GUARD_SLUGS, SELF_GUARD_SLUGS, RESCUE_SLUGS, CONSUMABLE_FEATS,
 * SUBCLASS_STYLE and its other slugs; traits.js ITEM_LEANS): a hint, not something it plays. Noted, not counted.
 */
const HINTS = Object.freeze(new Set([
  "intercept-attack", "retributive-strike", "glimpse-of-redemption", "liberating-step", "flash-of-grandeur", "guardians-deflection-fighter",
  "shield-from-arrows", "shield-of-reckoning", "defensive-swap", "standard-bearers-sacrifice", "iron-command", "selfish-shield",
  "destructive-vengeance", "rapid-response", "alchemist-dedication", "talisman-dabbler-dedication", "scroll-trickster-dedication",
  "alchemical-sciences-methodology", "chirurgeon", "life", "medic-dedication", "redemption", "bargain-hunter", "void-healing",
  "aura-of-courage", "orc-ferocity", "reckless-abandon", "battle-medicine", "divine-font",
  "warpriest", "battle-creed", "cloistered-cleric", "untamed-order", "ruffian", "laughing-shadow", "starlit-span", "way-of-the-vanguard",
  "way-of-the-drifter", "way-of-the-triggerbrand", "way-of-the-pistolero", "way-of-the-sniper", "way-of-the-spellshot", "bomber", "mutagenist",
  "weapon-innovation", "armor-innovation", "light-mortar-innovation"
]));

/** Rule elements that do nothing by themselves (they grant, choose, toggle or decorate). */
const PLUMBING = new Set(["GrantItem", "ChoiceSet", "RollOption", "TokenLight", "TokenEffectIcon", "TokenImage", "TokenName", "SpecialResource", "CraftingAbility", "TokenMark"]);

/**
 * Rule elements PF2e works into numbers the helper reads off the sheet (AC, saves, Perception, skills, Hit Points,
 * speeds, senses, resistances, Strikes and their damage), when they always apply (no predicate).
 */
const FOLDED = new Set(["FlatModifier", "ActiveEffectLike", "MartialProficiency", "Resistance", "Weakness", "Immunity", "Sense", "BaseSpeed", "Strike",
  "AdjustStrike", "CreatureSize", "ActorTraits", "DexterityModifierCap", "DamageDice", "AdjustModifier", "ItemAlteration", "DamageAlteration"]);

/** The free remaster core, by its books' titles (and the creature pack that is one). */
const CORE_TITLES = new Set(["Pathfinder Monster Core", "Pathfinder Player Core"]);
const CORE_CREATURE_PACKS = new Set(["pathfinder-monster-core"]);

/** Actor packs that aren't creatures to scan. */
const NOT_CREATURE_PACKS = new Set(["iconics", "paizo-pregens", "hazards", "vehicles"]);
const PREGEN_PACKS = ["iconics", "paizo-pregens"];
/** Character options, by pack name, and what each is. */
const CHARACTER_PACKS = Object.freeze({ "feats-srd": "feat", classfeatures: "class feature", actionspf2e: "action", ancestryfeatures: "ancestry feature" });
/** Effect packs, for self-effects. */
const EFFECT_PACKS = ["feat-effects", "bestiary-effects", "spell-effects", "equipment-effects", "other-effects", "campaign-effects"];

/* -------------------------------------------- */
/*  Reading an item                             */
/* -------------------------------------------- */

/** An item's slug as the helper's slugOf makes it: its own, else from its name. */
export function slugOf(item) {
  const slug = item?.slug ?? item?.system?.slug;
  if ( slug ) return slug;
  return item?.name ? item.name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
}

const descriptionOf = item => String(item?.system?.description?.value ?? "");
const hasPredicate = r => (Array.isArray(r?.predicate) ? r.predicate.length > 0 : !!r?.predicate);
const SAVES = new Set(["fortitude", "reflex", "will", "fort", "ref"]);

/**
 * Its text as the helper would read it after PF2e worked its formulas out (adapter.js resolvedText), approximated
 * without Foundry: an @Check with no number for its DC gets the GM Core's DC for the level; an @Damage formula with
 * @-values (@actor.level ...) has them filled in (the level; an attribute modifier +4) and its arithmetic worked out.
 */
function approxResolved(html, level, ruleValue, levelDC) {
  const raw = String(html ?? "").replace(/@Embed\[[^\]]*\](?:\{[^}]*\})?/g, " ").replace(/@(?:UUID|Compendium)\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? " ");
  const dc = levelDC(level);
  const formula = inside => {
    let f = inside.replace(/@[\w.]+/g, ref => (/level|rank/.test(ref) ? String(level) : /\.mod\b/.test(ref) ? "4" : "1"));
    for ( let i = 0; i < 20; i++ ) {
      const next = f.replace(/\b(floor|ceil|max|min|ternary|gte|gt|lte|lt|eq)?\(([-\d.+*/,\s]*)\)/g, (m, fn, args) => {
        const v = ruleValue(fn ? `${fn}(${args})` : args);
        return v === null ? m : String(Math.floor(Number(v)));
      });
      if ( next === f ) break;
      f = next;
    }
    return f;
  };
  return raw.replace(/@Check\[([^\]]*)\]/gi, (m, inside) => (/\bdc:\d/i.test(inside) ? m : `@Check[${inside.replace(/\|?dc:[^|\]]*/i, "")}|dc:${dc}]`))
    .replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\]/gi, (m, inside) => (inside.includes("@") ? `@Damage[${formula(inside)}]` : m));
}

/** What an item's text and data hold that the helper could read: [structure signals], [notes]. */
function structureOf(item, { expanded, attackEffect = false }) {
  const html = descriptionOf(item);
  const signals = new Set();
  const notes = new Set();
  if ( /@Damage\[/i.test(html) ) signals.add("@Damage");
  for ( const m of html.matchAll(/@Check\[([^\]|]*)/gi) ) signals.add(SAVES.has(m[1].trim().toLowerCase()) ? "@Check save" : "@Check");
  if ( /@Template\[/i.test(html) ) signals.add("@Template");
  if ( /\[\[\/(?:r|roll|br|gmr|pr)\s/i.test(html) ) signals.add("inline roll");
  if ( /\[\[\/act\s/i.test(html) || /@UUID\[Compendium\.pf2e\.actionspf2e\./i.test(html) ) signals.add("action link");
  if ( /@UUID\[Compendium\.pf2e\.[\w-]*effects\./i.test(html) || item.system?.selfEffect?.uuid ) signals.add("effect link");
  if ( /@UUID\[Compendium\.pf2e\.conditionitems\./i.test(html) ) signals.add("condition link");
  if ( /@UUID\[Compendium\.pf2e\.spells-srd\./i.test(html) ) signals.add("spell link");
  if ( Number(item.system?.frequency?.max) > 0 ) signals.add("frequency");
  const type = item.system?.actionType?.value;
  if ( type === "reaction" || (type === "free" && /<strong>\s*Trigger\s*<\/strong>/i.test(expanded)) ) signals.add("trigger");
  if ( attackEffect ) signals.add("attack effect");
  if ( /@Localize\[PF2E\.NPC\.Abilities\.Glossary\./.test(html) ) notes.add("glossary");
  if ( /<strong>\s*Requirements?\s*<\/strong>/i.test(expanded) ) notes.add("requirements");
  if ( (item.system?.traits?.value ?? []).includes("finisher") ) signals.add("finisher trait");
  return { signals, notes };
}

/** The option strings a predicate names, however nested ({not}, {or}, {gte: ["item:proficiency:rank", 2]} ...). */
const leaves = p => (typeof p === "string" ? [p] : Array.isArray(p) ? p.flatMap(leaves) : p && typeof p === "object" ? Object.values(p).flatMap(leaves) : []);

/**
 * Does PF2e work this rule into a Strike as the helper reads it (strikesOf: its attack modifier, and its damage formula
 * asked with the Strike's own roll options)? A Strike's attack or damage rule whose predicate names only the weapon
 * and the character's features ("item:proficiency:rank", "item:trait:agile", "feature:..."): those hold or don't for
 * the Strike itself, with no target or effect needed.
 */
const strikeRule = r => (/damage|attack|strike/.test([].concat(r.selector ?? r.selectors ?? []).join(" ")) || ["ItemAlteration", "AdjustStrike"].includes(r.key))
  && leaves(r.predicate).every(t => /^(?:item|feature|class|weapon):/.test(t));

/**
 * How its rule elements stand: `folded` (every one PF2e works into the sheet's numbers, or plumbing, and at least one
 * of the former), `plumbing` (only plumbing), and the others as signals ("rules: Aura", "rules: FlatModifier (when)").
 */
function rulesOf(item, { character }) {
  const rules = (item.system?.rules ?? []).filter(r => r && typeof r === "object");
  const signals = new Set();
  let folded = 0;
  let plumbing = 0;
  let mending = false;
  for ( const r of rules ) {
    // (A character's extra damage against an off-guard foe: #strikes reads it with that roll option.)
    const offGuard = character && r.key === "DamageDice" && leaves(r.predicate).every(t => t === "target:condition:off-guard" || /^(?:item|feature):/.test(t));
    if ( r.key === "FastHealing" ) mending = true;
    else if ( PLUMBING.has(r.key) ) plumbing++;
    else if ( FOLDED.has(r.key) && (!hasPredicate(r) || offGuard || strikeRule(r)) && !(r.key === "ActiveEffectLike" && !/^system\./.test(String(r.path ?? ""))) ) folded++;
    else if ( r.key === "ActiveEffectLike" && !hasPredicate(r) ) plumbing++;
    else signals.add(`rules: ${r.key}${hasPredicate(r) && FOLDED.has(r.key) ? " (when)" : ""}`);
  }
  return { count: rules.length, folded, plumbing, mending, signals, allFolded: rules.length > 0 && !signals.size && folded > 0, onlyPlumbing: rules.length > 0 && !signals.size && !folded && !mending };
}

/* -------------------------------------------- */
/*  Classifying                                 */
/* -------------------------------------------- */

/**
 * The classifier, with the helper's functions and the scan's caches.
 * @param {object} h   helperModules()
 * @param {Map<string, object>} effects   effect items by uuid
 */
function classifier(h, effects) {
  const { abilityAction } = h.abilities;
  const { GULLETS, gulletAction } = h.gullet;
  const { attackEffects, ferocityOf } = h.adapter;
  const { modsFromRules, ruleValue } = h.effects;
  const { levelDC } = h.holds;
  const { parseTypedFormula } = h.coreApi;
  const flagCache = new Map();
  const classCache = new Map();
  const strikes = [
    { id: "a.fist", name: "fist", kind: "strike", melee: true, bonus: 10, maps: [0, -4, -8], traits: ["unarmed", "agile"], damage: parseTypedFormula("1d4[bludgeoning]"), reach: 5 },
    { id: "a.sword", name: "sword", kind: "strike", melee: true, bonus: 10, maps: [0, -5, -10], traits: [], damage: parseTypedFormula("1d8+4[slashing]"), reach: 5 },
    { id: "a.axe", name: "axe", kind: "strike", melee: true, bonus: 10, maps: [0, -4, -8], traits: ["agile"], damage: parseTypedFormula("1d6+4[slashing]"), reach: 5 }
  ];
  /** Flags derivePf2eTraits sets for one slug (Reactive Strike, Pack Attack ...). */
  const flagOf = slug => {
    if ( !flagCache.has(slug) ) {
      const { flags } = h.traits.derivePf2eTraits({ type: "npc", level: 1, traits: [], int: 0, wis: 0, will: 6, abilities: [slug], items: [], hasMaster: false });
      flagCache.set(slug, Object.keys(flags ?? {}).length > 0);
    }
    return flagCache.get(slug);
  };
  /** Does classActions do something with it (alone, or with Hunt Prey or Flurry, as a ranger's edge needs)? */
  const classActionOf = slug => {
    if ( !classCache.has(slug) ) {
      const run = set => h.classActions.classActions({ actorId: "a", slugs: new Set(set), level: 10, strikes, names: {} });
      const said = r => `${r.actions.length}|${JSON.stringify(r.strikes)}`;
      classCache.set(slug, [[], ["hunt-prey"], ["flurry"]].some(rest => said(run([slug, ...rest])) !== said(run(rest))));
    }
    return classCache.get(slug);
  };

  /**
   * One item, in its context: {level: "full"|"part"|"none"|"plumbing", how, signals, notes}.
   * @param {object} item
   * @param {object} ctx  {character, level, abilities, skills, senses, items, melee, referenced, expanded}
   */
  return function classify(item, ctx) {
    const slug = slugOf(item);
    const how = new Set();
    const type = item.system?.actionType?.value ?? "passive";
    const html = descriptionOf(item);
    const level = Math.max(1, Number(ctx.level) || Number(item.system?.level?.value) || 1);
    const actorData = { level, abilities: ctx.abilities ?? Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(k => [k, { mod: 4 }])) };

    // (Shield Block and Reactive Shield need a shield to raise: a creature with none has nothing to block with.)
    const shieldless = ["shield-block", "reactive-shield"].includes(slug) && !ctx.character && !ctx.shield;
    if ( (KNOWN[slug] && !shieldless) || h.champion.AURA_REACTIONS?.has(slug) ) how.add("slug");
    if ( ENGINE_ACTIONS.has(slug) ) how.add("engine action");
    if ( flagOf(slug) ) how.add("slug");
    if ( classActionOf(slug) ) how.add("class action");
    const ferocity = ferocityOf([{ slug, name: item.name, system: { slug, frequency: item.system?.frequency } }, ...(slug === "undying-ferocity" ? [{ slug: "ferocity", name: "", system: { slug: "ferocity" } }] : [])], 5);
    if ( ferocity && (slug !== "undying-ferocity" || ferocity.temp > 0) ) how.add("slug");

    // A rider on a Strike that lists it (adapter.js attackEffects: prone, grab, push or pull, an affliction).
    const referenced = ctx.referenced?.has(slug);
    if ( referenced ) {
      const fake = { id: "a", items: ctx.items ?? [item] };
      try {
        if ( attackEffects(fake, { system: { attackEffects: { value: [slug] } } }).length ) how.add("Strike rider");
      } catch ( err ) {
        // (An effect it can't read is no rider.)
      }
    }

    // Its own abilities (adapter.js #abilities): an action (or a feat that is one) with a save, or a gullet.
    const isAction = item.type === "action" || (item.type === "feat" && type === "action");
    if ( isAction && GULLETS[slug] ) {
      const athletics = Number(ctx.skills?.athletics);
      const gulp = gulletAction({ id: "a", name: item.name, slug, html: approxResolved(html, level, ruleValue, levelDC), traits: item.system?.traits?.value ?? [],
        actions: item.system?.actions?.value, athletics: Number.isFinite(athletics) ? athletics : null, athleticsDC: Number.isFinite(athletics) ? 10 + athletics : null,
        size: 2, speed: 25, reach: 5 });
      if ( gulp ) how.add("ability reader");
    } else if ( isAction && !(item.type === "feat" && !/@Check\[/i.test(html)) ) {
      try {
        const action = abilityAction({ id: "a", name: item.name, html: approxResolved(html, level, ruleValue, levelDC), actions: item.system?.actions?.value,
          traits: item.system?.traits?.value ?? [], strikes: ctx.melee ?? [], actionType: type });
        if ( action ) how.add("ability reader");
      } catch ( err ) {
        // (Text it can't read is no action.)
      }
    }

    // What it puts on itself (adapter.js #selfEffects): its effect's rules, and its own for while that's on.
    const uuid = item.system?.selfEffect?.uuid;
    if ( uuid && ["action", "feat"].includes(item.type) && type !== "reaction" && type !== "passive" ) {
      const effect = effects.get(uuid);
      if ( effect ) {
        const eslug = String(effect.system?.slug ?? slugOf(effect) ?? "");
        const short = eslug.replace(/^effect-/, "");
        const opts = new Set(["item:melee", "item:type:weapon", `self:effect:${short}`, `self:effect:${eslug}`, short]);
        const own = modsFromRules(effect.system?.rules ?? [], { rank: level, actor: actorData, options: opts });
        const whileOn = modsFromRules(item.system?.rules ?? [], { rank: level, actor: actorData, options: opts, only: `self:effect:${short}` });
        if ( Object.keys(own.mods).length || Object.keys(whileOn.mods).length || own.tempHp || whileOn.tempHp || own.fastHealing || own.regen ) how.add("self-effect");
      }
    }

    // Its rules: fast healing and regeneration (adapter.js #mending); numbers PF2e works into the sheet.
    const rules = rulesOf(item, { character: ctx.character });
    if ( rules.mending && (item.system?.rules ?? []).some(r => r?.key === "FastHealing" && Number(ruleValue(r.value, { actor: actorData })) > 0) ) how.add("mending");

    // A sense its sheet lists (adapter.js #senses), by the sense's own slug in the ability's.
    for ( const s of ctx.senses ?? [] ) {
      const t = String(s?.type ?? "");
      if ( t && !NOT_SENSES.has(t) && new RegExp(`(?:^|-)${t}(?:-|$)`).test(slug) ) how.add("sense");
    }

    const { signals, notes } = structureOf(item, { expanded: ctx.expanded ?? html, attackEffect: referenced && !how.has("Strike rider") });
    if ( shieldless ) notes.add("no shield");
    for ( const s of rules.signals ) signals.add(s);
    if ( HINTS.has(slug) ) notes.add("setup hint");
    const textual = ["@Damage", "@Check save", "@Check", "@Template", "inline roll", "action link", "frequency", "trigger", "effect link"].some(k => signals.has(k));
    if ( !how.size && rules.allFolded && !textual && type === "passive" ) how.add("PF2e's numbers");

    let result;
    if ( how.size ) result = "full";
    else if ( signals.size ) result = "part";
    else if ( rules.onlyPlumbing ) result = "plumbing";
    else result = "none";
    return { slug, level: result, how, signals, notes, type };
  };
}

/* -------------------------------------------- */
/*  Tallying                                    */
/* -------------------------------------------- */

const LEVELS = ["full", "part", "none", "plumbing"];
/** Each level as the report names it. */
const SAID = Object.freeze({ full: "fully", part: "partly", none: "not", plumbing: "plumbing" });

/** A tally of one slug's instances. */
function entry(slug) {
  return { slug, count: 0, core: 0, weight: 0, levels: { full: 0, part: 0, none: 0, plumbing: 0 }, coreLevels: { full: 0, part: 0, none: 0, plumbing: 0 },
    how: {}, signals: {}, notes: {}, types: {}, kinds: {}, traits: {} };
}
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

function record(table, r, { core, kind, traits }) {
  if ( !table.has(r.slug) ) table.set(r.slug, entry(r.slug));
  const e = table.get(r.slug);
  e.count++;
  e.levels[r.level]++;
  if ( core ) {
    e.core++;
    e.coreLevels[r.level]++;
  }
  for ( const k of r.how ) bump(e.how, k);
  for ( const k of r.signals ) bump(e.signals, k);
  for ( const k of r.notes ) bump(e.notes, k);
  bump(e.types, r.type);
  if ( kind ) bump(e.kinds, kind);
  for ( const t of traits ?? [] ) bump(e.traits, t);
  return e;
}

/** The level most of a slug's instances have (ties to the better); `core`, of those from the free remaster core. */
const levelOf = (e, core = false) => LEVELS.reduce((a, b) => ((core ? e.coreLevels : e.levels)[b] > (core ? e.coreLevels : e.levels)[a] ? b : a), "full");
const top = (o, n = 3, min = 0) => Object.entries(o).filter(([, v]) => v > min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");

/* -------------------------------------------- */
/*  The scan                                    */
/* -------------------------------------------- */

export async function scan(o) {
  const h = await helperModules(o.core);
  const manifest = systemManifest(o.pf2e);
  const ClassicLevel = classicLevel(o.foundry);
  const words = systemWords(o.pf2e);
  const expand = html => String(html ?? "").replace(/@Localize\[([^\]]+)\]/g, (m, key) => words[key] ?? "");
  const packs = manifest.packs ?? [];
  const read = async name => {
    const p = packs.find(x => x.name === name);
    return p ? readPack(o.pf2e, p.path, ClassicLevel) : [];
  };

  // Effects, for self-effects (by uuid, as items link them).
  const effects = new Map();
  for ( const name of EFFECT_PACKS ) {
    for ( const item of itemsOf(await read(name)) ) effects.set(`Compendium.pf2e.${name}.Item.${item._id}`, item);
  }
  const classify = classifier(h, effects);

  // Words for the trigger shapes: PF2e's traits, its actions, skills and saves.
  const traitWords = new Set(Object.entries(words).filter(([k, v]) => /^PF2E\.Trait[A-Z]/.test(k) && !/\s/.test(v)).map(([, v]) => v.toLowerCase()));
  const actionWords = new Set(Object.entries(words).filter(([k, v]) => /^PF2E\.Actions\.\w+\.Title$/.test(k) && !/\s/.test(v)).map(([, v]) => v.toLowerCase()));
  const skillWords = new Set(["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism",
    "performance", "religion", "society", "stealth", "survival", "thievery", "fortitude", "reflex", "will", "perception", "lore"]);
  const shapeWords = { traits: traitWords, actions: actionWords, skills: skillWords };

  const creatures = new Map();
  const characters = new Map();
  const reactions = [];
  const stats = { creatureActors: 0, coreActors: 0, creaturePacks: 0, skippedActors: {}, characterItems: 0, coreCharacterItems: 0, pregens: 0, pregenOnly: new Set() };

  /** A reaction (or a free action with a trigger) filed by its Trigger line. */
  const fileTrigger = (side, r, expanded, { name = "", kinds = [], core }) => {
    if ( !(r.type === "reaction" || (r.type === "free" && r.signals.has("trigger"))) ) return;
    const m = /<strong>\s*Trigger\s*<\/strong>([\s\S]*?)(?:<\/p>|<hr|<strong>)/i.exec(expanded);
    const text = m ? h.coreApi.plainText(m[1].replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (x, label) => label ?? "")) : "";
    const norm = text ? normalizeTrigger(text, { name, kinds }) : "";
    const filed = norm ? refineTrigger(classifyTrigger(norm), h.coreApi.plainText(expanded)) : null;
    reactions.push({ side, slug: r.slug, full: r.level === "full", core, trigger: filed?.trigger ?? null, pattern: filed?.pattern ?? null, also: filed?.also ?? [],
      shape: filed || !norm ? null : shapeOf(norm, shapeWords), none: !norm });
  };

  // Creatures.
  for ( const p of packs.filter(x => x.type === "Actor" && !NOT_CREATURE_PACKS.has(x.name)) ) {
    const docs = await readPack(o.pf2e, p.path, ClassicLevel);
    let any = false;
    const core = CORE_CREATURE_PACKS.has(p.name);
    for ( const { actor, items } of actorsOf(docs) ) {
      if ( actor.type !== "npc" ) { bump(stats.skippedActors, actor.type); continue; }
      any = true;
      stats.creatureActors++;
      if ( core ) stats.coreActors++;
      const sys = actor.system ?? {};
      const melee = items.filter(i => i.type === "melee").map(i => ({ name: i.name,
        damage: h.coreApi.parseTypedFormula(Object.values(i.system?.damageRolls ?? {}).map(d => `(${d.damage})[${d.damageType}]`).join(" + ")) }));
      const referenced = new Set(items.filter(i => i.type === "melee").flatMap(i => i.system?.attackEffects?.value ?? []));
      const skills = Object.fromEntries(Object.entries(sys.skills ?? {}).map(([k, v]) => [k, Number(v?.base ?? v?.value)]));
      const ctx = { character: false, level: Number(sys.details?.level?.value) || 0, abilities: sys.abilities, skills, senses: sys.perception?.senses ?? [], items, melee, referenced,
        shield: items.some(i => i.type === "shield") };
      const seen = new Set();
      for ( const item of items ) {
        if ( !["action", "feat"].includes(item.type) ) continue;
        const expanded = expand(descriptionOf(item));
        const r = classify(item, { ...ctx, expanded });
        if ( !r.slug || seen.has(r.slug) ) continue;
        seen.add(r.slug);
        record(creatures, r, { core, kind: item.system?.category ?? item.type, traits: item.system?.traits?.value });
        fileTrigger("creature", r, expanded, { name: actor.name, kinds: sys.traits?.value ?? [], core });
      }
    }
    if ( any ) stats.creaturePacks++;
  }

  // Characters: the compendiums, each item once.
  const pregenCount = {};
  for ( const name of PREGEN_PACKS ) {
    for ( const { actor, items } of actorsOf(await read(name)) ) {
      if ( actor.type !== "character" ) continue;
      stats.pregens++;
      for ( const slug of new Set(items.filter(i => ["feat", "action"].includes(i.type)).map(slugOf).filter(Boolean)) ) bump(pregenCount, slug);
    }
  }
  const counted = slug => pregenCount[slug] ?? 0;
  for ( const [name, kind] of Object.entries(CHARACTER_PACKS) ) {
    for ( const item of itemsOf(await read(name)) ) {
      if ( !["feat", "action"].includes(item.type) ) continue;
      const core = CORE_TITLES.has(item.system?.publication?.title ?? "");
      const expanded = expand(descriptionOf(item));
      const r = classify(item, { character: true, level: Number(item.system?.level?.value) || 1, expanded });
      if ( !r.slug ) continue;
      stats.characterItems++;
      if ( core ) stats.coreCharacterItems++;
      const category = item.type !== "feat" ? kind
        : { classfeature: "class feature", ancestryfeature: "ancestry feature" }[item.system?.category] ?? `${item.system?.category ?? "other"} feat`;
      const e = record(characters, r, { core, kind: category, traits: item.system?.traits?.value });
      e.rank = Math.min(e.rank ?? 99, Number(item.system?.level?.value) || 0);
      e.weight = counted(r.slug);
      fileTrigger("character", r, expanded, { core });
    }
  }
  for ( const slug of Object.keys(pregenCount) ) if ( !characters.has(slug) ) stats.pregenOnly.add(slug);

  // What the scripts mention and the tables mirror (the drift check).
  const source = readdirSync(join(REPO, "scripts")).filter(f => f.endsWith(".js")).map(f => readFileSync(join(REPO, "scripts", f), "utf8")).join("\n");
  const literals = new Set([...source.matchAll(/["']([a-z0-9]+(?:-[a-z0-9]+)+)["']/g)].map(m => m[1]));
  const mirrored = [...Object.keys(KNOWN).filter(slug => KNOWN[slug] !== "spells"), ...HINTS];
  const stale = mirrored.filter(slug => !source.includes(`"${slug}"`) && !source.includes(`${slug}:`));
  const fullSomewhere = new Set([...creatures.values(), ...characters.values()].filter(e => e.levels.full).map(e => e.slug));
  const unmirrored = [...literals].filter(s => (creatures.has(s) || characters.has(s)) && !fullSomewhere.has(s) && !HINTS.has(s) && !NOT_ABILITIES.has(s)).sort();

  return { manifest, creatures, characters, reactions, stats, stale, unmirrored, master: h.master, coreDir: o.core };
}

/* -------------------------------------------- */
/*  The report                                  */
/* -------------------------------------------- */

/** The triggers the engine checks today: the core's docs/reaction-triggers.md, "The engine today" (its master ids). */
function engineMoments(coreDir) {
  const file = join(coreDir, "..", "docs", "reaction-triggers.md");
  const fallback = ["attacked", "allyTargeted", "hit", "wouldTakeDamage", "missed", "damaged", "allyHit", "wouldDrop", "slain", "foeCasts", "foeLeavesReach", "foeOpening", "foeMovesInReach", "allyMoves", "foeApproaches"];
  if ( !existsSync(file) ) return new Set(fallback);
  const text = readFileSync(file, "utf8");
  const at = text.indexOf("## The engine today");
  if ( at < 0 ) return new Set(fallback);
  const out = new Set();
  for ( const line of text.slice(at).split("\n").slice(1) ) {
    if ( /^## /.test(line) ) break;
    const cells = line.split("|");
    if ( cells.length > 3 ) for ( const m of cells[2].matchAll(/`(\w+)`/g) ) out.add(m[1]);
  }
  return out.size ? out : new Set(fallback);
}

const esc = s => String(s).replace(/\|/g, "\\|");
const row = cells => `| ${cells.map(esc).join(" | ")} |`;

/**
 * A totals row: its slugs by the level most of their instances have, and its instances weighed (`weightOf(e, level)`).
 * @param {boolean} core   only the free remaster core's instances
 */
function totalsRow(label, list, weightOf, core = false) {
  const d = { full: 0, part: 0, none: 0, plumbing: 0 };
  const w = { full: 0, part: 0, none: 0, plumbing: 0 };
  let n = 0;
  for ( const e of list ) {
    d[levelOf(e, core)]++;
    n++;
    for ( const k of LEVELS ) w[k] += weightOf(e, k);
  }
  const wn = LEVELS.reduce((s, k) => s + w[k], 0);
  return row([label, n, pct(d.full, n), pct(d.part, n), pct(d.none, n), pct(d.plumbing, n), Math.round(wn), pct(w.full, wn), pct(w.part, wn), pct(w.none, wn), pct(w.plumbing, wn)]);
}

/** A slug's structure, for the gap tables: its signals and notes in at least a third of its instances. */
const structure = e => {
  const n = e.count;
  const sig = Object.entries({ ...e.signals, ...e.notes }).filter(([, v]) => v >= Math.max(1, n / 3)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return sig.length ? sig.join(", ") : "none";
};
const typeOf = e => top(e.types, 2).join("/");

export function render(scan, { version, moduleVersion, commit, date }) {
  const { creatures, characters, reactions, stats } = scan;
  const moments = engineMoments(scan.coreDir);
  const groupOf = {};
  for ( const [group, ids] of Object.entries(scan.master.REACTION_TRIGGERS) ) for ( const id of ids ) groupOf[id] = group;
  const out = [];
  const say = (...lines) => out.push(...lines);
  const C = [...creatures.values()];
  const P = [...characters.values()];
  const instances = (e, k) => e.levels[k];
  const coreInstances = (e, k) => e.coreLevels[k];
  // (A character option's weight, the pregens carrying its slug, shared among its copies by their levels.)
  const carried = (e, k) => (e.count ? (e.levels[k] * e.weight) / e.count : 0);
  const carriedCore = (e, k) => (e.core ? (e.coreLevels[k] * e.weight) / e.count : 0);

  say("# PF2e coverage", "",
    `Generated by \`node tools/coverage.mjs --out docs/coverage.md\` on ${date}: PF2e ${version}, FastFighting PF2e ${moduleVersion} (its scripts at ${commit}). The tool's header says how it reads the packs and what it approximates.`, "",
    "How much of what PF2e's creatures and characters can do the helper understands, by slug, sorted by how often each turns up.",
    "",
    "- **Fully:** the helper builds an engine action, reaction or flag from it: a slug it knows, a reader that handles it (save abilities, gullets, Strike riders, self-effects, fast healing, senses), or rule elements PF2e works into the numbers the helper reads off the sheet.",
    "- **Partly:** it has structure the helper could read but doesn't: inline `@Damage`, `@Check` or `@Template`, an inline roll or action link, other rule elements, a frequency, a trigger, an effect or condition link.",
    "- **Not at all:** none of that.",
    "- **Plumbing:** its only rules grant or choose other items (each scanned in its own right).",
    "",
    "This file holds slugs, item types, traits, counts and categories only, never an item's description or rules text. **Core** is the free remaster core: Monster Core for creatures, Player Core for characters.",
    "");

  // Totals.
  say("## Totals", "",
    `Creatures: ${stats.creatureActors} npc actors in ${stats.creaturePacks} packs (${stats.coreActors} in Monster Core); left out: ${Object.entries(stats.skippedActors).map(([k, v]) => `${v} ${k}`).join(", ")}, and the pregenerated characters. Characters: ${stats.characterItems} feats, class features, actions and ancestry features (${stats.coreCharacterItems} from Player Core), weighed by ${stats.pregens} pregenerated characters.`, "",
    "| scope | slugs | fully | partly | not | plumbing | weighed | fully | partly | not | plumbing |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    totalsRow("Creature abilities, all (weighed per creature)", C, instances),
    totalsRow("Creature abilities, Monster Core", C.filter(e => e.core), coreInstances, true),
    totalsRow("Character options, all (weighed per pregen carrying it)", P, carried),
    totalsRow("Character options, Player Core", P.filter(e => e.core), carriedCore, true),
    "", "A slug's level is the one most of its instances have. The weighed columns count each creature that has the ability (each pregenerated character that carries the option).", "");

  const howTable = (list, label) => {
    const how = {};
    const sig = {};
    for ( const e of list ) {
      for ( const [k, v] of Object.entries(e.how) ) bump(how, k, v);
      if ( e.levels.part ) for ( const [k, v] of Object.entries(e.signals) ) bump(sig, k, Math.min(v, e.levels.part));
    }
    say(`### ${label}`, "", "| fully understood by | instances |", "|---|---|", ...Object.entries(how).sort((a, b) => b[1] - a[1]).map(([k, v]) => row([k, v])), "");
    say("| structure in the partly understood | instances (about) |", "|---|---|", ...Object.entries(sig).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => row([k, v])), "");
  };
  howTable(C, "Creatures: how, and what's left");
  howTable(P, "Characters: how, and what's left");

  // Gaps.
  const gap = e => e.levels.part + e.levels.none;
  // (A gap: a slug most of whose instances the helper doesn't fully understand.)
  const open = e => gap(e) > 0 && levelOf(e) !== "full";
  say("## Top gaps: creatures", "", "Creature abilities by how many creatures have them and the helper doesn't fully understand. Structure: what at least a third of them carry (a note in it: `glossary`, a standard ability PF2e's glossary describes; `requirements`, a precondition the reader skips).", "",
    "| # | slug | creatures | not fully | in core | level | type | traits | structure |", "|---|---|---|---|---|---|---|---|---|");
  C.filter(open).sort((a, b) => gap(b) - gap(a) || a.slug.localeCompare(b.slug)).slice(0, 30).forEach((e, i) => say(row([i + 1, `\`${e.slug}\``, e.count, gap(e), e.core,
    SAID[levelOf(e)], typeOf(e), top(e.traits, 3, Math.max(0, e.count / 4 - 1)).join(", ") || "-", structure(e)])));
  // (The free remaster core first: Monster Core's own gaps, by its creatures alone.)
  const coreGap = e => e.coreLevels.part + e.coreLevels.none;
  const coreOpen = C.filter(e => coreGap(e) > 0 && levelOf(e, true) !== "full").sort((a, b) => coreGap(b) - coreGap(a) || a.slug.localeCompare(b.slug));
  say("", `Monster Core alone: ${coreOpen.length} slugs not fully understood, led by ${coreOpen.slice(0, 15).map(e => `\`${e.slug}\` (${coreGap(e)})`).join(", ")}.`);
  // (A character's passive options are mostly out of a fight, skill feats above all: its actions come first.)
  const active = e => top(e.types, 1)[0] !== "passive";
  const byCarried = (a, b) => b.weight - a.weight || b.core - a.core || (a.rank ?? 0) - (b.rank ?? 0) || a.slug.localeCompare(b.slug);
  const passives = P.filter(e => open(e) && e.weight > 0 && !active(e)).sort(byCarried);
  say("", "## Top gaps: characters", "", "Character actions, reactions and free actions the helper doesn't fully understand, by how many pregenerated characters carry them (then Player Core first, then the lowest level).", "",
    "| # | slug | pregens | core | level | category | type | structure |", "|---|---|---|---|---|---|---|---|");
  P.filter(e => open(e) && e.weight > 0 && active(e)).sort(byCarried).slice(0, 15)
    .forEach((e, i) => say(row([i + 1, `\`${e.slug}\``, e.weight, e.core ? "yes" : "no", SAID[levelOf(e)], top(e.kinds, 1).join(""), typeOf(e), structure(e)])));
  say("", `Passive options not fully understood: ${passives.length} the pregenerated characters carry, led by ${passives.slice(0, 8).map(e => `\`${e.slug}\` (${e.weight}, ${top(e.kinds, 1).join("")})`).join(", ")}.`, "");

  // Reaction triggers.
  const byTrigger = {};
  const slot = id => (byTrigger[id] ??= { creature: 0, creatureFull: 0, creatureCore: 0, slugs: new Set(), character: 0, characterFull: 0, patterns: {} });
  let filed = 0;
  let total = 0;
  for ( const r of reactions ) {
    total++;
    if ( !r.trigger ) continue;
    filed++;
    const s = slot(r.trigger);
    if ( r.side === "creature" ) {
      s.creature++;
      if ( r.full ) s.creatureFull++;
      if ( r.core ) s.creatureCore++;
      s.slugs.add(r.slug);
    } else {
      s.character++;
      if ( r.full ) s.characterFull++;
    }
    bump(s.patterns, r.pattern);
  }
  const creatureTotal = reactions.filter(r => r.side === "creature").length;
  const characterTotal = reactions.length - creatureTotal;
  say("## Reaction triggers", "",
    `${total} reactions and free actions with a trigger (${creatureTotal} on creatures, counted per creature; ${characterTotal} character options, each once). The grammar in \`tools/coverage-triggers.mjs\` files ${filed} of them (${pct(filed, total)}) under the core's master triggers (\`REACTION_TRIGGERS\`). "Engine" marks the triggers the engine checks today (the core's docs/reaction-triggers.md); "plays" counts the reactions the helper fully understands.`, "",
    "### Coverage by trigger", "",
    "| trigger | group | engine | creature reactions | distinct slugs | in core | plays | character options | plays | main pattern |", "|---|---|---|---|---|---|---|---|---|---|");
  const ids = Object.keys(byTrigger).sort((a, b) => (byTrigger[b].creature + byTrigger[b].character) - (byTrigger[a].creature + byTrigger[a].character) || a.localeCompare(b));
  for ( const id of ids ) {
    const s = byTrigger[id];
    say(row([`\`${id}\``, groupOf[id] ?? "?", moments.has(id) ? "yes" : "", s.creature, s.slugs.size, s.creatureCore, s.creatureFull, s.character, s.characterFull, top(s.patterns, 1).join("")]));
  }
  const unfiled = reactions.filter(r => !r.trigger);
  say(row(["(unfiled)", "", "", unfiled.filter(r => r.side === "creature").length, new Set(unfiled.filter(r => r.side === "creature").map(r => r.slug)).size,
    unfiled.filter(r => r.side === "creature" && r.core).length, unfiled.filter(r => r.side === "creature" && r.full).length, unfiled.filter(r => r.side === "character").length,
    unfiled.filter(r => r.side === "character" && r.full).length, ""]), "");
  const quiet = Object.keys(groupOf).filter(id => !byTrigger[id] && /^(?:atSelf|atAlly|foeAction|movement|magic|social|turnRound|other)$/.test(groupOf[id]));
  if ( quiet.length ) say(`No PF2e reaction filed under: ${quiet.map(id => `\`${id}\``).join(", ")}.`, "");

  const patterns = {};
  for ( const r of reactions ) if ( r.pattern ) {
    const p = (patterns[r.pattern] ??= { trigger: r.trigger, creature: 0, character: 0, also: {} });
    p[r.side]++;
    for ( const a of r.also ) bump(p.also, a);
  }
  say("### Patterns that file the most", "", "The grammar's own pattern names (its first match decides; the triggers its later matches find are listed as \"also\").", "",
    "| pattern | trigger | creature reactions | character options | also |", "|---|---|---|---|---|");
  Object.entries(patterns).sort((a, b) => (b[1].creature + b[1].character) - (a[1].creature + a[1].character) || a[0].localeCompare(b[0])).slice(0, 20)
    .forEach(([name, p]) => say(row([name, `\`${p.trigger}\``, p.creature, p.character, top(p.also, 3, Math.max(1, (p.creature + p.character) / 10)).map(t => `\`${t}\``).join(", ") || "-"])));
  const shapes = {};
  for ( const r of unfiled ) if ( r.shape ) bump(shapes, r.shape);
  const singles = Object.values(shapes).filter(v => v === 1).length;
  say("", "### Unfiled trigger shapes", "", `The lines the grammar doesn't file, as shapes: every word but a short list of structural ones replaced (\`<self>\` the reacting creature, \`<creature>\`, \`<ally>\`, \`<range>\`, \`<trait>\`, \`<condition>\`, \`<action>\`, \`<skill>\`, \`<n>\`, and \`<x>\` for any other word). ${Object.keys(shapes).length} shapes, ${singles} of them seen once; ${unfiled.filter(r => r.none).length} reactions have no trigger line at all.`, "",
    "| shape | reactions |", "|---|---|");
  Object.entries(shapes).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).forEach(([k, v]) => say(row([`\`${k}\``, v])));
  say("");

  // What to teach next.
  say("## What to teach next", "", ...teachNext(scan, byTrigger, moments), "");

  // Notes.
  say("## Notes and approximations", "", ...[
    "- The helper's own pure functions run on each item's data where they can (see the tool's header). What can't be called is mirrored in the tool (`KNOWN`, `ENGINE_ACTIONS`, `HINTS`, `NOT_SENSES`); `PATTERNS` is the tool's own.",
    "- Formulas: PF2e works out an item's `@Check` DCs and `@Damage` formulas for its actor before the helper reads them. The tool fills an `@Check` with no DC with the GM Core DC for the level, and an `@Damage` formula's `@actor.level` with the level and an attribute modifier with +4, then works out the arithmetic. Character options are read at their own level.",
    "- Self-effects are read from the effect packs, as if every player could open them (the helper checks the pack's permission).",
    "- \"PF2e's numbers\" assumes PF2e applies a rule element with no predicate to the sheet, and a Strike's attack or damage rule whose predicate names only the weapon or the character's features to that Strike (the helper reads each Strike's modifier and damage formula from PF2e). Any other predicate is counted as structure (`(when)`). A sense counts when the creature's sheet lists it and the helper maps it; Shield Block and Reactive Shield count on a creature that has a shield.",
    "- A creature's slug is counted once per creature; the same creature in two packs (a Bestiary and Monster Core) counts twice. Hazards, vehicles, armies and the pregenerated characters' own items are left out; spells, Strikes and gear aren't scanned.",
    "- Trigger lines are read with PF2e's glossary text filled in (`@Localize`), and the creature's own name read as \"you\". The grammar is keyword patterns, first match wins; a line it files under the wrong trigger is possible, and the unfiled shapes show what it misses.",
    `- Setup hints: ${C.concat(P).filter(e => e.notes["setup hint"] && levelOf(e) !== "full").length} slugs the helper reads only to set a character up (auto.js, traits.js) are noted as \`setup hint\`, not counted as understood.`,
    stats.pregenOnly.size ? `- ${stats.pregenOnly.size} slugs the pregenerated characters carry aren't in the character compendiums (renamed or older copies): weighed nowhere.` : "",
    scan.stale.length ? `- Drift: mirrored slugs the scripts no longer mention: ${scan.stale.map(s => `\`${s}\``).join(", ")}. Update the tool's tables.` : "- Drift: every mirrored slug is still in the scripts.",
    scan.unmirrored.length ? `- Drift: slugs the scripts mention that the scan finds but never counts as understood (check whether the tool should know them): ${scan.unmirrored.slice(0, 30).map(s => `\`${s}\``).join(", ")}.` : ""
  ].filter(Boolean));
  return `${out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim()}\n`;
}

/**
 * What to teach next, from the numbers: the busiest gaps by slug, the readers that would cover the most, and the
 * busiest triggers the engine doesn't check yet.
 */
function teachNext(scan, byTrigger, moments) {
  const C = [...scan.creatures.values()];
  const gap = e => e.levels.part + e.levels.none;
  const open = e => gap(e) > 0 && levelOf(e) !== "full";
  const sum = (list, f) => list.reduce((s, e) => s + f(e), 0);
  const lines = [];
  // (What most of a slug's instances are and carry: a third of them, as the gap tables read it.)
  const has = (e, k) => ((e.signals[k] ?? 0) + (e.notes[k] ?? 0)) >= e.count / 3;
  const typed = (e, t) => top(e.types, 1)[0] === t;
  const lead = list => list.sort((a, b) => gap(b) - gap(a) || a.slug.localeCompare(b.slug)).slice(0, 4).map(e => `\`${e.slug}\``).join(", ");
  const glossary = C.filter(e => open(e) && has(e, "glossary")).sort((a, b) => gap(b) - gap(a) || a.slug.localeCompare(b.slug));
  const acts = glossary.filter(e => !typed(e, "passive")).slice(0, 6);
  const passive = glossary.filter(e => typed(e, "passive")).slice(0, 6);
  if ( glossary.length ) lines.push(`1. **Standard abilities by slug** (PF2e's glossary describes them, so one slug covers every creature). Actions and reactions: ${acts.map(e => `\`${e.slug}\` (${gap(e)})`).join(", ")}. Passives: ${passive.map(e => `\`${e.slug}\` (${gap(e)})`).join(", ")}.`);
  const auras = C.filter(e => open(e) && has(e, "rules: Aura") && has(e, "@Check save"));
  if ( auras.length ) lines.push(`2. **Auras with a save** (an \`Aura\` rule element and an \`@Check\` save, passive, so the save reader skips them): ${auras.length} slugs, ${sum(auras, gap)} creatures, led by ${lead(auras)}.`);
  const reqs = C.filter(e => open(e) && has(e, "requirements") && (has(e, "@Check save") || has(e, "@Damage")) && typed(e, "action"));
  if ( reqs.length ) lines.push(`3. **Save or damage abilities with requirements** (the reader refuses any action with a Requirements line): ${reqs.length} slugs, ${sum(reqs, gap)} creatures, led by ${lead(reqs)}.`);
  const dmgOnly = C.filter(e => open(e) && has(e, "@Damage") && !has(e, "@Check save") && typed(e, "action"));
  if ( dmgOnly.length ) lines.push(`4. **Damage with no save** (an \`@Damage\` and no save: automatic damage or a Strike's extra): ${dmgOnly.length} slugs, ${sum(dmgOnly, gap)} creatures, led by ${lead(dmgOnly)}.`);
  const when = C.filter(e => open(e) && Object.keys(e.signals).some(k => / \(when\)$/.test(k) && has(e, k)) && typed(e, "passive"));
  if ( when.length ) lines.push(`5. **Situational bonuses** (a rule element PF2e applies only when its predicate holds, such as a bonus to saves against magic): ${when.length} slugs, ${sum(when, gap)} creatures, led by ${lead(when)}.`);
  const live = Object.entries(byTrigger).filter(([id]) => moments.has(id)).map(([id, s]) => [id, s.creature - s.creatureFull]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if ( live.length ) lines.push(`6. **Reactions on a trigger the engine already checks** but the helper doesn't map: ${live.map(([id, n]) => `\`${id}\` (${n})`).join(", ")} creature reactions; each needs only its effect read.`);
  const next = Object.entries(byTrigger).filter(([id]) => !moments.has(id)).map(([id, s]) => [id, s.creature + s.character]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if ( next.length ) lines.push(`7. **Busiest triggers with no engine moment yet:** ${next.map(([id, n]) => `\`${id}\` (${n})`).join(", ")}: a core hook each.`);
  const core = [...scan.characters.values()].filter(e => open(e) && e.core && !typed(e, "passive"))
    .sort((a, b) => b.weight - a.weight || (a.rank ?? 0) - (b.rank ?? 0) || a.slug.localeCompare(b.slug));
  if ( core.length ) lines.push(`8. **Player Core actions, reactions and free actions** not yet understood: ${core.length} slugs, the pregenerated characters' most carried first: ${core.slice(0, 6).map(e => `\`${e.slug}\` (${e.weight})`).join(", ")}.`);
  return lines;
}

/* -------------------------------------------- */
/*  Main                                        */
/* -------------------------------------------- */

async function main() {
  const o = options(process.argv.slice(2));
  const result = await scan(o);
  const git = args => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); } catch ( err ) { return ""; } };
  const own = JSON.parse(readFileSync(join(REPO, "module.json"), "utf8"));
  // (The scripts it read: a commit, and whether they had changes not yet committed.)
  const dirty = git(["status", "--porcelain", "--", "scripts"]) ? " with uncommitted changes" : "";
  const text = render(result, { version: result.manifest.version, moduleVersion: own.version, commit: `git ${git(["rev-parse", "--short", "HEAD"]) || "?"}${dirty}`,
    date: new Date().toISOString().slice(0, 10) });
  if ( o.out ) {
    const file = resolve(process.cwd(), o.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.error(`coverage | wrote ${file}`);
  } else process.stdout.write(text);
}

if ( process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href ) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
