/**
 * Reloading and ammunition (ammo.js), with fakes shaped like PF2e 8.6's weapon and ammo items: a Strike's reload from
 * its weapon's system.reload (a creature's attack's reload-N trait), so a shot costs 1 + reload; the rounds a weapon has
 * (loaded and carried, compatible by PF2e's own isAmmoFor, not stowed, a magazine by its uses) as the core's
 * action.ammo, none of them no shot; in a live battle, its ammunition readied before PF2e's own Strike rolls (a bow's
 * stack picked, a crossbow loaded) and spent by it, the undo record putting all of it back; and rounds the engine's own
 * shots spent run down on the sheet.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Pf2eAdapter, injuryWeapon } from "../scripts/adapter.js";
import { reloadOf, ammoOf, roundsOf, readyAmmo, ammoState, ammoUndo, spendRounds } from "../scripts/ammo.js";
import { commitPf2eChanges } from "../scripts/commit.js";
import { hasUses } from "../../FastFighting/scripts/engine/behavior/evaluate.js";

const adapter = new Pf2eAdapter();

/** A value at a dotted path, set (an item's update, as Foundry applies one). */
function setPath(data, path, value) {
  const keys = path.split(".");
  let at = data;
  for ( const k of keys.slice(0, -1) ) at = at[k] ??= {};
  at[keys.at(-1)] = value;
}
const clone = data => JSON.parse(JSON.stringify(data));

/** A character's sheet holding these items (PF2e's items and itemTypes; each item knows its actor). */
function sheet(...items) {
  const list = [];
  const actor = { id: "harsk", uuid: "Actor.harsk", type: "character", items: Object.assign(list, { get: id => list.find(i => i.id === id) }) };
  Object.defineProperty(actor, "itemTypes", { get: () => ({ ammo: list.filter(i => i.type === "ammo"), weapon: list.filter(i => i.type === "weapon"), condition: [] }) });
  for ( const i of items ) {
    i.actor = actor;
    list.push(i);
  }
  return actor;
}

/** The parts of a physical item every fake has: its data, updated and deleted as Foundry does. */
function physical(item) {
  item.toObject = () => clone({ _id: item.id, type: item.type, name: item.name, system: item.system });
  item.update = async changes => {
    for ( const [k, v] of Object.entries(changes) ) setPath(item, k, clone(v));
    return item;
  };
  item.delete = async () => {
    const list = item.actor.items;
    list.splice(list.indexOf(item), 1);
  };
  return item;
}

/** An ammo item, as PF2e has bolts (a consumable, used up at 0) or a magazine (uses). */
function ammo(id, { quantity = 20, baseItem = "bolts", uses = { value: 1, max: 1, autoDestroy: true }, stowed = false } = {}) {
  const item = physical({ id, type: "ammo", name: id, isStowed: stowed, system: { quantity, baseItem, uses: { ...uses }, rules: [], traits: { value: ["consumable"] } } });
  // (PF2e's isAmmoFor, its common case: the same ammunition type.)
  item.isAmmoFor = weapon => !!weapon.system.ammo && !weapon.system.ammo.builtIn && weapon.system.ammo.baseType === item.system.baseItem;
  return item;
}

/**
 * A weapon, as PF2e 8.6 prepares one: its reload, its ammunition (system.ammo: its type, capacity, built in), expend,
 * the stack picked for it (selectedAmmoId) and what's loaded in it (system.subitems), with PF2e's `ammo` getter (a bow,
 * reload 0, shoots its pick; anything else what's loaded), `subitems` and `attach` (its Reload: a stack's rounds moved in).
 */
function weapon(id, { reload = "2", baseType = "bolts", capacity = 1, builtIn = false, expend = 1, traits = [], selectedAmmoId = null, loaded = [] } = {}) {
  const w = physical({
    id, type: "weapon", name: id,
    system: { reload: { value: reload }, ammo: baseType === null ? null : { baseType, capacity, builtIn }, expend: baseType === null ? null : expend, traits: { value: traits }, selectedAmmoId, subitems: loaded.map(clone) }
  });
  const sub = d => ({ id: d._id, type: d.type, sort: d.sort ?? 0, system: d.system });
  Object.defineProperty(w, "subitems", { get: () => w.system.subitems.map(sub) });
  Object.defineProperty(w, "ammo", {
    get: () => {
      if ( !w.system.ammo ) return null;
      if ( w.system.reload.value === "0" && !traits.includes("repeating") ) return w.actor.items.get(w.system.selectedAmmoId ?? "") ?? null;
      return w.subitems.find(i => i.system.baseItem === w.system.ammo.baseType) ?? null;
    }
  });
  w.attach = async (stack, { quantity = 1 } = {}) => {
    const into = w.system.subitems.find(d => d.system.baseItem === stack.system.baseItem);
    if ( into ) into.system.quantity += quantity;
    else w.system.subitems.push({ _id: `${stack.id}-loaded`, type: "ammo", system: { ...clone(stack.system), quantity } });
    const left = stack.system.quantity - quantity;
    if ( left <= 0 ) await stack.delete();
    else await stack.update({ "system.quantity": left });
    return true;
  };
  return w;
}

/** PF2e's Strike spending its ammunition as it rolls (its consumeAmmo): a round loaded, or the picked stack's. */
async function consume(w) {
  const loaded = w.system.subitems.find(d => d.system.baseItem === w.system.ammo.baseType);
  if ( loaded ) {
    loaded.system.quantity -= w.system.expend;
    if ( loaded.system.quantity <= 0 ) w.system.subitems.splice(w.system.subitems.indexOf(loaded), 1);
    return;
  }
  const stack = w.ammo;
  const left = stack.system.quantity - w.system.expend;
  if ( left <= 0 ) await stack.delete();
  else await stack.update({ "system.quantity": left });
}

/** PF2e's check roll, as a Strike's variant returns it. */
const checkRoll = degree => ({ degreeOfSuccess: degree, total: 21, dice: [{ faces: 20, total: 13 }] });

/**
 * A Strike as PF2e lists it, its variants refusing as PF2e's do without the ammunition ("No ammunition is assigned"),
 * else spending it and rolling. `asked`: what it saw.
 */
function strikeOf(w, { degree = 1 } = {}) {
  const asked = { rolls: 0 };
  return {
    type: "strike", slug: w.id, label: w.id, visible: true, item: w, asked,
    variants: [0, 1, 2].map(() => ({
      roll: async () => {
        asked.rolls += 1;
        const ready = w.ammo ? w.ammo.system.quantity : 0;
        if ( w.system.ammo && !w.system.ammo.builtIn && ready < w.system.expend ) return null;
        if ( w.system.ammo && !w.system.ammo.builtIn ) await consume(w);
        return checkRoll(degree);
      }
    })),
    damage: async () => ({ instances: [] }),
    critical: async () => ({ instances: [] })
  };
}

/** Harsk's token: his sheet, its Strikes those of these weapons. */
function token(actor, strikes) {
  actor.system = { actions: strikes };
  return { uuid: "Scene.s.Token.harsk", actor };
}
const foe = () => {
  const doc = { uuid: "Scene.s.Token.goblin" };
  doc.object = { document: doc };
  return doc;
};

beforeEach(() => {
  globalThis.game.user = { settings: {}, targets: new Set() };
  globalThis.game.messages = { contents: [] };
});

describe("a Strike's reload", () => {
  test("a weapon's system.reload: a number of actions; '-' and '0' none; a minute endless; a creature's attack by its trait", () => {
    expect(["-", "0", "1", "2", "3", "10", null, ""].map(r => reloadOf(weapon("w", { reload: r })))).toEqual([0, 0, 1, 2, 3, Infinity, 0, 0]);
    const attack = traits => ({ type: "melee", system: { traits: { value: traits } } });
    expect([attack(["reload-1"]), attack(["reload-2", "deadly-d10"]), attack(["reload-1-min"]), attack(["agile"])].map(reloadOf)).toEqual([1, 2, Infinity, 0]);
    expect(reloadOf(null)).toBe(0);
  });
});

describe("a weapon's ammunition", () => {
  test("which weapons take it: a character's ranged weapon that spends it, not built in; a bow shoots its pick, the rest what's loaded", () => {
    const harsk = sheet();
    expect(ammoOf(harsk, weapon("heavy-crossbow"))).toEqual({ expend: 1, picked: false, capacity: 1 });
    expect(ammoOf(harsk, weapon("shortbow", { reload: "0", baseType: "arrows", capacity: null }))).toEqual({ expend: 1, picked: true, capacity: 0 });
    expect(ammoOf(harsk, weapon("repeating-crossbow", { reload: "0", baseType: "repeating-crossbow-magazine", traits: ["repeating"] })).picked).toBe(false);
    expect(ammoOf(harsk, weapon("javelin", { reload: "-", baseType: null }))).toBeNull();
    expect(ammoOf(harsk, weapon("growth-gun", { reload: "1", builtIn: true }))).toBeNull();
    expect(ammoOf({ type: "npc" }, weapon("heavy-crossbow"))).toBeNull();
    expect(ammoOf(harsk, { type: "melee", system: { traits: { value: ["reload-1"] } } })).toBeNull();
  });

  test("its rounds from quantity: what's loaded and the compatible stacks it carries, not what's stowed away or another kind; a magazine by its uses", () => {
    const bow = weapon("heavy-crossbow", { loaded: [{ _id: "in", type: "ammo", system: { quantity: 1, baseItem: "bolts", uses: { value: 1, max: 1 } } }] });
    sheet(bow, ammo("bolts", { quantity: 20 }), ammo("cold-iron-bolts", { quantity: 5 }), ammo("packed", { quantity: 10, stowed: true }), ammo("arrows", { baseItem: "arrows" }));
    expect(roundsOf(bow.actor, bow)).toBe(26);
    const repeater = weapon("repeating-crossbow", { reload: "0", baseType: "repeating-crossbow-magazine", traits: ["repeating"] });
    sheet(repeater, ammo("magazines", { quantity: 2, baseItem: "repeating-crossbow-magazine", uses: { value: 3, max: 5, autoDestroy: true } }));
    expect(roundsOf(repeater.actor, repeater)).toBe(8);
    expect(roundsOf(sheet(), weapon("javelin", { reload: "-", baseType: null }))).toBeNull();
  });
});

describe("its Strikes, as the engine has them", () => {
  const before = { CONFIG: globalThis.CONFIG };
  afterEach(() => { globalThis.CONFIG = before.CONFIG; });

  /** A PF2e Strike of a weapon, as #strikes reads it (its damage formula). */
  const strikeData = (w, mod = 9) => ({ type: "strike", label: w.name, slug: w.id, totalModifier: mod, visible: true, ready: true, item: w,
    damage: async () => "1d10+2 piercing", critical: async () => "2d10+4 piercing" });

  /** Harsk, a dwarf ranger, as PF2e lists him: his weapons' Strikes, his ammunition, little else. */
  function harsk(weapons, stacks = []) {
    const actor = sheet(...weapons, ...stacks);
    Object.assign(actor, {
      name: "Harsk", img: "", level: 3,
      system: {
        attributes: { hp: { value: 40, max: 40, temp: 0 }, ac: { value: 19 } },
        traits: { value: ["dwarf", "humanoid"], size: { value: "med" }, rarity: "common" },
        details: { languages: { value: ["common", "dwarven"] } },
        movement: { speeds: { land: 20 } },
        abilities: {}, resources: { heroPoints: { value: 1 } }, skills: {},
        actions: weapons.map(w => strikeData(w))
      },
      skills: { athletics: { mod: 7, rank: 1 }, acrobatics: { mod: 5 }, thievery: { mod: 1 }, stealth: { mod: 5 }, medicine: { mod: 3 } },
      saves: { fortitude: { mod: 9 }, reflex: { mod: 8 }, will: { mod: 7 } },
      perception: { mod: 9, senses: [] },
      initiative: { mod: 9 },
      attributes: {},
      spellcasting: { regular: [] }
    });
    return actor;
  }
  const specOf = async actor => {
    globalThis.CONFIG = { PF2E: {} };
    return adapter.toCombatantSpec({ id: "t1", name: "Harsk", actor, texture: { src: "" } });
  };
  const strikeIn = (spec, slug) => spec.actions.find(a => a.kind === "strike" && a.slug === slug);

  test("reload from system.reload: the heavy crossbow's shot costs 3; a crossbow's 2; a thrown weapon's ('-') 1; a minute's, its loaded shot once", async () => {
    const spec = await specOf(harsk([
      weapon("heavy-crossbow", { reload: "2" }), weapon("crossbow", { reload: "1" }), weapon("javelin", { reload: "-", baseType: null }), weapon("backpack-ballista", { reload: "10", baseType: "backpack-ballista-bolts" })
    ], [ammo("bolts"), ammo("ballista-bolts", { baseItem: "backpack-ballista-bolts", quantity: 2 })]));
    expect(strikeIn(spec, "heavy-crossbow")).toMatchObject({ cost: 3, ammo: "ammo:heavy-crossbow" });
    expect(strikeIn(spec, "heavy-crossbow").uses).toBeUndefined();
    expect(strikeIn(spec, "crossbow")).toMatchObject({ cost: 2, ammo: "ammo:crossbow" });
    const javelin = strikeIn(spec, "javelin");
    expect(javelin.cost).toBe(1);
    expect(javelin.ammo).toBeUndefined();
    expect(strikeIn(spec, "backpack-ballista")).toMatchObject({ cost: 1, uses: 1, ammo: "ammo:backpack-ballista" });
    // (Its pool, how many rounds it has; nothing of the reading left on the actions.)
    expect(spec.resources).toMatchObject({ "ammo:heavy-crossbow": 20, "ammo:crossbow": 20, "ammo:backpack-ballista": 2 });
    expect(spec.actions.some(a => "rounds" in a || "pool" in a)).toBe(false);
    // (Named for what it shoots next, in the planner and a fight's summary.)
    expect(strikeIn(spec, "heavy-crossbow").ammoName).toBe("bolts");
    expect(adapter.resourceLabel("ammo:heavy-crossbow", spec)).toBe("bolts");
    expect(adapter.describeOutcome(spec, { resources: { ...spec.resources, "ammo:heavy-crossbow": 18 } }).at(-1)).toContain("bolts");
  });

  test("a weapon with no ammunition: its Strike there, but no shot (none to shoot until some turns up)", async () => {
    const spec = await specOf(harsk([weapon("heavy-crossbow")], [ammo("arrows", { baseItem: "arrows" })]));
    const shot = strikeIn(spec, "heavy-crossbow");
    expect(spec.resources["ammo:heavy-crossbow"]).toBe(0);
    expect(shot.ammoName).toBeUndefined();
    expect(adapter.resourceLabel("ammo:heavy-crossbow", spec)).toBe("heavy-crossbow");
    const unit = { resources: { ...spec.resources }, uses: {} };
    expect(hasUses(unit, shot)).toBe(false);
    expect(hasUses({ resources: { "ammo:heavy-crossbow": 1 }, uses: {} }, shot)).toBe(true);
  });

  test("an injury poison goes on a weapon that takes ammunition only while it has rounds to shoot", () => {
    const shot = rounds => ({ id: "xbow", kind: "strike", bonus: 9, damage: [{ type: "piercing", dice: [{ n: 1, faces: 10 }], flat: 2 }], ammo: "ammo:xbow", rounds });
    const dagger = { id: "dagger", kind: "strike", bonus: 9, damage: [{ type: "piercing", dice: [{ n: 1, faces: 4 }], flat: 2 }] };
    expect(injuryWeapon([shot(3), dagger]).id).toBe("xbow");
    expect(injuryWeapon([shot(0), dagger]).id).toBe("dagger");
  });

  test("a shot that takes two rounds (a double barrel's): ammoCost 2", async () => {
    const spec = await specOf(harsk([weapon("double-barreled-musket", { reload: "1", baseType: "rounds", expend: 2, capacity: 2 })], [ammo("rounds", { baseItem: "rounds", quantity: 10 })]));
    expect(strikeIn(spec, "double-barreled-musket")).toMatchObject({ ammo: "ammo:double-barreled-musket", ammoCost: 2, cost: 2 });
    expect(spec.resources["ammo:double-barreled-musket"]).toBe(10);
  });

  test("a live battle's read of the sheet: a weapon's rounds as they now stand; one gone, none", async () => {
    const bow = weapon("heavy-crossbow");
    const actor = sheet(bow, ammo("bolts", { quantity: 17 }));
    actor.system = { attributes: { hp: { value: 30, max: 40, temp: 0 } }, resources: {} };
    actor.statuses = new Set();
    actor.effects = [];
    const s = await adapter.readLiveState({ actor }, { unit: { resources: { "ammo:heavy-crossbow": 20, "ammo:gone": 3 } } });
    expect(s.resources).toEqual({ "ammo:heavy-crossbow": 17, "ammo:gone": 0 });
  });
});

describe("in a live battle: ammunition readied before PF2e's own Strike rolls", () => {
  const shoot = (tok, w, attackNumber = 0) => adapter.rollStrike(tok, { action: { id: `harsk.strike.${w.id}.0` }, target: foe(), attackNumber });

  test("Harsk's heavy crossbow, nothing loaded: loaded from his bolts as its Reload does, PF2e's Strike spends the bolt, and the undo record puts both back", async () => {
    const bow = weapon("heavy-crossbow");
    const bolts = ammo("bolts", { quantity: 20 });
    const actor = sheet(bow, bolts, ammo("cold-iron-bolts", { quantity: 5 }));
    const strike = strikeOf(bow);
    const out = await shoot(token(actor, [strike]), bow);
    // (PF2e rolled it: no "No ammunition is assigned".)
    expect(out.attack).toEqual({ degree: 1, natural: 13, total: 21 });
    expect(strike.asked.rolls).toBe(1);
    // (The stack with the most loaded from, the bolt shot: 19 left, nothing loaded.)
    expect(bolts.system.quantity).toBe(19);
    expect(bow.system.subitems).toEqual([]);
    expect(out.records).toHaveLength(1);
    const [record] = out.records;
    expect(record).toMatchObject({ tokenUuid: "Scene.s.Token.harsk", actorUuid: "Actor.harsk", deletedItems: [], createdItems: [] });
    expect(record.itemUpdates).toEqual([{ id: "bolts", update: { "system.quantity": 20 } }]);
  });

  test("its last bolt: the stack used up made again by the undo record; a bolt loaded already, shot with none moved, and put back", async () => {
    const bow = weapon("heavy-crossbow");
    const actor = sheet(bow, ammo("bolts", { quantity: 1 }));
    const out = await shoot(token(actor, [strikeOf(bow)]), bow);
    expect(actor.items.get("bolts")).toBeUndefined();
    expect(out.records[0].deletedItems).toEqual([{ _id: "bolts", type: "ammo", name: "bolts", system: expect.objectContaining({ quantity: 1, baseItem: "bolts" }) }]);

    const loaded = [{ _id: "in", type: "ammo", system: { quantity: 1, baseItem: "bolts", uses: { value: 1, max: 1 } } }];
    const ready = weapon("heavy-crossbow", { loaded });
    const stack = ammo("bolts", { quantity: 20 });
    const again = await shoot(token(sheet(ready, stack), [strikeOf(ready)]), ready);
    expect(stack.system.quantity).toBe(20);
    expect(again.records[0].itemUpdates).toEqual([{ id: "heavy-crossbow", update: { "system.subitems": loaded } }]);
  });

  test("a bow (reload 0): the stack with the most picked for it (selectedAmmoId), as its sheet's list would; PF2e's own pick first, where it has rounds", async () => {
    const bow = weapon("longbow", { reload: "0", baseType: "arrows", capacity: null });
    const arrows = ammo("arrows", { baseItem: "arrows", quantity: 12 });
    const actor = sheet(bow, ammo("silver-arrows", { baseItem: "arrows", quantity: 3 }), arrows);
    const out = await shoot(token(actor, [strikeOf(bow)]), bow);
    expect(bow.system.selectedAmmoId).toBe("arrows");
    expect(arrows.system.quantity).toBe(11);
    expect(out.records[0].itemUpdates).toEqual([
      { id: "longbow", update: { "system.selectedAmmoId": null } },
      { id: "arrows", update: { "system.quantity": 12 } }
    ]);
    // (Its own pick used up: another picked. One that has rounds stands.)
    const picked = weapon("longbow", { reload: "0", baseType: "arrows", capacity: null, selectedAmmoId: "silver-arrows" });
    const silver = ammo("silver-arrows", { baseItem: "arrows", quantity: 3 });
    const own = sheet(picked, silver, ammo("arrows", { baseItem: "arrows", quantity: 12 }));
    expect(await readyAmmo(own, picked)).toBe(false);
    expect(picked.system.selectedAmmoId).toBe("silver-arrows");
    silver.system.quantity = 0;
    expect(await readyAmmo(own, picked)).toBe(true);
    expect(picked.system.selectedAmmoId).toBe("arrows");
  });

  test("none compatible: nothing readied, PF2e refuses, and the engine rolls it (nothing to put back)", async () => {
    const bow = weapon("heavy-crossbow");
    const strike = strikeOf(bow);
    const actor = sheet(bow, ammo("arrows", { baseItem: "arrows" }));
    expect(await shoot(token(actor, [strike]), bow)).toBeNull();
    expect(strike.asked.rolls).toBe(1);
    expect(actor.items.get("arrows").system.quantity).toBe(20);
  });

  test("PF2e refusing all the same (out of its range): the bolt it loaded stays loaded, and the undo record comes back without a roll", async () => {
    const bow = weapon("heavy-crossbow");
    const strike = strikeOf(bow);
    strike.variants[0].roll = async () => null;
    const out = await shoot(token(sheet(bow, ammo("bolts")), [strike]), bow);
    expect(out).toEqual({ records: [expect.objectContaining({ itemUpdates: [{ id: "heavy-crossbow", update: { "system.subitems": [] } }, { id: "bolts", update: { "system.quantity": 20 } }] })] });
  });

  test("a weapon that takes none, or a creature's attack: no record, as before", async () => {
    const javelin = weapon("javelin", { reload: "-", baseType: null });
    const out = await shoot(token(sheet(javelin), [strikeOf(javelin)]), javelin);
    expect(out).toEqual({ attack: { degree: 1, natural: 13, total: 21 }, damage: null });
  });

  test("ammoUndo: nothing changed, no record; an empty magazine set aside into the inventory, taken away", async () => {
    const bow = weapon("heavy-crossbow");
    const actor = sheet(bow, ammo("bolts"));
    const state = ammoState(actor, bow);
    expect(ammoUndo({ uuid: "T" }, actor, state)).toBeNull();
    actor.items.push(Object.assign(ammo("empty-magazine", { quantity: 1 }), { actor }));
    expect(ammoUndo({ uuid: "T" }, actor, state).createdItems).toEqual(["empty-magazine"]);
  });
});

describe("rounds the engine's own shots spent, run down on the sheet", () => {
  test("only what PF2e's Strike didn't spend, from the stack with the most; its undo as it was; a stack used up, gone", async () => {
    const bow = weapon("heavy-crossbow");
    const bolts = ammo("bolts", { quantity: 18 });
    const few = ammo("few", { quantity: 1 });
    const actor = sheet(bow, bolts, few);
    const undo = { itemUpdates: [], deletedItems: [] };
    // (20 as the turn began, 19 now; the engine shot 3, PF2e's Strike spent 1 of them itself.)
    await spendRounds(actor, "heavy-crossbow", { start: 20, spent: 3 }, undo);
    expect(bolts.system.quantity).toBe(16);
    expect(undo.itemUpdates).toEqual([{ id: "bolts", update: { "system.quantity": 18 } }]);
    // (None, or all of them PF2e's: nothing more.)
    await spendRounds(actor, "heavy-crossbow", { start: 17, spent: 0 }, undo);
    await spendRounds(actor, "heavy-crossbow", { start: 18, spent: 1 }, undo);
    expect(bolts.system.quantity).toBe(16);
    // (More than the biggest stack has: the next one's too, used up and gone.)
    await spendRounds(actor, "heavy-crossbow", { start: 17, spent: 17 }, undo);
    expect(actor.items.get("bolts")).toBeUndefined();
    expect(actor.items.get("few")).toBeUndefined();
    expect(undo.deletedItems.map(d => d._id)).toEqual(["bolts", "few"]);
  });

  test("through a turn's changes (commit.js): the engine's resource spent beyond the sheet's", async () => {
    const bow = weapon("heavy-crossbow");
    const bolts = ammo("bolts", { quantity: 20 });
    const actor = sheet(bow, bolts);
    actor.system = { attributes: { hp: { value: 30, max: 40 } }, resources: {} };
    actor.update = async () => actor;
    const doc = { uuid: "Scene.s.Token.harsk", actor };
    const spec = { kind: "pc", actions: [], resources: { "ammo:heavy-crossbow": 20 } };
    const undo = await commitPf2eChanges(doc, spec, { resources: { "ammo:heavy-crossbow": { from: 20, to: 18 } } }, { resources: { "ammo:heavy-crossbow": 18 }, status: "standing" });
    expect(bolts.system.quantity).toBe(18);
    expect(undo.itemUpdates).toEqual([{ id: "bolts", update: { "system.quantity": 20 } }]);
  });
});
