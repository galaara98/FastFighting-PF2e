/**
 * FastFighting PF2e: teaches FastFighting Core how Pathfinder Second Edition works.
 * Registers the PF2e adapter (actor data, rules, personality defaults, leadership, afflictions,
 * live battles) through the core's public API.
 */
import { Pf2eAdapter } from "./adapter.js";
import { hideApply, hideApplyMenu } from "./cards.js";
import { loadReading } from "./reading.js";

/**
 * The core API majors this helper is known to work with (the core's api.major). Its own call: the core never refuses a
 * helper. Older than the oldest, it doesn't run (it uses what came since); any other it doesn't know, it runs, and the
 * GM is told it hasn't been tried with that core yet. Add a major once this helper has been tried with it.
 */
const KNOWN_API = Object.freeze([21, 22, 23, 24, 25, 26, 27, 28]);

/** The core's API major, when it's one this helper doesn't know: the GM is told when the world is ready. */
let untested = null;

/**
 * The last translation module we knew of for this game system, by language: in a language other than English, this
 * module's settings recommend it when it isn't on (FastFighting Core's api.adviseTranslation).
 */
const KNOWN_TRANSLATIONS = {
  es: { id: "pf2e-es", title: "Translation: Spanish [PF2E] [UNOFFICIAL]", url: "https://github.com/allnnde/pf2e-esp-translation" }
};

const MODULE_ID = "fast-fighting-pf2e";

/**
 * The Lore-Collector's advantage was this module's own setting (fast-fighting-pf2e.loreBoost) until the core's took
 * its place (API 28): a value a GM set here goes to the core's, once, where the core's has none of its own yet.
 */
function moveLoreBoost() {
  if ( !game.user.isGM ) return;
  const world = game.settings.storage?.get?.("world");
  const ours = world?.getSetting?.(`${MODULE_ID}.loreBoost`);
  if ( !ours || world.getSetting("fast-fighting.loreBoost") ) return;
  const value = Number(ours.value);
  if ( Number.isFinite(value) ) game.settings.set("fast-fighting", "loreBoost", value);
}

// The damage cards FastFighting rolls and applies itself: no Apply on them, which would apply them again (cards.js).
Hooks.on("renderChatMessageHTML", hideApply);
Hooks.on("getChatMessageContextOptions", hideApplyMenu);

Hooks.once("fastFighting.init", api => {
  // module.json limits this module to PF2e worlds; this guard covers anything that slips past.
  if ( game.system.id !== "pf2e" ) {
    console.warn(`${MODULE_ID} | not a Pathfinder Second Edition world (${game.system.id}); FastFighting PF2e stays inactive.`);
    return;
  }
  const major = Number(api.major) || 0;
  if ( major < Math.min(...KNOWN_API) ) {
    console.error(`${MODULE_ID} | FastFighting Core is too old for this version of FastFighting PF2e; update it.`);
    ui.notifications?.error(game.i18n.localize("FFPF2E.CoreTooOld"), { permanent: true });
    return;
  }
  if ( !KNOWN_API.includes(major) ) untested = major;
  api.registerAdapter("pf2e", Pf2eAdapter, { priority: 10, source: MODULE_ID });
  // The words PF2e's own text is read by, where its data says nothing (reading.js).
  loadReading();
  api.adviseTranslation(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS);
  // Words kept in English for now, while the system isn't translated (hardcoded-toEN.json).
  api.keepEnglish(MODULE_ID);
});

Hooks.once("ready", () => {
  if ( untested !== null && game.user.isGM ) ui.notifications.warn(game.i18n.format("FFPF2E.CoreUntested", { major: untested }));
  moveLoreBoost();
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFPF2E.NeedsCore"));
  }
});
