import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// In Foundry the core lives at Data/modules/fast-fighting next to this module. For tests, point that path at
// the FastFighting core repository checked out beside this one (override with FASTFIGHTING_CORE).
const core = process.env.FASTFIGHTING_CORE ?? fileURLToPath(new URL("../FastFighting/scripts/", import.meta.url));

// `vitest run --mode reworded` (npm run test:reworded): every word in the language files reworded (tests/foundry-i18n.js).
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+fast-fighting\/scripts\//, replacement: core.endsWith("/") || core.endsWith("\\") ? core : `${core}/` }]
  },
  test: {
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    env: { FASTFIGHTING_CORE: core, ...(mode === "reworded" ? { FASTFIGHTING_REWORD: "1" } : {}) },
    environment: "node"
  }
}));
