/**
 * What a fight spends, read off the sheet and written back to it as PF2e spends it itself: a prepared spell at each rank
 * it's prepared at (and that rank's slot), a flexible caster's slots, an innate spell's casts today, an ability's or a
 * reaction's frequency (Orc Ferocity once a day), an item's uses. Each starts the next fight where the last one left it.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { commitPf2eChanges, usesIn, frequencyOf } from "../scripts/commit.js";
import { readReaction } from "../scripts/reactions-read.js";
import { pf2eRules } from "../scripts/rules.js";
import { setReading } from "../scripts/reading.js";
import { STATUS } from "../scripts/core.js";

setReading(JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8")));

const collection = list => Object.assign(list, { get: id => list.find(i => i.id === id) });
const clone = data => JSON.parse(JSON.stringify(data));
function setPath(data, path, value) {
  const keys = path.split(".");
  let at = data;
  for ( const k of keys.slice(0, -1) ) at = at[k] ??= {};
  at[keys.at(-1)] = value;
}
/** An item as Foundry updates one (its data and its _source the same). */
function updatable(item) {
  item.update = async changes => {
    for ( const [k, v] of Object.entries(changes) ) setPath(item, k, clone(v));
    item._source = clone({ system: item.system });
    return item;
  };
  item.delete = async () => {
    const list = item.actor.items;
    list.splice(list.indexOf(item), 1);
  };
  item.toObject = () => clone({ _id: item.id, type: item.type, system: item.system });
  item._source = clone({ system: item.system });
  return item;
}

/**
 * A spell as PF2e has one on a sheet: its rank, its damage by the rank it's cast at (Fireball's 2d6 a rank), and
 * loadVariant, which heightens it.
 */
function spell(id, { rank = 3, location = {}, name = id, perRank = 2 } = {}) {
  const make = castRank => {
    const s = {
      id, name, slug: id, type: "spell", rank: castRank, baseRank: rank, isCantrip: false, isFocusSpell: false, isAttack: false,
      system: { time: { value: "2" }, traits: { value: ["fire", "manipulate"] }, range: { value: "500 feet" }, area: null, target: { value: "1 creature" },
        location, description: { value: "" }, defense: { save: { statistic: "reflex", basic: true } }, duration: { value: "" } },
      getDamage: async () => ({ template: { damage: { roll: { formula: `${perRank * castRank}d6 fire`, kinds: new Set(["damage"]) } } } })
    };
    s.loadVariant = ({ castRank: to } = {}) => (to === castRank ? null : Object.assign(make(to), { original: s }));
    return s;
  };
  return make(location.heightenedLevel ?? rank);
}

const stat = { dc: { value: 22 }, check: { mod: 12 } };

/** A caster's sheet with these spellcasting entries and other items. */
function caster({ entries = [], items = [] } = {}) {
  const list = collection([...entries, ...items]);
  const actor = {
    id: "ezren", uuid: "Actor.ezren", type: "character", name: "Ezren", img: "", level: 9, items: list, effects: [], statuses: new Set(),
    itemTypes: { condition: [], consumable: [], feat: [], action: [], effect: [] },
    system: {
      attributes: { hp: { value: 80, max: 80, temp: 0 }, ac: { value: 26 } },
      traits: { value: ["human", "humanoid"], size: { value: "med" } },
      details: { languages: { value: ["common"] } },
      movement: { speeds: { land: 25 } }, abilities: {}, resources: {}, skills: {}
    },
    skills: {}, saves: { fortitude: { mod: 14 }, reflex: { mod: 16 }, will: { mod: 18 } },
    perception: { mod: 14, senses: [] }, initiative: { mod: 14 }, attributes: {},
    spellcasting: { regular: entries }
  };
  for ( const i of list ) i.actor = actor;
  return actor;
}

const build = actor => new Pf2eAdapter().toCombatantSpec({ id: "tok", name: actor.name, actor, texture: { src: "" } });
const spellActions = (spec, spellId) => spec.actions.filter(a => a.spellId === spellId);
const dice = a => a.damage.map(p => p.dice.map(d => `${d.n}d${d.faces}`).join("+")).join(" ");

const was = { CONFIG: globalThis.CONFIG, foundry: globalThis.foundry, game: null };
beforeEach(() => {
  globalThis.CONFIG = { PF2E: {} };
  globalThis.foundry = { utils: { deepClone: clone } };
});
afterEach(() => {
  globalThis.CONFIG = was.CONFIG;
  globalThis.foundry = was.foundry;
});

describe("a prepared spell: at each rank it's prepared at, from that rank's slot", () => {
  const entry = () => updatable({
    id: "arcane", type: "spellcastingEntry", statistic: stat, isFlexible: false, tradition: "arcane",
    system: { prepared: { value: "prepared" }, slots: {
      slot0: { prepared: [] },
      slot3: { max: 1, prepared: [{ id: "fireball" }] },
      slot5: { max: 2, prepared: [{ id: "fireball" }, { id: "fireball", expended: true }] }
    } },
    spells: { contents: [spell("fireball")] }
  });

  test("Fireball in a 3rd- and a 5th-rank slot: a cast at each, 6d6 and 10d6, each counting its own slots", async () => {
    const spec = await build(caster({ entries: [entry()] }));
    const casts = spellActions(spec, "fireball");
    expect(casts.map(a => [a.id, a.rank, dice(a), a.resource])).toEqual([
      ["ezren.spell.fireball", 3, "6d6", "prep:arcane:fireball:3"],
      ["ezren.spell.fireball@5", 5, "10d6", "prep:arcane:fireball:5"]
    ]);
    expect(spec.resources).toMatchObject({ "prep:arcane:fireball:3": 1, "prep:arcane:fireball:5": 1 });
  });

  test("read mid-fight by rank; the one cast at 5th spends a 5th-rank slot, not the 3rd's", async () => {
    const arcane = entry();
    const actor = caster({ entries: [arcane] });
    const live = await new Pf2eAdapter().readLiveState({ actor }, { unit: { resources: { "prep:arcane:fireball:3": 1, "prep:arcane:fireball:5": 1, "prep:arcane:fireball": 2 } } });
    expect(live.resources).toEqual({ "prep:arcane:fireball:3": 1, "prep:arcane:fireball:5": 1, "prep:arcane:fireball": 2 });
    const spec = { kind: "pc", actions: [], resources: { "prep:arcane:fireball:3": 1, "prep:arcane:fireball:5": 1 } };
    await commitPf2eChanges({ actor }, spec, { resources: { "prep:arcane:fireball:5": { from: 1, to: 0 } } }, { status: STATUS.STANDING, resources: { "prep:arcane:fireball:3": 1, "prep:arcane:fireball:5": 0 } });
    expect(arcane.system.slots.slot3.prepared).toEqual([{ id: "fireball" }]);
    expect(arcane.system.slots.slot5.prepared).toEqual([{ id: "fireball", expended: true }, { id: "fireball", expended: true }]);
  });
});

describe("a flexible caster: like a spontaneous one, its collection from each rank's slots", () => {
  const entry = () => updatable({
    id: "flex", type: "spellcastingEntry", statistic: stat, isFlexible: true, tradition: "arcane",
    system: { prepared: { value: "prepared", flexible: true }, slots: { slot0: { prepared: [] }, slot3: { max: 2, value: 2, prepared: [] }, slot4: { max: 1, value: 0, prepared: [] } } },
    spells: { contents: [spell("blaze", { location: { signature: true } }), spell("unlearned")] }
  });

  test("its collection (signature) spell at each rank it has slots of, counting those slots; another not at all", async () => {
    const spec = await build(caster({ entries: [entry()] }));
    expect(spellActions(spec, "blaze").map(a => [a.rank, dice(a), a.resource])).toEqual([[3, "6d6", "slots:flex:3"], [4, "8d6", "slots:flex:4"]]);
    expect(spellActions(spec, "unlearned")).toEqual([]);
    expect(spec.resources).toMatchObject({ "slots:flex:3": 2, "slots:flex:4": 0 });
  });

  test("a cast spends its rank's slot, as PF2e does (slots.slotN.value), nothing marked expended", async () => {
    const flex = entry();
    const actor = caster({ entries: [flex] });
    await commitPf2eChanges({ actor }, { kind: "pc", actions: [], resources: { "slots:flex:3": 2 } }, { resources: { "slots:flex:3": { from: 2, to: 1 } } }, { status: STATUS.STANDING, resources: { "slots:flex:3": 1 } });
    expect(flex.system.slots.slot3).toEqual({ max: 2, value: 1, prepared: [] });
  });
});

describe("an innate spell: as often as it has left today, kept on the spell", () => {
  const entry = () => ({
    id: "innate", type: "spellcastingEntry", statistic: stat, tradition: "occult",
    system: { prepared: { value: "innate" } },
    spells: { contents: [updatable(spell("fear", { rank: 3, location: { value: "innate", uses: { value: 1, max: 1 } } })), updatable(spell("spent", { location: { value: "innate", uses: { value: 0, max: 1 } } }))] }
  });

  test("its casts a resource of its own (innate:<spell>); one used up today, none", async () => {
    const innate = entry();
    const spec = await build(caster({ entries: [innate], items: innate.spells.contents }));
    const [fear] = spellActions(spec, "fear");
    expect(fear).toMatchObject({ resource: "innate:fear" });
    expect(fear.uses).toBeUndefined();
    expect(spec.resources["innate:fear"]).toBe(1);
    expect(spellActions(spec, "spent")).toEqual([]);
  });

  test("read mid-fight, and the cast written back to location.uses.value, as PF2e casts it; undone, as it was", async () => {
    const innate = entry();
    const actor = caster({ entries: [innate], items: innate.spells.contents });
    const live = await new Pf2eAdapter().readLiveState({ actor }, { unit: { resources: { "innate:fear": 1, "innate:spent": 1, "innate:gone": 1 } } });
    expect(live.resources).toEqual({ "innate:fear": 1, "innate:spent": 0, "innate:gone": 0 });
    const undo = await commitPf2eChanges({ actor }, { kind: "pc", actions: [], resources: { "innate:fear": 1 } }, { resources: { "innate:fear": { from: 1, to: 0 } } }, { status: STATUS.STANDING, resources: { "innate:fear": 0 } });
    expect(actor.items.get("fear").system.location.uses).toEqual({ value: 0, max: 1 });
    expect(undo.itemUpdates).toContainEqual({ id: "fear", update: { "system.location.uses.value": 1 } });
  });
});

describe("a frequency: once a day, kept on the sheet (frequency.value)", () => {
  const breath = (frequency) => updatable({
    id: "breath", type: "action", name: "Breath Weapon", slug: "breath-weapon",
    system: { slug: "breath-weapon", actions: { value: 2 }, actionType: { value: "action" }, traits: { value: ["fire"] }, frequency,
      description: { value: "<p>A gout of flame deals @Damage[6d6[fire]] damage in a @Template[cone|distance:30] (@Check[reflex|dc:24|basic] save).</p>" } }
  });
  const answer = (frequency) => updatable({
    id: "gulp", type: "action", name: "Gulp Air", slug: "gulp-air",
    system: { slug: "gulp-air", actionType: { value: "reaction" }, traits: { value: [] }, frequency,
      description: { value: "<p><strong>Trigger</strong> Ezren takes damage</p><hr /><p><strong>Effect</strong> Ezren regains @Damage[5[healing]] Hit Points.</p>" } }
  });

  test("an ability spent today isn't offered again; one with uses left, as many as are left", async () => {
    const spent = await build(caster({ items: [breath({ max: 1, per: "day", value: 0 })] }));
    const fresh = await build(caster({ items: [breath({ max: 2, per: "day", value: 1 })] }));
    const of = spec => spec.actions.find(a => a.itemId === "breath");
    expect(of(spent)).toMatchObject({ resource: "freq:breath" });
    expect(spent.resources["freq:breath"]).toBe(0);
    expect(fresh.resources["freq:breath"]).toBe(1);
    expect(of(fresh).uses).toBeUndefined();
  });

  test("a reaction's frequency the same: its uses left, a resource the spec counts", async () => {
    const spec = await build(caster({ items: [answer({ max: 1, per: "day", value: 0 })] }));
    const gulp = (spec.reactions ?? []).find(r => r.id === "ezren.gulp");
    expect(gulp).toMatchObject({ resource: "freq:gulp" });
    expect(gulp.pool).toBeUndefined();
    expect(spec.resources["freq:gulp"]).toBe(0);
    // (Read whole: the frequency's resource, its uses the pool.)
    expect(readReaction({ id: "a.r", label: "Answer", html: answer().system.description.value, actionType: "reaction", frequency: { max: 1, per: "day", resource: "freq:x", pool: 1 } }, { reading: JSON.parse(readFileSync(new URL("../reading/en.json", import.meta.url), "utf8")), name: "Ezren" })).toMatchObject({ resource: "freq:x", pool: 1 });
  });

  test("once a round: so many a fight, not kept; none at all, nothing", () => {
    expect(frequencyOf({ id: "x", system: { frequency: { max: 1, per: "round", value: 0 } } })).toBeNull();
    expect(frequencyOf({ id: "x", system: {} })).toBeNull();
    expect(frequencyOf({ id: "x", system: { frequency: { max: 3, per: "PT1H" } } })).toEqual({ resource: "freq:x", pool: 3 });
  });

  test("used, written back to frequency.value; read mid-fight from it", async () => {
    const item = breath({ max: 1, per: "day", value: 1 });
    const actor = caster({ items: [item] });
    expect((await new Pf2eAdapter().readLiveState({ actor }, { unit: { resources: { "freq:breath": 1 } } })).resources).toEqual({ "freq:breath": 1 });
    const undo = await commitPf2eChanges({ actor }, { kind: "pc", actions: [], resources: { "freq:breath": 1 } }, { resources: { "freq:breath": { from: 1, to: 0 } } }, { status: STATUS.STANDING, resources: { "freq:breath": 0 } });
    expect(item.system.frequency.value).toBe(0);
    expect(undo.itemUpdates).toContainEqual({ id: "breath", update: { "system.frequency.value": 1 } });
  });

  test("Orc Ferocity once a day: spent from its resource, so it saves the character once, not every fall", () => {
    const c = {
      status: STATUS.STANDING, hp: 0, temp: 0, wounded: 0, dying: 0, reactionsLeft: 1, conds: {}, resources: { "freq:orc": 1 },
      spec: { diesAtZero: false, ferocity: { label: "Orc Ferocity", resource: "freq:orc", uses: null, untilWounded: null, temp: 0 } }
    };
    expect(pf2eRules.onDropped(c)).toBe(STATUS.STANDING);
    expect(c.resources["freq:orc"]).toBe(0);
    c.hp = 0;
    c.reactionsLeft = 1;
    expect(pf2eRules.onDropped(c)).toBe(STATUS.DOWN);
  });
});

describe("an item's uses: (quantity - 1) × max + what the first has left, written back both ways", () => {
  const potion = (quantity, uses) => updatable({ id: "elixir", type: "consumable", name: "Elixir", system: { quantity, uses, damage: { kind: "healing", formula: "2d6" }, traits: { value: [] } } });

  test("counted as PF2e spends them", async () => {
    expect(usesIn({ system: { quantity: 2, uses: { value: 1, max: 3 } } })).toBe(4);
    expect(usesIn({ system: { quantity: 3, uses: { value: 1, max: 1 } } })).toBe(3);
    expect(usesIn({ system: { quantity: 0, uses: { value: 3, max: 3 } } })).toBe(0);
    const actor = caster({ items: [potion(2, { value: 1, max: 3, autoDestroy: true })] });
    expect((await new Pf2eAdapter().readLiveState({ actor }, { unit: { resources: { "item:elixir": 1 } } })).resources).toEqual({ "item:elixir": 4 });
  });

  test("two of four drunk: one left with 2 uses (quantity and uses.value); undone, as it was", async () => {
    const item = potion(2, { value: 1, max: 3, autoDestroy: true });
    const actor = caster({ items: [item] });
    const undo = await commitPf2eChanges({ actor }, { kind: "pc", actions: [], resources: { "item:elixir": 4 } }, { resources: { "item:elixir": { from: 4, to: 2 } } }, { status: STATUS.STANDING, resources: { "item:elixir": 2 } });
    expect(item.system.quantity).toBe(1);
    expect(item.system.uses.value).toBe(2);
    expect(undo.itemUpdates).toContainEqual({ id: "elixir", update: { "system.quantity": 2, "system.uses.value": 1 } });
  });

  test("the last used: gone where it's used up then (autoDestroy); else kept at 0, its uses full again", async () => {
    const gone = potion(1, { value: 2, max: 3, autoDestroy: true });
    const a = caster({ items: [gone] });
    await commitPf2eChanges({ actor: a }, { kind: "pc", actions: [], resources: { "item:elixir": 2 } }, { resources: { "item:elixir": { from: 2, to: 0 } } }, { status: STATUS.STANDING, resources: { "item:elixir": 0 } });
    expect(a.items.get("elixir")).toBeUndefined();
    const kept = potion(1, { value: 2, max: 3, autoDestroy: false });
    const b = caster({ items: [kept] });
    await commitPf2eChanges({ actor: b }, { kind: "pc", actions: [], resources: { "item:elixir": 2 } }, { resources: { "item:elixir": { from: 2, to: 0 } } }, { status: STATUS.STANDING, resources: { "item:elixir": 0 } });
    expect(b.items.get("elixir").system).toMatchObject({ quantity: 0, uses: { value: 3, max: 3 } });
  });
});

describe("two casters' summon spells, their specs built at once", () => {
  // (The wolf it calls, read a while: a cantrip whose damage takes its time.)
  const wolfActor = () => {
    const howl = Object.assign(spell("howl"), { isCantrip: true });
    howl.getDamage = () => new Promise(resolve => setTimeout(() => resolve(null), 30));
    const entry = { id: "wolf-innate", type: "spellcastingEntry", statistic: stat, system: { prepared: { value: "innate" } }, spells: { contents: [howl] } };
    const wolf = caster({ entries: [entry] });
    return { ...wolf, id: "wolf", uuid: "Compendium.pf2e.pathfinder-monster-core.Actor.wolf", type: "npc", name: "Wolf", level: 1,
      system: { ...wolf.system, traits: { value: ["animal"], size: { value: "med" }, rarity: "common" } } };
  };
  const summoner = id => {
    const animal = spell("summon-animal", { rank: 3 });
    animal.system.traits.value = ["concentrate", "manipulate", "summon"];
    animal.system.defense = null;
    animal.getDamage = async () => null;
    const entry = { id: "primal", type: "spellcastingEntry", statistic: stat, tradition: "primal", system: { prepared: { value: "spontaneous" }, slots: { slot3: { max: 3, value: 3 } } }, spells: { contents: [animal] } };
    return Object.assign(caster({ entries: [entry] }), { id });
  };
  const before = { game: null };
  beforeEach(() => {
    before.game = globalThis.game;
    // (A bestiary to call a wolf from, its index a while coming: the other spec is built meanwhile.)
    const pack = { documentName: "Actor", collection: "pf2e.pathfinder-monster-core",
      getIndex: () => new Promise(resolve => setTimeout(() => resolve([{ _id: "wolf", name: "Wolf", type: "npc", system: { details: { level: { value: 1 } }, traits: { value: ["animal"], rarity: "common" } } }]), 20)),
      getDocument: async () => wolfActor() };
    globalThis.game = { ...globalThis.game, packs: [pack] };
  });
  afterEach(() => { globalThis.game = before.game; });

  test("each gets its summon, neither dropped while the other's creature is read", async () => {
    const adapter = new Pf2eAdapter();
    // (The second begun as the first reads the wolf it calls.)
    const one = id => adapter.toCombatantSpec({ id, name: id, actor: summoner(id), texture: { src: "" } });
    const specs = await Promise.all([one("ezren"), new Promise(resolve => setTimeout(resolve, 30)).then(() => one("lini"))]);
    expect(specs.map(s => s.actions.filter(a => a.kind === "summon").length)).toEqual([1, 1]);
    // (The wolf it calls doesn't summon in turn.)
    expect(specs[0].actions.find(a => a.kind === "summon").creatures[0].name).toBe("Wolf");
  });
});
