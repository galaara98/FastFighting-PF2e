# FastFighting PF2e: developer notes

What the module does at the table is in [README.md](README.md). FastFighting Core's API, hooks and adapter contract are in [its developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md).

This module is also the reference for writing a FastFighting helper for another system: start from `scripts/main.js` and `scripts/adapter.js`.

## How it plugs into the core

- **module.json** requires `fast-fighting` 0.3.0 or later and the `pf2e` system 8.0.0 or later, on Foundry 14. It loads one esmodule, `scripts/main.js`, and one language file, `languages/en.json`.
- **scripts/main.js**
  - `init`: registers the Lore-Collector advantage setting (`lore.js`: key `loreBoost`, world scope, 1.25 to 3 in steps of 0.05, default 2, through the core's `numberSetting`).
  - `fastFighting.init` (receives the core's `api`): outside a `pf2e` world it logs a warning and stays inactive. The core's API version is `major.bug` (`api.version` "18.0", `api.major`, `api.bug`), and whether this helper works with a core is its own call (the core never refuses a helper): `KNOWN_API` lists the majors it's known to work with ([18, 19]). A core older than the oldest gets a console error and a permanent `FFPF2E.CoreTooOld` notification, and the helper stays out; any other major it doesn't know, it runs with, and the GM is told once at ready (`FFPF2E.CoreUntested`). Add a major to `KNOWN_API` once the helper has been tried with it. Then it calls `api.registerAdapter("pf2e", Pf2eAdapter, { priority: 10, source: MODULE_ID })`, `api.adviseTranslation(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS)` (the PF2e translation modules it knows, by language; in a language other than English, the settings recommend the one that isn't on) and `api.keepEnglish(MODULE_ID)` (`hardcoded-toEN.json`).
  - `ready`: warns a GM with `FFPF2E.NeedsCore` when the core isn't active.
- **scripts/core.js** re-exports `../../fast-fighting/scripts/core-api.js`, the one path into the core. Both modules sit side by side in `Data/modules`; the tests alias the path to the core repository (`vitest.config.js`).
- **When the core falls short:** if new functionality needs something the core can't play close enough with what it already offers, request a new core hook. Don't force a poor fit or work around the core.

## The adapter (scripts/adapter.js)

`Pf2eAdapter extends SystemAdapter` (`systemId` `"pf2e"`). Data paths are verified against pf2e 8.6.0 on Foundry v14.

- **Reading:** `canHandle`, `toCombatantSpec(tokenDoc)` and its private readers (`#strikes`, `#elementalBlasts`, `#spells`, `#summon`, `#spellSupport`, `#selfEffects`, `#abilities`, `#marks`, `#mending`, `#reactions`, `#skillActions`, `#consumables`, `#poisons`, `#feats`, `#facts`, `#senses`, `#conditions`, `#persistent`, `#valuables`, `#social`, `#recallKnowledge`), `describeRegionBehavior`, `itemCatalog`, `term`, `biography`.
- **Personality and setup:** `deriveTraits` (`traits.js`), `playstyleHints` and `tacticHints` (`auto.js`), `detectLeaders` (`leadership.js`).
- **Live battles:** `supportsLive`, `commitChanges` (`commit.js`, returning an undo record), `commitBound`, `commitConcession`, `describeOutcome`, `liveOwnership`, `readLiveState`, `readTurn` and `liveOpening` (`read-turn.js`, from PF2e's chat cards), `reactionsOf`, `sheetCarries`, `conditionLabel`, `conditionChoices`, `rerollResource` (Hero Points), `resourceLabel`.
- **Players' damage (API 19):** `damageCard` (`read-turn.js` `pf2eDamageCard`), `applyDamageCard` (`commit.js` `applyPf2eDamageCard`: PF2e's `applyDamageFromMessage` for one token, through its `actor.applyDamage`) and `appliesPlayerDamage` (null: no PF2e setting does it).
- **Other:** `rules` (`pf2eRules`), `supportsLoot`.

Spell Effect items are fetched once a session (`EFFECT_CACHE`); a summon spell's creature comes from the Actor compendiums, the Monster Core first, never a unique one (`CREATURE_CACHE`, `SUMMON_LEVEL`, `SUMMON_TRAITS`). In a world translated with Babele, an item's rules are read from its English original (the core's `englishName` and `englishDescription`), so they parse in any language.

## Rules keys (scripts/rules.js)

`pf2eRules` is pure: no Foundry globals. Most keys have a doc comment; by concern:

| Concern | Keys |
| --- | --- |
| Turns and rolls | `id`, `actionsPerTurn` (3), `turn` (a minion 2), `degreeOfSuccess`, `roll` (fortune and misfortune), `attackPenalty`, `basicSaveMultiplier`, `saveMultiplier`, `afflictionStep`, `critical`, `minimumDamage` (1), `typical` (moderate guidelines: AC 15 + level, save level + 5, skill level + 4, DC level + 15) |
| Situation | `modifiers` (`exposed`, `defense`, `attack`, `save`, `check`, `steal`, `actionsLost` ...), `handlesCover`, `stealthInitiative`, `tauntCost`, `pullsBlow` (nonlethal) |
| Reactions | `reactions`, `opportunityOn`, `opportunity` (Reactive Strike), `disengage` (Step) |
| Space | `endIn`, `passThrough`, `tumbleThrough`, `fallDamage`, `fallProne` |
| Hands and holds | `handsKnown`, `tiedBars`, `holdBrings`, `escapeFrom`, `bondsDC`, `escapeCost`, `breakFree`, `cutFree`, `holds`, `untieCost`, `stopBleeding` |
| Gullets | `conditionHarm`, `usable`, `canTarget`, `afterHarm` (Rupture), `letGo` |
| Roll hooks | `onOutcome` (Take Cover), `afterRoll`, `afterAttack` (hidden), `disrupted` (stupefied spell loss), `adjustRoll` (flat checks), `startTurn` (drained) |
| Doors | `door`, `doorCosts`, `doorDamage` (Hardness) |
| Dying and healing | `avertDeath` (Heroic Recovery), `onDropped` (Ferocity), `dyingLimit`, `onHealed`, `recoveryCheck`, `firstAidCost`, `firstAidDC`, `firstAid` |
| Immunity and conditions | `isImmune`, `controlShift` (incapacitation), `conditionMods`, `fearValued`, `conditionWishes`, `conditionWeight`, `applyIwr` |
| Persistent damage and remedies | `persistentFlatCheck`, `persistentRemedyCost`, `persistentRemedy`, `remedies`, `retch` |
| Story | `storyDamageType` |

## Module map (scripts/)

| File | What it does |
| --- | --- |
| `main.js` | Hooks and registration (above). |
| `core.js` | The import path to the core. |
| `adapter.js` | `Pf2eAdapter`: actors to CombatantSpecs, and live battles back. |
| `rules.js` | `pf2eRules`. |
| `words.js` | `t` (this module's keys), PF2e's own names for actions, traits, conditions and coins, and `featureName` (a character's own item name, else `FFPF2E.Feature.<slug>`). |
| `abilities.js` | Save abilities from inline checks (`@Check`, `@Damage`, `@Template`, cooldowns). |
| `afflictions.js` | Poisons, diseases and curses from their text, stage by stage. |
| `control.js` | Crowd-control spells by degree, critical riders, holds an Escape breaks. |
| `effects.js` | Spell Effect rule elements to buffs and debuffs; `ONE_ROLL` for one-roll spells. |
| `class-actions.js` | Vicious Swing, Double Slice, Sudden Charge, Flurry of Blows, Hunter's Edge. |
| `maneuvers.js` | The skill actions as core maneuvers; `strikeMove` for Push and Pull. |
| `edges.js` | Aid (`AID_DC` 15). |
| `lore.js` | The Lore-Collector advantage setting. |
| `holds.js` | Escape DCs and checks (`levelDC`, `escapeOf`, `escapeWork`). |
| `hands.js` | Free hands each action needs. |
| `gullet.js` | Swallow Whole and Engulf. |
| `remedies.js` | Assisted recovery, First Aid on a bleed, retching. |
| `traits.js` | Personality defaults (`derivePf2eTraits`, `ruleLeans`, `creatureKindOf`). |
| `auto.js` | Playstyle hints and tactics answers for "set up by itself" (`pf2eHints`, `pf2eTactics`). |
| `leadership.js` | `rankLeaders`. |
| `commit.js` | Writing a live battle's turn (`commitPf2eChanges` and the undo record's shape), surrender, concessions, tied-up creatures. |
| `read-turn.js` | A player's turn read from PF2e's chat cards (`flags.pf2e.context`). |


## Slugs

Features are found by slug (the same in every language). Where each lives:

- **adapter.js:** attack effects `knockdown`, `improved-knockdown`, `trip`, `improved-trip` (prone rider, `PRONE_EFFECTS`) and `grab`, `improved-grab` (`GRAB_EFFECTS`); `ferocity`, `orc-ferocity` (`FEROCITY`) and `undying-ferocity`; `sneak-attack`, `pack-attack`; `battle-medicine`, `bon-mot`; reactions `shield-block`, `reactive-shield`, `nimble-dodge`, `intercept-attack`, `retributive-strike`, `glimpse-of-redemption`, `liberating-step`; `devise-a-stratagem`, `exploit-vulnerability`, `elemental-blast` (or the `kineticist` class); summon spells (`SUMMON_TRAITS`: `summon-animal` to `animal` ...); `heal`, `heal-animal`, `heal-companion` (`HEAL_SPELLS_TWO_ACTION_BONUS`); the roll options `implements-empowerment` (`ALWAYS_ON`) and `formation`; senses (`SENSES`: `darkvision`, `greater-darkvision`, `infrared-vision`, `truesight` to lowlight, `scent` to smell, any other to feel except `NOT_SENSES`: `vision`, `low-light-vision`, `see-invisibility`); the `commander` class. Regeneration and fast healing come from rule elements, not slugs.
- **maneuvers.js:** `strikeMove` reads `push`, `improved-push`, `push-or-pull`, `pull` and their `-N-feet` forms.
- **gullet.js:** `GULLETS`: `swallow-whole` to swallowed, `engulf` to engulfed.
- **class-actions.js:** `vicious-swing`, `power-attack`, `double-slice`, `sudden-charge`, `flurry-of-blows`; `hunt-prey` with `flurry` or `precision`.
- **traits.js:** `reactive-strike` or `attack-of-opportunity` set `flags.reactiveStrike`; `CLASS_LEANS`, `ANCESTRY_LEANS`, `BACKGROUND_LEANS`, `SKILL_LEANS`, `ITEM_LEANS`, `SELFISH_BY_TRAIT`, `LOYAL_BY_TRAIT`, `SANCTIFIED`.
- **auto.js:** `CLASSES`, `ANCESTRIES`, `TRAITS` (playstyle hints); `CLASS_STYLE`, `SUBCLASS_STYLE`, `CASTERS`; `GUARD_SLUGS`, `SELF_GUARD_SLUGS`, `RESCUE_SLUGS`; `CONSUMABLE_FEATS`.
- **read-turn.js:** `MANEUVERS` (action slugs to the core's maneuvers; `create-a-diversion` is distract) and `TALK`.

## Words and translation

Every word this module shows is in `languages/en.json`; the code holds keys, never English. Translating takes only a copy of that file (see **Translating** in [the core's README](https://github.com/galaara98/FastFighting)). `npm run test:reworded` runs the tests with every word in the language files reworded, so no test depends on the wording.

`hardcoded-toEN.json` lists words that stay in English for now, whatever the reader's language: keys of `languages/en.json`, or a group (`"FFPF2E.Action"`), whose translation would contradict a game system that isn't translated yet. It holds the date it was last updated (`lastUpdated`) and the list (`keys`), and is edited like the language files.

## Development

Check out this repository next to the core (`../FastFighting`), then run `npm install` and `npm test`. The tests use the core through `vitest.config.js`; point them elsewhere with `FASTFIGHTING_CORE`. Junction or symlink the folder into Foundry as `Data/modules/fast-fighting-pf2e`.

- `npm test` (`vitest run`) and `npm run test:reworded` (`vitest run --mode reworded`). `tests/setup.js` gives each test a fake `game.i18n` that reads this module's and the core's language files (`tests/foundry-i18n.js`).
- `.github/workflows/test.yml` runs both on every push to `main` and every pull request, with the core checked out beside this repository.
- `.github/workflows/release.yml` runs on a `v*` tag: it tests, sets `version` and `download` in module.json, zips `module.json`, `scripts`, `languages`, `hardcoded-toEN.json`, `README.md` and `LICENSE` into `module.zip`, and publishes both files as a GitHub release.
