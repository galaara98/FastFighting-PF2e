/**
 * A buff or debuff a fight lays (commit.js laySpellEffect): its PF2e effect with whom it's from (system.context), as
 * PF2e's own drop of it from a card has it, so its rounds count on its giver's turn and its rules read its giver's item
 * (@item.origin); the effect fetched once a session, not each turn (granted.js linkedEffect).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { commitPf2eChanges } from "../scripts/commit.js";

const BLESS = "Compendium.pf2e.spell-effects.Item.bless";

let fetched;
const was = { CONFIG: globalThis.CONFIG, fromUuid: globalThis.fromUuid };
beforeEach(() => {
  fetched = 0;
  globalThis.CONFIG = { ChatMessage: { documentClass: { getSpeaker: () => ({}), create: async () => ({ id: "m1" }) } } };
  globalThis.fromUuid = async uuid => {
    fetched++;
    return uuid.startsWith(BLESS) ? { documentName: "Item", type: "effect", name: "Spell Effect: Bless", toObject: () => ({ _id: "e1", type: "effect", name: "Spell Effect: Bless", system: { level: { value: 1 } } }) } : null;
  };
});
afterEach(() => Object.assign(globalThis, was));

/** A token and its sheet (what commitPf2eChanges needs of it), the effects made on it kept. */
function token(id, items = []) {
  const made = [];
  const list = Object.assign([...items], { get: x => list.find(i => i.id === x) });
  const actor = {
    id, uuid: `Scene.s.Token.t-${id}.Actor.${id}`, items: list, itemTypes: { condition: [], effect: [] },
    system: { attributes: { hp: { value: 20, max: 20, temp: 0 } }, resources: {} },
    update: async () => actor,
    createEmbeddedDocuments: async (type, data) => data.map((d, i) => { made.push(d); return { ...d, id: `${id}-made${i}` }; })
  };
  return { id: `t-${id}`, uuid: `Scene.s.Token.t-${id}`, name: id, actor, made };
}

const bless = { id: "bless", uuid: "Scene.s.Token.t-kyra.Actor.kyra.Item.bless", type: "spell", rank: 1, attribute: "wis",
  spellcasting: { tradition: "divine", statistic: { attributeModifier: { value: 4 } } }, getOriginData: () => ({ rollOptions: ["origin:item:bless"] }) };
const kyra = token("kyra", [bless]);
const ACTIONS = { "kyra.spell.bless": { action: { id: "kyra.spell.bless", name: "Bless", kind: "buff", spellId: "bless", rank: 1, effectRef: { uuids: [BLESS] } }, spec: { actorUuid: kyra.actor.uuid } } };
const options = { effectSource: key => ACTIONS[key] ?? null, tokenOf: id => (id === "kyra" ? kyra : null), audience: () => "public" };
const final = { status: "standing", resources: {} };
const added = { effects: { added: [{ key: "kyra.spell.bless", sourceId: "kyra", rounds: 10, label: "+1 attack" }], ended: [] } };

describe("an effect laid, with whom it's from", () => {
  test("its origin (the caster, their token, the spell, its spellcasting, its roll options) and its target", async () => {
    const lem = token("lem");
    await commitPf2eChanges(lem, { id: "lem", kind: "pc", actions: [], resources: {} }, added, final, options);
    expect(lem.made).toHaveLength(1);
    expect(lem.made[0].system.context).toEqual({
      origin: { actor: kyra.actor.uuid, token: kyra.uuid, item: bless.uuid, spellcasting: { attribute: { type: "wis", mod: 4 }, tradition: "divine" }, rollOptions: ["origin:item:bless"] },
      target: { actor: lem.actor.uuid, token: lem.uuid },
      roll: null
    });
    expect(lem.made[0].system.duration).toEqual({ value: 10, unit: "rounds", expiry: "turn-start", sustained: false });
  });

  test("the effect fetched once, however many turns lay it", async () => {
    ACTIONS["kyra.spell.bless"].action.effectRef = { uuids: [`${BLESS}-again`] };
    for ( const who of ["lem", "amiri", "seelah"] ) await commitPf2eChanges(token(who), { id: who, kind: "pc", actions: [], resources: {} }, added, final, options);
    expect(fetched).toBe(1);
  });
});
