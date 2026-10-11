/**
 * FastFighting PF2e: teaches FastFighting Core how Pathfinder Second Edition works.
 * Registers the PF2e adapter (actor data, rules, personality defaults, leadership, afflictions,
 * Make it So) through the core's public API.
 */
import { Pf2eAdapter } from "./adapter.js";
import { registerLoreBoost } from "./lore.js";

/** The core API this helper is written against (older cores have no api.version: that is 1). */
const NEEDS_API = 9;

/**
 * The last translation module we knew of for this game system, by language: in a language other than English, this
 * module's settings recommend it when it isn't on (FastFighting Core's api.adviseTranslation).
 */
const KNOWN_TRANSLATIONS = {
  es: { id: "pf2e-es", title: "Translation: Spanish [PF2E] [UNOFFICIAL]", url: "https://github.com/allnnde/pf2e-esp-translation" }
};

export const MODULE_ID = "fast-fighting-pf2e";

Hooks.once("init", () => {
  // How much a Lore-Collector's sizing a foe up pays off (lore.js).
  registerLoreBoost();
});

Hooks.once("fastFighting.init", api => {
  // module.json limits this module to PF2e worlds; this guard covers anything that slips past.
  if ( game.system.id !== "pf2e" ) {
    console.warn(`${MODULE_ID} | not a Pathfinder Second Edition world (${game.system.id}); FastFighting PF2e stays inactive.`);
    return;
  }
  if ( (api.version ?? 1) < NEEDS_API ) {
    console.error(`${MODULE_ID} | FastFighting Core is too old for this version of FastFighting PF2e; update it.`);
    ui.notifications?.error(game.i18n.localize("FFPF2E.CoreTooOld"), { permanent: true });
    return;
  }
  api.registerAdapter("pf2e", Pf2eAdapter, { priority: 10, source: MODULE_ID });
  api.adviseTranslation?.(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS);
  // Words kept in English for now, while the system isn't translated (hardcoded-toEN.json).
  api.keepEnglish?.(MODULE_ID);
});

Hooks.once("ready", () => {
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFPF2E.NeedsCore"));
  }
});
