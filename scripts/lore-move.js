/**
 * Temporary (tests/temporary/lore-move.test.js says until when): the Lore-Collector's advantage was this module's own
 * setting (fast-fighting-pf2e.loreBoost) until the core's took its place (core API 28). A value a GM set here goes to
 * the core's, once, where the core's has none of its own yet; with a core older than that, nothing.
 */
const MODULE_ID = "fast-fighting-pf2e";

export function moveLoreBoost() {
  if ( !game.user?.isGM || !game.settings.settings?.has?.("fast-fighting.loreBoost") ) return;
  const world = game.settings.storage?.get?.("world");
  const ours = world?.getSetting?.(`${MODULE_ID}.loreBoost`);
  if ( !ours || world.getSetting("fast-fighting.loreBoost") ) return;
  const value = Number(ours.value);
  if ( Number.isFinite(value) ) return game.settings.set("fast-fighting", "loreBoost", value);
}
