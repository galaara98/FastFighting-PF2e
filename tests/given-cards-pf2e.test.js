/**
 * Who got which effect (commit.js, the core's API 21 commitChanges options): a short card from whoever gave it, after the
 * action's own card, where no card of PF2e's names whom it went to: "Lay on Hands → Lem (+2 AC)", the effect linked to
 * drag. A buff, a heal's bonus, a debuff with no save; not one whose save or check card names the target, nor one an
 * action only its user can take laid on itself. For the GMs alone where either is hidden from the players. One the
 * table settles itself (a player's character's at another, Apply players' damage off) is named, not laid: it waits.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { commitPf2eChanges } from "../scripts/commit.js";

const LOH_EFFECT = "Compendium.pf2e.spell-effects.Item.lyLMiauxIVUM3oF1";

/** The actions that laid each effect, by key (the core's effectSource): Lay on Hands' heal, Bless, Rage, a save debuff. */
const ACTIONS = {
  "seelah.spell.loh": { action: { id: "seelah.spell.loh", name: "Lay on Hands", kind: "heal", effectRef: { uuids: [LOH_EFFECT] } } },
  "kyra.spell.bless": { action: { id: "kyra.spell.bless", name: "Bless", kind: "buff", aura: 15 } },
  "amiri.self.rage": { action: { id: "amiri.self.rage", name: "Rage", kind: "buff", targets: "self" } },
  "ezren.spell.slow": { action: { id: "ezren.spell.slow", name: "Slow", kind: "control", save: { type: "fortitude", dc: 18 } } },
  "kyra.spell.dirge": { action: { id: "kyra.spell.dirge", name: "Dirge of Doom", kind: "control", auto: true } }
};

let posted;
let created;
const was = { CONFIG: globalThis.CONFIG, fromUuid: globalThis.fromUuid };
beforeEach(() => {
  posted = [];
  created = [];
  globalThis.CONFIG = {
    ChatMessage: { documentClass: { getSpeaker: ({ token }) => ({ token: token?.id ?? null, alias: token?.name ?? null }), create: async data => { posted.push(data); return { id: `m${posted.length}` }; } } }
  };
  globalThis.fromUuid = async uuid => (uuid === LOH_EFFECT ? {
    documentName: "Item", type: "effect", name: "Spell Effect: Lay on Hands", toObject: () => ({ _id: "e1", type: "effect", name: "Spell Effect: Lay on Hands", system: {} }),
    toAnchor: () => ({ outerHTML: `<a class="content-link" draggable="true" data-uuid="${LOH_EFFECT}">Spell Effect: Lay on Hands</a>` })
  } : null);
  globalThis.game.users = [{ id: "gm", isGM: true }, { id: "p1", isGM: false }];
  globalThis.game.pf2e = { settings: { tokens: { nameVisibility: false } } };
});
afterEach(() => Object.assign(globalThis, was));

/** A token and its sheet, as commitPf2eChanges writes onto it (what this needs of it). */
function token(id, name = id) {
  const items = [];
  const actor = {
    id, uuid: `Actor.${id}`, hasPlayerOwner: true, items, itemTypes: { condition: [], effect: [] },
    system: { attributes: { hp: { value: 20, max: 20, temp: 0 } }, resources: {} },
    update: async () => actor,
    createEmbeddedDocuments: async (type, data) => data.map((d, i) => { const made = { ...d, id: `${id}-made${i}` }; created.push(made); items.push(made); return made; })
  };
  return { id: `t-${id}`, name, uuid: `Scene.s.Token.t-${id}`, actor, playersCanSeeName: true };
}

const docs = { seelah: token("seelah", "Seelah"), lem: token("lem", "Lem"), kyra: token("kyra", "Kyra"), amiri: token("amiri", "Amiri"), ezren: token("ezren", "Ezren"), goblin: token("goblin", "Goblin") };
const options = (audience = () => "public") => ({ live: true, effectSource: key => ACTIONS[key] ?? null, tokenOf: id => docs[id] ?? null, audience });
const final = { status: "standing", resources: {} };
const spec = id => ({ id, kind: "pc", actions: [], resources: {} });

describe("a card naming who got which effect", () => {
  test("a heal's bonus for another: from its caster, naming whom it went to and what, its effect linked; and laid", async () => {
    const changes = { effects: { added: [{ key: "seelah.spell.loh", sourceId: "seelah", rounds: 1, label: "+2 AC" }], ended: [] } };
    await commitPf2eChanges(docs.lem, spec("lem"), changes, final, options());
    expect(posted).toHaveLength(1);
    const [card] = posted;
    expect(card.speaker).toMatchObject({ token: "t-seelah", alias: "Seelah" });
    expect(card.content).toContain("Lay on Hands");
    expect(card.content).toContain("Lem");
    expect(card.content).toContain("+2 AC");
    expect(card.content).toContain(`data-uuid="${LOH_EFFECT}"`);
    expect(card.whisper).toBeUndefined();
    // (The effect itself on Lem's sheet.)
    expect(created.map(e => e.name)).toEqual(["Spell Effect: Lay on Hands"]);
  });

  test("conditions an effect laid alone, with no save (Dirge of Doom): named too", async () => {
    const changes = { conditions: { set: {}, cleared: [] }, laid: [{ key: "kyra.spell.dirge", sourceId: "kyra", label: "frightened 1", conditions: { frightened: 1 } }] };
    await commitPf2eChanges(docs.goblin, { ...spec("goblin"), kind: "npc" }, changes, final, options());
    expect(posted).toHaveLength(1);
    expect(posted[0].content).toContain("Dirge of Doom");
    expect(posted[0].content).toContain("Goblin");
    expect(posted[0].content).toContain("frightened 1");
  });

  test("not where PF2e's own card names whom it went to (a save), nor an action only its user takes, on itself", async () => {
    await commitPf2eChanges(docs.goblin, { ...spec("goblin"), kind: "npc" }, { effects: { added: [{ key: "ezren.spell.slow", sourceId: "ezren", label: "slowed 1" }], ended: [] } }, final, options());
    await commitPf2eChanges(docs.amiri, spec("amiri"), { effects: { added: [{ key: "amiri.self.rage", sourceId: "amiri", label: "+2 damage" }], ended: [] } }, final, options());
    expect(posted).toEqual([]);
    // (A buff that may go to anyone, laid on its own caster: named, as it might have gone to another.)
    await commitPf2eChanges(docs.kyra, spec("kyra"), { effects: { added: [{ key: "kyra.spell.bless", sourceId: "kyra", label: "+1 attack" }], ended: [] } }, final, options());
    expect(posted).toHaveLength(1);
  });

  test("for the GMs alone where either is hidden from the players", async () => {
    const changes = { effects: { added: [{ key: "seelah.spell.loh", sourceId: "seelah", label: "+2 AC" }], ended: [] } };
    await commitPf2eChanges(docs.lem, spec("lem"), changes, final, options(id => (id === "seelah" ? "gm" : "public")));
    expect(posted[0].whisper).toEqual(["gm"]);
  });

  test("one the table settles itself: named as waiting, not laid", async () => {
    const changes = { left: { hp: true, effects: [{ key: "seelah.spell.loh", sourceId: "seelah", rounds: 1, label: "+2 AC" }], laid: [] } };
    await commitPf2eChanges(docs.lem, spec("lem"), changes, final, options());
    expect(created).toEqual([]);
    expect(posted).toHaveLength(1);
    expect(posted[0].content).toContain("Lem");
    expect(posted[0].content).toContain(`data-uuid="${LOH_EFFECT}"`);
    // (Its words aren't the plain card's: it waits.)
    await commitPf2eChanges(docs.lem, spec("lem"), { effects: { added: changes.left.effects, ended: [] } }, final, options());
    expect(posted[0].content).not.toBe(posted[1].content);
  });

  test("an older core (none of its options): no card", async () => {
    await commitPf2eChanges(docs.lem, spec("lem"), { effects: { added: [{ key: "seelah.spell.loh", sourceId: "seelah", label: "+2 AC" }], ended: [] } }, final, { effectSource: options().effectSource });
    expect(posted).toEqual([]);
  });
});
