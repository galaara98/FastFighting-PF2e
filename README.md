# FastFighting PF2e

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

FastFighting Core runs the simulations, the Battle Planner, player surveys, stories and Make it So for any system. This module teaches it how PF2e works:

- **Reading actors:**
  - strikes (multiple attack penalty, agile, reach, reload, drawing unready weapons)
  - spells (spell attacks, basic and non-basic saves, auto-hit spells such as Force Barrage)
  - crowd-control spells, read degree by degree from their text (Fear, Slow, Sleep, Paralyze, Command, Tangle Vine ...), and damage spells' critical-failure riders (Daze's stunned 1)
  - Dominate: the target fights for you (controlled), with a Will save at the end of each of its turns
  - buff and debuff spells, from the rule elements of the Spell Effect they link: Bless, Heroism (heightened), Courageous Anthem, Protection, Benediction, Haste (quickened), Mystic Armor, Sure Strike for friends; Bane and Malediction for foes who fail their save; Dirge of Doom's frightened aura
  - skill actions: Demoralize (Intimidation against Will DC: frightened, once per foe), Trip (Athletics against Reflex DC, an attack; a critical failure lands you prone), Feint (Deception against Perception DC: off-guard to you, which sets up sneak attack), and Bon Mot for those with the feat
  - prepared and spontaneous slots, focus points
  - healing spells, potions and elixirs, Battle Medicine (one-action Heal and Battle Medicine are a touch, so the healer walks over first; two-action Heal reaches 30 feet)
  - sneak attack and pack attack, knockdown and grab
  - poisons and diseases parsed stage by stage from their text
  - immunities, weaknesses and resistances
  - speeds by movement type
  - languages, Diplomacy, Intimidation, Deception, Will and Perception DCs (for talking)
  - Thievery (for theft, against Perception DC), Medicine (for first aid after the fight), coins and gear (for what a creature could be talked into giving up or have stolen)
  - conditions, persistent damage and dying already on a creature (a fight resumed mid-way)
- **Rules:**
  - four degrees of success, natural 20/1, basic saves, and a minimum of 1 damage per hit;
  - the multiple attack penalty and three actions a turn;
  - off-guard, frightened, sickened, clumsy, enfeebled, prone, slowed, stunned, paralyzed and fleeing, each weighed as the penalties it is (frightened 1 is −1 to everything) when a creature decides whether it's worth inflicting;
  - range increments, and Steal at −5 in combat;
  - persistent damage with flat checks;
  - dying, wounded and doomed with recovery checks, and Administer First Aid (DC 15 + dying);
  - immunity by trait (mental, fear, emotion, sleep and others; the mindless shrug off mental effects), and incapacitation;
  - doors: a wooden door (Hardness 5, 20 HP) with a simple lock: Force Open (Athletics, one action) or Pick a Lock (trained Thievery and a thieves' toolkit, two actions), DC 20; opening one is an Interact action;
  - Reactive Strike: only creatures that have it (Attack of Opportunity, before the remaster) strike a foe leaving their reach, once a round. A careful creature Steps out of reach first.
- **Personality defaults:** Tactical, Brave, Selfish and Loyal come from the creature's data: mindless, animal, undead, construct, minion, Intelligence, Wisdom, Will save. Leadership comes from Diplomacy, Intimidation and Warfare Lore, the Commander class and its tactics, and rallying abilities.
- **Recognised by slug:** abilities, feats and spells it has to know (Sneak Attack, Pack Attack, Reactive Strike, Battle Medicine, Bon Mot, knockdown and grab) are found by their slug, the same in every language, so a translated game works too.
- **Difficulty cross-check:** compares the simulation with the PF2e encounter XP budget.
- **Make it So for PF2e:** writes:
  - HP and temp HP;
  - dying, wounded, unconscious, prone and lingering conditions;
  - persistent damage conditions, and affliction effects (noting any onset still to come);
  - death, and lootable corpses or loot piles (gear moves off the corpse);
  - expended slots and focus, and used consumables;
  - surrender and side switches (alliance and disposition);
  - coins (with change made) and items handed over by someone talked into it or robbed.

  A retreating PC stays on the map.

## Installation

Install **FastFighting Core** first, then this module, using this manifest URL:

```
https://github.com/galaara98/FastFighting-PF2e/releases/latest/download/module.json
```

Enable both in a PF2e world.

## Note

PF2e ties token disposition to the actor's *alliance*. To make a creature Neutral for FastFighting, set its alliance to Neutral on the actor sheet.

## Development

Check out this repository next to the core repository (`../FastFighting`). Then run `npm install` and `npm test`; the tests use the core engine through `vitest.config.js`, which you can point elsewhere with `FASTFIGHTING_CORE`. Junction or symlink the folder into Foundry as `Data/modules/fast-fighting-pf2e`.

This module is also the reference for writing a FastFighting helper for another system: see `scripts/main.js` and `scripts/adapter.js`, and the API section of the core README.
