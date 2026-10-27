/**
 * A live battle's read of a sheet mid-fight (readLiveState): only what a turn changes, straight off the actor, with the
 * resources the engine counts read as toCombatantSpec reads them, and one used up as 0.
 */
import { describe, expect, test } from "vitest";
import { Pf2eAdapter } from "../scripts/adapter.js";
import { preparedIn } from "../scripts/commit.js";

const collection = list => Object.assign(list, { get: id => list.find(i => i.id === id) });
const actorOf = (over = {}) => ({
  type: "character",
  statuses: new Set(),
  effects: [],
  itemTypes: { condition: [] },
  items: collection([]),
  ...over,
  system: {
    attributes: { hp: { value: 12, max: 30, temp: 3 }, dying: { value: 0 }, wounded: { value: 1 }, doomed: { value: 0 } },
    resources: { focus: { value: 1 }, heroPoints: { value: 2 } },
    ...over.system
  }
});
const read = (actor, resources = {}) => new Pf2eAdapter().readLiveState({ actor }, { unit: { resources } });

describe("a sheet mid-fight", () => {
  test("hit points, dying numbers and conditions, as the sheet has them", async () => {
    const actor = actorOf({
      itemTypes: { condition: [{ slug: "frightened", value: 2 }, { slug: "grabbed" }, { slug: "persistent-damage", system: { persistent: { formula: "1d6", damageType: "fire" } } }] }
    });
    const s = await read(actor);
    expect(s).toMatchObject({ hp: 12, temp: 3, maxHp: 30, dying: 0, wounded: 1, doomed: 0, status: "standing", conditions: { frightened: 2, grabbed: 1, offGuard: 1, immobilized: 1 } });
    expect(s.persistent).toHaveLength(1);
    expect(s.persistent[0]).toMatchObject({ persistent: true });
  });

  test("down, dead: a character at 0 is down; a creature at 0, or one marked dead, is dead", async () => {
    const at0 = { attributes: { hp: { value: 0, max: 30, temp: 0 }, dying: { value: 2 } } };
    expect((await read(actorOf({ system: at0 }))).status).toBe("down");
    expect((await read(actorOf({ type: "npc", system: at0 }))).status).toBe("dead");
    expect((await read(actorOf({ statuses: new Set(["dead"]) }))).status).toBe("dead");
    // (A hazard with no Hit Points is always set.)
    expect(await read(actorOf({ type: "hazard", system: { attributes: { hp: { value: 0, max: 0 } } } }))).toMatchObject({ hp: 1, maxHp: 1, status: "standing" });
  });

  test("the resources the engine counts: hero points, focus, items, prepared spells, slots; used up, 0", async () => {
    const entry = {
      id: "arcane", type: "spellcastingEntry",
      system: { slots: { slot0: { prepared: [{ id: "shield" }] }, slot1: { prepared: [{ id: "missile" }, { id: "missile", expended: true }, { id: "fear" }] }, slot2: { value: 3, prepared: [{ id: "missile" }] } } }
    };
    const actor = actorOf({
      items: collection([
        entry,
        { id: "potion", type: "consumable", system: { quantity: 2, uses: { max: 1 }, damage: { kind: "healing", formula: "1d8" } } },
        { id: "bomb", type: "consumable", system: { quantity: 3, uses: { max: 1 }, damage: { kind: "damage", formula: "1d8" } } },
        { id: "spent", type: "consumable", system: { quantity: 0 } }
      ])
    });
    const keys = { fate: 1, focus: 1, "item:potion": 1, "item:bomb": 1, "item:spent": 1, "item:gone": 1, "prep:arcane:missile": 1, "prep:arcane:fear": 1, "slots:arcane:2": 1, other: 1 };
    expect((await read(actor, keys)).resources).toEqual({
      fate: 2, focus: 1, "item:potion": 2, "item:bomb": 3, "item:spent": 0, "item:gone": 0, "prep:arcane:missile": 2, "prep:arcane:fear": 1, "slots:arcane:2": 3
    });
  });

  test("prepared spells kept as an object by index (as some worlds save them) count as a list does", async () => {
    const entry = { id: "arcane", type: "spellcastingEntry", system: { slots: { slot3: { prepared: { 0: { id: "fireball" }, 1: { id: "fireball", expended: true }, 2: { id: "haste" } } } } } };
    const actor = actorOf({ items: collection([entry]) });
    expect((await read(actor, { "prep:arcane:fireball": 1, "prep:arcane:haste": 1 })).resources).toEqual({ "prep:arcane:fireball": 1, "prep:arcane:haste": 1 });
    expect(preparedIn(entry.system.slots.slot3).map(p => p.id)).toEqual(["fireball", "fireball", "haste"]);
    expect(preparedIn({ prepared: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(preparedIn({})).toEqual([]);
  });
});
