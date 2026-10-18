/**
 * Auras that make foes save (auras.js), read from item data shaped like PF2e's: the Aura rule element, the @Check, the
 * @Damage, the condition links by degree or on a failure, the glossary's standard auras by their text's call or their
 * slug. The descriptions here are this module's own words, shaped as PF2e's are.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { auraOf, degreesIn, failuresIn, timingIn, linkedConditions, glossaryOf, GLOSSARY_AURAS, MINUTE } from "../scripts/auras.js";
import { setReading } from "../scripts/reading.js";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { pf2eRules } from "../scripts/rules.js";
import { parseFormula } from "../scripts/core.js";
import { replay } from "../../fast-fighting/scripts/engine/simulator.js";

const english = JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8"));
const words = english.auras;
const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
const FRIGHTENED = "TBSHQspnbcqxsmjL";
const SICKENED = "fesd1n5eVhpCSS18";
const SLOWED = "xYTAsEpcJE1Ccni3";
const DAZZLED = "TkIyaNPgTZFBCCuh";
const BLINDED = "XgEqL1kFApUbl5Z2";

/** An aura as PF2e keeps one: passive, the aura trait, its Aura rule element. */
const ability = (over = {}) => ({
  id: "boss.item1", slug: "dread-shroud", name: "Dread Shroud", actionType: "passive", traits: ["aura", "emotion", "fear", "mental"],
  rules: [{ key: "Aura", radius: 40, slug: "dread-shroud", traits: ["emotion", "fear", "mental"] }], words, ...over
});

describe("condition links", () => {
  test("by the condition item's id, whatever the label; else by the label; its number the value; a hold as the engine has it", () => {
    expect(linkedConditions(`it is ${link(FRIGHTENED, "Scared Stiff 3")}`)).toEqual({ frightened: 3 });
    expect(linkedConditions(`${link(SICKENED, "Sickened 2")} and ${link(SLOWED, "Slowed")}`)).toEqual({ sickened: 2, slowed: 1 });
    expect(linkedConditions(`${link("kWc1fhmv9LBiTuei", "Grabbed")}`)).toEqual({ immobilized: 1, offGuard: 1 });
    expect(linkedConditions(`${link("unknownId0000000", "Off-Guard")}`)).toEqual({ offGuard: 1 });
    // (An attitude, or a link to anything but a condition: nothing it lays.)
    expect(linkedConditions(`${link("ud7gTLwPeklzYSXG", "Hostile")} @UUID[Compendium.pf2e.bestiary-effects.Item.abc]{Effect: Reek}`)).toEqual({});
  });
});

describe("a standard aura PF2e's glossary describes", () => {
  test("Frightful Presence called up by its text: Will, on coming in, frightened by degree, immune for a minute after any save", () => {
    const html = "<p>40 feet. @Check[will|dc:25|options:area-effect,inflicts:frightened]</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.FrightfulPresence]</p>";
    expect(glossaryOf(html)).toBe("frightful-presence");
    const aura = auraOf(ability({ html, slug: "frightful-presence", rules: [{ key: "Aura", radius: 40, slug: "frightful-presence", traits: ["emotion", "fear", "mental"] }] }));
    expect(aura).toMatchObject({
      id: "boss.item1", key: "frightful-presence", range: 40, save: { type: "will", dc: 25 }, when: "enter", immuneAfter: "save", immuneAll: false,
      immuneRounds: MINUTE, foesOnly: true
    });
    expect(aura.byDegree.map(o => o?.conditions ?? null)).toEqual([{ frightened: 4 }, { frightened: 2 }, { frightened: 1 }, null]);
    expect(aura.byDegree.map(o => o?.rounds ?? null)).toEqual([4, 2, 1, null]);
    expect(aura.traits).toEqual(expect.arrayContaining(["emotion", "fear", "mental"]));
    expect(aura.needs).toBeUndefined();
  });

  test("by its slug alone, where its text says nothing more than the save", () => {
    const aura = auraOf(ability({ html: "<p>30 feet. @Check[will|dc:20]</p>", slug: "frightful-presence" }));
    expect(aura).toMatchObject({ when: "enter", immuneAfter: "save", immuneRounds: MINUTE });
    expect(aura.byDegree[1].conditions).toEqual({ frightened: 2 });
  });

  test("Stench called up by its text: coming in or starting a turn there; a success, immune to every stench", () => {
    const html = "<p>30 feet. @Check[fortitude|dc:21]</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.Stench]</p>";
    const aura = auraOf(ability({ html, slug: "stench", traits: ["aura", "olfactory"], rules: [{ key: "Aura", radius: 30, slug: "stench", traits: ["olfactory"] }] }));
    expect(aura).toMatchObject({ key: "stench", when: "both", immuneAfter: "success", immuneAll: true, immuneRounds: MINUTE, needs: "smell" });
    expect(aura.byDegree.map(o => o?.conditions ?? null)).toEqual([{ sickened: 1, slowed: 1 }, { sickened: 1 }, null, null]);
    expect(aura.byDegree[1].rounds).toBe(MINUTE);
    expect(GLOSSARY_AURAS.stench.byDegree[2]).toBeNull();
  });
});

describe("an aura read from its own words", () => {
  test("a reek in its own words: its failure's links, a parenthesis about a critical failure on that alone, its immunity", () => {
    const html = `<p>15 feet. Anyone who enters the reek or starts its turn inside must attempt a @Check[fortitude|dc:19] save, becoming ${link(SICKENED, "Sickened 1")} on a failure (and ${link(SLOWED, "Slowed 1")} as well on a critical failure).</p>`
      + "<p>A creature that succeeds is immune to all such reeks for 1 minute.</p>";
    const aura = auraOf(ability({ html, slug: "rancid-reek", traits: ["aura", "olfactory"], rules: [{ key: "Aura", radius: 15, slug: "reek", traits: ["olfactory"] }] }));
    expect(aura).toMatchObject({ key: "reek", range: 15, when: "both", immuneAfter: "success", immuneAll: true, immuneRounds: MINUTE, needs: "smell" });
    expect(aura.byDegree.map(o => o?.conditions ?? null)).toEqual([{ sickened: 1, slowed: 1 }, { sickened: 1 }, null, null]);
  });

  test("degree lines: each degree's links; a critical failure whose words it can't read lays at least a failure's", () => {
    const html = "<p>20 feet. A creature that enters the glare must attempt a @Check[will|dc:21] save. Regardless of the result, it's immune to this glare for 1 minute.</p>"
      + "<p><strong>Critical Success</strong> Nothing happens.</p>"
      + `<p><strong>Success</strong> It's ${link(DAZZLED, "Dazzled")} for 1 round.</p>`
      + `<p><strong>Failure</strong> It's ${link(BLINDED, "Blinded")} for 1 round.</p>`
      + "<p><strong>Critical Failure</strong> It's blinded and can't see straight for 1 minute.</p>";
    expect(degreesIn(html, words).map(o => o?.conditions ?? null)).toEqual([{ blinded: 1 }, { blinded: 1 }, { dazzled: 1 }, null]);
    const aura = auraOf(ability({ html, traits: ["aura", "visual"], rules: [{ key: "Aura", radius: 20, slug: "glare", traits: ["visual"] }] }));
    expect(aura).toMatchObject({ when: "enter", immuneAfter: "save", immuneAll: false, immuneRounds: MINUTE, needs: "sight" });
  });

  test("a damaging aura: its @Damage with a basic save, on coming in and at a turn's start; never immune", () => {
    const html = "<p>10 feet. @Damage[3d6[fire]] damage (@Check[reflex|dc:24|basic] save)</p>";
    const aura = auraOf(ability({ html, slug: "searing-air", traits: ["aura", "fire", "primal"], rules: [{ key: "Aura", radius: 10, slug: "searing-air", traits: ["fire"] }] }));
    expect(aura).toMatchObject({ range: 10, save: { type: "reflex", dc: 24, basic: true }, when: "both", immuneAfter: null, magical: true });
    expect(aura.damage).toHaveLength(1);
    expect(aura.damage[0]).toMatchObject({ type: "fire" });
    expect(aura.byDegree).toEqual([null, null, null, null]);
  });

  test("its range: the rule element's radius; an emanation's template; else the feet its text opens with", () => {
    const save = "@Check[will|dc:20]";
    const lays = ` or become ${link(FRIGHTENED, "Frightened 1")}.`;
    expect(auraOf(ability({ html: `<p>Within @Template[emanation|distance:25] a creature must succeed at a ${save} save${lays}</p>`, rules: [] })).range).toBe(25);
    expect(auraOf(ability({ html: `<p>35 feet. A creature must succeed at a ${save} save${lays}</p>`, rules: [] })).range).toBe(35);
    expect(auraOf(ability({ html: `<p>A creature must succeed at a ${save} save${lays}</p>`, rules: [{ key: "Aura", radius: "ternary(lte(@actor.level, 5), 20, 40)" }], actor: { level: 7 } })).range).toBe(40);
  });

  test("when, and the immunity, from its words", () => {
    expect(timingIn("<p>A creature that begins its turn in the area must attempt a save.</p>", words)).toMatchObject({ when: "turnStart", immuneAfter: null, found: true });
    expect(timingIn("<p>A creature that enters the area saves; on a success, it's immune for 1 hour.</p>", words)).toMatchObject({ when: "enter", immuneAfter: "success", immuneAll: false, immuneRounds: 600 });
    expect(timingIn("<p>Each creature that ends its turn there saves.</p>", words)).toMatchObject({ when: "both", found: false });
  });

  test("what it can't read on a failure: nothing laid", () => {
    expect(failuresIn("<p>A creature in the area must attempt a @Check[will|dc:20] save or feel uneasy.</p>", words)).toBeNull();
  });
});

describe("not one of these", () => {
  test("no save (a telepathy), not passive (a gaze it uses), not an aura, no range, nothing laid or dealt", () => {
    const lays = ` or become ${link(FRIGHTENED, "Frightened 1")}.`;
    expect(auraOf(ability({ html: "<p>100 feet. It can speak to any creature within range.</p>", traits: ["aura", "magical"] }))).toBeNull();
    expect(auraOf(ability({ html: `<p>30 feet. @Check[will|dc:20]${lays}</p>`, actionType: "reaction" }))).toBeNull();
    expect(auraOf(ability({ html: `<p>@Check[will|dc:20]${lays}</p>`, traits: ["mental"], rules: [] }))).toBeNull();
    expect(auraOf(ability({ html: `<p>A creature must succeed at a @Check[will|dc:20] save${lays}</p>`, rules: [{ key: "Aura" }] }))).toBeNull();
    expect(auraOf(ability({ html: "<p>30 feet. A creature must succeed at a @Check[will|dc:20] save or feel uneasy.</p>" }))).toBeNull();
  });
});

describe("on a creature the adapter reads", () => {
  const before = { CONFIG: globalThis.CONFIG };
  beforeEach(() => setReading(english));
  afterEach(() => { globalThis.CONFIG = before.CONFIG; });

  const item = (id, slug, over = {}) => ({ id, name: id, type: "action", slug, system: { slug, rules: [], traits: { value: [] }, actionType: { value: "passive" }, description: { value: "" }, ...over } });
  const spell = id => ({ id, name: id, slug: id, isCantrip: true, rank: 1,
    system: { time: { value: "2" }, traits: { value: ["cantrip", "concentrate", "fire"] }, range: { value: "30 feet" }, target: { value: "1 creature" }, defense: { save: { statistic: "reflex", basic: true } }, location: {} },
    getDamage: async () => ({ template: { damage: { roll: { formula: "2d4 fire", kinds: new Set(["damage"]) } } } }) });
  const dragon = () => ({
    id: "wyrm", uuid: "Actor.wyrm", type: "npc", name: "Wyrm", img: "", level: 6,
    items: [
      item("presence", "frightful-presence", { traits: { value: ["aura", "emotion", "fear", "mental"] },
        rules: [{ key: "Aura", radius: 60, slug: "frightful-presence", traits: ["emotion", "fear", "mental"] }],
        description: { value: "<p>60 feet. @Check[will|dc:24|options:area-effect]</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.FrightfulPresence]</p>" } }),
      item("wards", "1-status-to-all-saves-vs-magic", { rules: [{ key: "FlatModifier", predicate: ["item:magical"], selector: "saving-throw", type: "status", value: 1 }] })
    ],
    itemTypes: { condition: [], consumable: [], feat: [], action: [] },
    system: {
      attributes: { hp: { value: 90, max: 90, temp: 0 }, ac: { value: 23 } },
      traits: { value: ["dragon"], size: { value: "lg" }, rarity: "common" },
      details: { languages: { value: ["draconic"] } },
      movement: { speeds: { land: 40 } }, abilities: {}, resources: {}, skills: {}, actions: []
    },
    skills: {}, saves: { fortitude: { mod: 15 }, reflex: { mod: 12 }, will: { mod: 13, dc: { value: 23 } } },
    perception: { mod: 14, dc: { value: 24 }, senses: [] }, initiative: { mod: 14 }, attributes: {},
    spellcasting: { regular: [{ id: "innate", tradition: "arcane", statistic: { dc: { value: 24 }, check: { mod: 16 } }, system: { prepared: { value: "innate" } },
      spells: { contents: [spell("scorch")] } }] }
  });

  test("its aura, its save against magic, and its spells' tradition among their traits", async () => {
    globalThis.CONFIG = { PF2E: {} };
    const spec = await new Pf2eAdapter().toCombatantSpec({ id: "t1", name: "Wyrm", actor: dragon(), texture: { src: "" } });
    expect(spec.auras).toHaveLength(1);
    expect(spec.auras[0]).toMatchObject({ id: "wyrm.presence", key: "frightful-presence", range: 60, save: { type: "will", dc: 24 }, when: "enter" });
    expect(spec.saveVs).toEqual([{ bonus: 1, type: "status", all: ["magical"] }]);
    expect(spec.actions.find(a => a.id === "wyrm.spell.scorch").traits).toEqual(["cantrip", "concentrate", "fire", "arcane"]);
  });
});

describe("in a fight, with PF2e's rules", () => {
  const presence = () => auraOf(ability({
    id: "wyrm.presence", slug: "frightful-presence", rules: [{ key: "Aura", radius: 60, slug: "frightful-presence", traits: ["emotion", "fear", "mental"] }],
    html: "<p>60 feet. @Check[will|dc:40]</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.FrightfulPresence]</p>"
  }));
  const creature = over => ({
    side: "friendly", kind: "npc", level: 1, hp: { value: 30, max: 30 }, defenses: { ac: 16, fortitude: 7, reflex: 7, will: 7 }, initiative: { mod: 5 }, speeds: { walk: 25 },
    actions: [{ id: `${over.id}.sword`, name: "Longsword", kind: "strike", cost: 1, bonus: 9, maps: [0, -5, -10], melee: true, reach: 5, damage: [parseFormula("1d8+4", "slashing")], traits: [] }],
    iwr: {}, flags: {}, diesAtZero: true, traits: { tactical: { base: 50, fudge: 0 }, brave: { base: 60, fudge: 0 }, selfish: { base: 30, fudge: 0 }, loyal: { base: 60, fudge: 0 } },
    ...over
  });
  const fight = hero => ({
    combatants: [creature({ id: "hero", name: "Hero", position: { x: 0, y: 0, size: 5 }, ...hero }),
      creature({ id: "wyrm", name: "Wyrm", side: "hostile", hp: { value: 80, max: 80 }, position: { x: 50, y: 0, size: 5 }, auras: [presence()] })],
    sides: { friendly: { enemies: ["hostile"] }, hostile: { enemies: ["friendly"] } }, options: { positioning: true, maxRounds: 3 }
  });

  test("its presence frightens a foe that fails its Will save", () => {
    const e = replay(fight({}), pf2eRules, 2).log.find(x => x.type === "aura");
    expect(e).toMatchObject({ actorId: "wyrm", targetId: "hero", saveType: "will", took: true, conditions: ["frightened"] });
  });

  test("one immune to fear effects, or mindless, is untouched", () => {
    expect(replay(fight({ iwr: { immune: ["fear-effects"] } }), pf2eRules, 2).log.find(x => x.type === "aura")).toMatchObject({ immune: true, took: false });
    expect(replay(fight({ creatureTraits: ["mindless"] }), pf2eRules, 2).log.find(x => x.type === "aura")).toMatchObject({ immune: true });
  });

  test("a bonus to saves against fear, read from its rule element, counts against it", () => {
    const saveVs = [{ bonus: 2, type: "status", all: ["fear"] }];
    const plain = replay(fight({}), pf2eRules, 2).log.find(x => x.type === "aura");
    const braced = replay(fight({ saveVs }), pf2eRules, 2).log.find(x => x.type === "aura");
    expect(braced.mod).toBe(plain.mod + 2);
  });
});
