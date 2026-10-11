import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { own, flatten } from "./foundry-i18n.js";

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const manifest = read("module.json");
/** This module's key prefix ("FFPF2E"). */
const PREFIX = Object.keys(read("languages/en.json"))[0];
const placeholders = s => [...new Set(String(s).match(/\{[a-zA-Z]+\}/g) ?? [])].sort();

/** Every .js file under a folder. */
function sources(dir) {
  const url = new URL(`../${dir}/`, import.meta.url);
  return readdirSync(url).flatMap(f => (statSync(new URL(f, url)).isDirectory() ? sources(`${dir}/${f}`) : f.endsWith(".js") ? [`${dir}/${f}`] : []));
}
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("the language files", () => {
  test("every language the module lists has a file with only English's keys, and the same placeholders", () => {
    expect(manifest.languages.map(l => l.lang)).toContain("en");
    for ( const { lang, path } of manifest.languages ) {
      const other = flatten(read(path));
      expect([lang, Object.keys(other).filter(k => !(k in own))]).toEqual([lang, []]);
      for ( const k of Object.keys(other) ) expect([lang, k, placeholders(other[k])]).toEqual([lang, k, placeholders(own[k])]);
    }
  });

  test("no language file is left out of the manifest", () => {
    const listed = manifest.languages.map(l => l.path);
    const files = readdirSync(new URL("../languages/", import.meta.url)).filter(f => f.endsWith(".json")).map(f => `languages/${f}`);
    expect(files.filter(f => !listed.includes(f))).toEqual([]);
  });

  test("the code holds no English: nothing beside a key for when it has no words", () => {
    // t("Key", "English"), localize("KEY", "English") and the like: the English belongs in languages/en.json.
    const call = /\b(localize|t|outcomeLine)\(\s*(`[^`]*`|"[^"]*"|'[^']*'|[\w.$]+)\s*,\s*["'`]/g;
    const found = [];
    for ( const file of sources("scripts") ) for ( const m of source(file).matchAll(call) ) found.push(`${file}: ${m[0]}`);
    expect(found).toEqual([]);
  });

  test("each of this module's keys the code names is in languages/en.json (or names a group of keys)", () => {
    const missing = [];
    const keys = Object.keys(own);
    const has = key => key in own || keys.some(k => k.startsWith(`${key}.`));
    for ( const file of sources("scripts") ) {
      const code = source(file);
      // Its full keys ("FFPF2E.HeroPoints") and those t() completes (t("Reason.Pc") is FFPF2E.Reason.Pc).
      for ( const [key] of code.matchAll(new RegExp(`${PREFIX}(?:\\.[\\w-]+)+`, "g")) ) if ( !has(key) ) missing.push(`${file}: ${key}`);
      for ( const [, key] of code.matchAll(/\bt\(\s*["'`]([\w.-]+?)\.?(?:\$\{|["'`])/g) ) if ( !has(`${PREFIX}.${key}`) ) missing.push(`${file}: ${PREFIX}.${key}`);
    }
    expect(missing).toEqual([]);
  });
});
