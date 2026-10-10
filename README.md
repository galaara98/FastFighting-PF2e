# FastFighting PF2e

Pathfinder Second Edition support for [FastFighting Core](https://github.com/galaara98/FastFighting), the Foundry VTT battle estimator, storyteller and resolver.

FastFighting Core runs the simulations, the Battle Planner, player surveys, stories and Make it So for any system. This module teaches it how PF2e works:

- **Reading actors:**
  - strikes (multiple attack penalty, agile, reach, reload, drawing unready weapons)
  - spells (spell attacks, basic and non-basic saves, auto-hit spells such as Force Barrage)
  - prepared and spontaneous slots, focus points
  - healing spells, potions and elixirs, Battle Medicine
  - sneak attack and pack attack, knockdown and grab
  - poisons and diseases parsed stage by stage from their text
  - immunities, weaknesses and resistances
  - speeds by movement type
  - languages, Diplomacy, Intimidation, Deception, Will and Perception DCs (for talking)
- **Rules:** four degrees of success, natural 20/1, basic saves, persistent damage with flat checks, and dying, wounded and doomed with recovery checks.
- **Personality defaults:** Tactical, Brave, Selfish and Loyal come from the creature's data: mindless, animal, undead, construct, minion, Intelligence, Wisdom, Will save. Leadership comes from Diplomacy, Intimidation and Warfare Lore, the Commander class and its tactics, and rallying abilities.
- **Difficulty cross-check:** compares the simulation with the PF2e encounter XP budget.
- **Make it So for PF2e:** writes HP and temp HP, dying, wounded, unconscious, prone and lingering conditions, persistent damage conditions, affliction effects, death, lootable corpses or loot piles, expended slots and focus, used consumables, surrender, and side switches (alliance and disposition).

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
