/**
 * FastFighting PF2e: teaches FastFighting Core how Pathfinder Second Edition works.
 * Registers the PF2e adapter (actor data, rules, personality defaults, leadership, afflictions,
 * Make it So) through the core's public API.
 */
import { Pf2eAdapter } from "./adapter.js";

/** The core API this helper is written against (older cores have no api.version: that is 1). */
const NEEDS_API = 4;

export const MODULE_ID = "fast-fighting-pf2e";

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
});

Hooks.once("ready", () => {
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFPF2E.NeedsCore"));
  }
});
