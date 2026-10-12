/**
 * Every script loads in Foundry as an ES module: Node itself imports each one, so a script that doesn't parse, or asks
 * another for something it doesn't have (an import of a name the core doesn't export, an import and a function of the
 * same name), fails here as it would in Foundry. (The test runner's own module loader lets these through.) What a script
 * does when it runs needs Foundry, so an error from running it is expected and not counted.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = fileURLToPath(new URL("../scripts/", import.meta.url));
// In Foundry the core sits at Data/modules/fast-fighting beside a helper; here, the core repository (as the tests use it).
const core = process.env.FASTFIGHTING_CORE ?? fileURLToPath(new URL("../../FastFighting/scripts/", import.meta.url));
const scripts = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? scripts(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []));

describe("the scripts", () => {
  test("each loads as a module, with everything it imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "ff-load-"));
    try {
      const coreUrl = pathToFileURL(core.endsWith("/") || core.endsWith("\\") ? core : `${core}/`).href;
      writeFileSync(join(dir, "hooks.mjs"), `
export async function resolve(specifier, context, next) {
  const m = specifier.match(/^(?:\\.\\.\\/)+fast-fighting\\/scripts\\/(.*)$/);
  return next(m ? new URL(m[1], ${JSON.stringify(coreUrl)}).href : specifier, context);
}`);
      writeFileSync(join(dir, "load.mjs"), `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(${JSON.stringify(join(dir, "hooks.mjs"))}).href);
const broken = [];
for ( const file of ${JSON.stringify(scripts(root))} ) {
  try {
    await import(pathToFileURL(file).href);
  } catch ( err ) {
    // (Parsing and linking fail before anything runs: those are the ones that stop a module loading.)
    if ( err instanceof SyntaxError || /^ERR_(MODULE_NOT_FOUND|UNSUPPORTED|INVALID)/.test(err?.code ?? "") ) broken.push(file + ": " + err.message);
  }
}
process.stdout.write("@@BROKEN@@" + JSON.stringify(broken));
process.exit(0);`);
      const out = execFileSync(process.execPath, [join(dir, "load.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      expect(JSON.parse(out.slice(out.lastIndexOf("@@BROKEN@@") + "@@BROKEN@@".length))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
