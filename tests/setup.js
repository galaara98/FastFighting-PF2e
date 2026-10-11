/**
 * Every test runs as a Foundry client in English would: game.i18n reads this module's languages/en.json and
 * FastFighting Core's, fresh for each test (a test may add to globalThis.game, or replace it, as it needs).
 */
import { beforeEach } from "vitest";
import { fakeI18n } from "./foundry-i18n.js";

const install = () => { globalThis.game = { i18n: fakeI18n() }; };
install();
beforeEach(install);
