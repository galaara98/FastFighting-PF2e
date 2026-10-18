# FastFighting PF2e: developer notes

What the module does at the table is in [README.md](README.md). FastFighting Core's API, hooks and adapter contract are in [its developer docs](https://github.com/galaara98/FastFighting/blob/main/CODING_README.md).

This module is also the reference for writing a FastFighting helper for another system: start from `scripts/main.js` and `scripts/adapter.js`.

## How it plugs into the core

- **module.json** requires `fast-fighting` 0.4.0 or later and the `pf2e` system 8.0.0 or later, on Foundry 14. It loads one esmodule, `scripts/main.js`, and one language file, `languages/en.json`.
- **scripts/main.js**
  - `init`: registers the Lore-Collector advantage setting (`lore.js`: key `loreBoost`, world scope, 1.25 to 3 in steps of 0.05, default 2, through the core's `numberSetting`).
  - `fastFighting.init` (receives the core's `api`): outside a `pf2e` world it logs a warning and stays inactive. The core's API version is `major.bug` (`api.version` "19.0", `api.major`, `api.bug`), and whether this helper works with a core is its own call (the core never refuses a helper): `KNOWN_API` lists the majors it's known to work with ([19]). A core older than the oldest gets a console error and a permanent `FFPF2E.CoreTooOld` notification, and the helper stays out; any other major it doesn't know, it runs with, and the GM is told once at ready (`FFPF2E.CoreUntested`). Add a major to `KNOWN_API` once the helper has been tried with it. Then it calls `api.registerAdapter("pf2e", Pf2eAdapter, { priority: 10, source: MODULE_ID })`, `api.adviseTranslation(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS)` (the PF2e translation modules it knows, by language; in a language other than English, the settings recommend the one that isn't on) and `api.keepEnglish(MODULE_ID)` (`hardcoded-toEN.json`).
  - `ready`: warns a GM with `FFPF2E.NeedsCore` when the core isn't active.
  - `renderChatMessageHTML` and `getChatMessageContextOptions`: no Apply on the damage cards FastFighting applies itself (`cards.js`, below).
- **scripts/core.js** re-exports `../../fast-fighting/scripts/core-api.js`, the one path into the core. Both modules sit side by side in `Data/modules`; the tests alias the path to the core repository (`vitest.config.js`).
- **When the core falls short:** if new functionality needs something the core can't play close enough with what it already offers, request a new core hook. Don't force a poor fit or work around the core.

## The adapter (scripts/adapter.js)

`Pf2eAdapter extends SystemAdapter` (`systemId` `"pf2e"`). Data paths are verified against pf2e 8.6.0 on Foundry v14.

- **Reading:** `canHandle`, `toCombatantSpec(tokenDoc)` and its private readers (`#strikes`, `#elementalBlasts`, `#spells`, `#summon`, `#spellSupport`, `#selfEffects`, `#abilities`, `#glossary` (`glossary.js`), `#marks`, `#mending`, `#reactions` (a champion's for an ally: `champion.js`), `#skillActions`, `#consumables`, `#poisons`, `#feats`, `#facts`, `#senses`, `#conditions`, `#persistent`, `#valuables`, `#social`, `#recallKnowledge`), `describeRegionBehavior`, `itemCatalog`, `term`, `biography`.
- **Personality and setup:** `deriveTraits` (`traits.js`), `playstyleHints` and `tacticHints` (`auto.js`), `detectLeaders` (`leadership.js`).
- **Live battles:** `supportsLive`, `commitChanges` (`commit.js`, returning an undo record), `commitBound`, `commitConcession`, `describeOutcome`, `liveOwnership`, `readLiveState`, `readTurn` and `liveOpening` (`read-turn.js`, from PF2e's chat cards), `reactionsOf`, `sheetCarries`, `conditionLabel`, `conditionChoices`, `rerollResource` (Hero Points), `resourceLabel`.
- **Players' damage (API 19):** `damageCard` (`read-turn.js` `pf2eDamageCard`), `applyDamageCard` (`commit.js` `applyPf2eDamageCard`: PF2e's `applyDamageFromMessage` for one token, through its `actor.applyDamage`, `roll.alter(multiplier)` as its Half and Double buttons do) and `appliesPlayerDamage` (null: no PF2e setting does it). `applyDamageCard` applies FastFighting's own damage cards the same way (below), times the card's mark.
- **Strikes (API 19):** `rollStrike` (`strike-roll.js` `rollPf2eStrike`: the engine's strike id back to the sheet's Strike, the variant for `attackNumber` (MAP, no further than the third) and its `damage` or `critical` with that `mapIncreases`, with PF2e's `target` param, so no dialog and the user's targets untouched; `secret` holds Ctrl, PF2e's GM roll), for every Strike in a turn FastFighting plays and for reactions. It returns the damage card it made (`card`). Its damage card is applied through `applyDamageCard`; Shield Block's reaction spec says `applies: "shieldBlock"`, so a live battle applies a blow it blocked with PF2e's own Shield Block (`shieldBlockRequest`, which needs the shield raised, as the engine does).
  - A champion's reaction for an ally (`champion.js`) says `applies: "effect:<its item id>"` when its card links an effect that resists all damage (`granted.js`: Champion's Resistance). The core hands it to `applyDamageCard` with `{by: the champion's token}`; `commit.js` `friendsGrant` lays the effect on the target's contextual copy for this blow only, as PF2e lays its ephemeral effects, with the champion and the reaction as its origin (as when the link is dragged from the card), so `@item.origin.level` is the champion's. PF2e's `applyDamage` applies the resistance and its damage-taken card shows it. The sheet never holds the effect, so nothing is removed or undone. The spec's `reduce` (`resistanceOf`: 2 + level) is the engine's estimate; the core takes what the sheet lost instead, so the blow is lessened once. Without such a link there's no `applies`, and the engine's sum stands.
  - A spell attack (`spellAttackFor`: the id `<actor>.spell.<spell id>`, a spell with the attack trait, damage and a spellcasting entry) is rolled as its card's buttons roll it: `spell.rollAttack(event, attackNumber + 1, {target: the target's actor})` (PF2e finds the token by its actor's tokens on this canvas, so only at a target drawn here; else null, the engine's roll), and on a hit `spell.rollDamage(event)` at the spell's rank. PF2e's spell damage takes no target but the user's own targets (left untouched; a GM's, none as a rule), so the damage card has no target or, with the GM targeting something, that one. PF2e doesn't double a spell's damage roll on a critical hit, only its Double button as it's applied: then `byType` is doubled and the card is marked to be applied doubled (`cards.js`). A spell attack with no damage is crowd control, the engine's roll.
- **An action's card and its damage (API 19):** `useAction` and `rollDamage` (`action-roll.js`). The action's item by its id: `<actor>.spell.<id>` a spell, `<actor>.self.<id>` an action or feat (Rage), `<actor>.item.<id>` a consumable, `<actor>.<id>` an action or feat (an ability: `abilities.js`); never a melee item (its `toMessage` rolls the Strike).
  - `useAction`: a spell's card as its spellcasting entry's `cast` posts it, without `consume`: `spell.toMessage(null, {actualCast: true, data: {castRank: rank}, mode})`, so no slot, focus point or use is spent; PF2e places a template only from the card's button. Any other item's card as its sheet posts it (`item.toMessage(null, {mode})`, nothing used; a consumable's card keeps its Use button). `mode` is `gm` (a player's, `blind`) when `secret`. Null for an action with no item (Take Cover, Aid, Battle Medicine, a Strike) and for a spell attack `rollStrike` rolls (its attack card shows the spell); a spell attack it can't roll (a target not drawn here) shows its card. The core asks for spells, save and auto actions, and any buff or heal with no check of its own.
  - `rollDamage`: a spell's damage as its card's Damage button rolls it (`spell.rollDamage(event)`, `secret` holding Ctrl); an ability's by the first `@Damage` link on its card (`card`, useAction's) that isn't persistent damage alone, clicked as the GM would: the card is rendered (`message.renderHTML()`) and the link handed to `CONFIG.ux.TextEditor._onClickInlineRoll` (PF2e's inline damage: the card's speaker and item, an elite or weak creature's adjustment, rule elements). PF2e's inline damage takes no Ctrl, so a `secret` roll adds PF2e's `secret` roll option to the link. `damage.byType` is as rolled, before resistances, in PF2e's damage types (the rules' keys); persistent damage is left out, as `rollStrike`'s is (PF2e's application lays it as its condition, which `readLiveState` reads). Null (the engine rolls it) for a spell attack (`rollStrike`'s), Force Barrage (`PART_CARDS`: its card is one missile's), a spell with no damage, a consumable, an ability with no damage link (Trample, a Strike's damage) or no card. Nothing is applied: the core applies each target's share with `applyDamageCard` and `multiplier` (0.5 a basic save's success, 2 a critical failure).
  - **No damage applied twice** (`cards.js`): every damage card `rollStrike` and `rollDamage` make is marked (`flags["fast-fighting-pf2e"].rolled: {times}`, `setFlag`). FastFighting applies it (or, a reaction having lessened the blow, its own sum, or nothing where a flat check turned the hit into a miss), so `main.js` takes its Apply buttons off as it renders (`renderChatMessageHTML`: `.damage-application` emptied, a `FFPF2E.DamageHandled` line in their place) and PF2e's Apply entries off its chat menu (`getChatMessageContextOptions`: the `PF2E.DamageButton.*` entries hidden on it), for GMs and players alike. Other cards are as PF2e has them.
- **Saves and checks (API 19):** `rollSave` and `rollCheck` (`check-roll.js`), against the engine's DC as `{value}`, no dialog, PF2e's GM roll when `secret`; the details are in its header.
  - A save: `actor.saves[key]` (of several keys, the best), `from`'s actor as `origin`, and the item the action's id names (`itemIn`; with no `from`, from the actor the id begins with). Not an item with the incapacitation trait: the engine's `rules.controlShift` shifts that degree.
  - A check: PF2e's own action (`game.pf2e.actions`) where it has one (`ACTIONS` by the id's last part, `PURPOSES` by purpose; Aid with the best of `AID_SKILLS`); else the statistic (`ITEM_SKILLS` for a feat or ability, Medicine to heal, the skill the spec names by slug or label, talk by its kind of pitch). With `against` and the target's token drawn, the target goes along and the DC carries `slug: against`. Null (the engine rolls it) for `cast`, an Aid whose best way is a Strike (PF2e's Aid rolls a skill), and anything it can't place; never `{gm: true}`.
  - Multiple attack penalty: the core's `attackNumber` for a check with the attack trait (as the engine counted it for its own penalty; null, none): PF2e's action takes it as `multipleAttackPenalty`, an item's check as `attackNumber` + 1. One with neither is left to the engine. An Escape takes none, as the engine's doesn't, though PF2e's has the attack trait.
  - The helper's rules that roll a check or save themselves ask the same way (core-api `systemRolled`, its answer as `rollCheck`'s `rolled`, the engine's DC kept; no answer, the engine's dice): `breakFree`'s Escape (`escape`), `stopBleeding` (`firstAid`, its action id ending in `stop-bleeding`, Administer First Aid's variant), `retch` (a `fortitude` save), `tumbleThrough` (`tumble`, `against: "reflex"`, the foe its target: PF2e's `tumble-through` action) and every flat check (`rules.js` `flatRoll`, `flat`: PF2e's flat check, `game.pf2e.Check.roll` with an empty `CheckModifier`, `type: "flat-check"`, titled `FFPF2E.FlatCheckFor` with the rules' label). The flat checks: an attack's against one hidden, concealed or by one dazzled (`adjustRoll`, the attacker's at its target), a targeted spell's save (`adjustRoll`, the caster's), stupefied (`disrupted`), persistent damage (`persistentFlatCheck(rng, {run, unit, type})`, its type in the label), dropping and rolling (`persistentRemedy`), and the bleeder's after Administer First Aid (`stopBleeding`). `adjustRoll` is called after a strike or save the system rolled too (`ctx.rolled`): PF2e rolls no flat check of its own, so the flat check stands, and `adjustRoll` does nothing else to that roll (a hit's damage card already in the chat isn't applied once the flat check makes it a miss). Still the engine's dice: `cutFree` and the dying recovery check (`recoveryCheck` has no run to ask with, and PF2e's own `rollRecovery` would change the sheet itself). The named imports from core-api need a core that exports them (API 19).
- **Surprise (API 19):** `rules.surprise` (`rules.js`, the planner's Follow System): hidden tokens (Avoiding Notice) roll Stealth for initiative (`stealthSides`), and one whose Stealth (d20 + Stealth) beats every foe's Perception DC starts `hidden`, its first Strike finding its target off-guard; no surprise round, no one surprised.
- **Other:** `rules` (`pf2eRules`), `supportsLoot`.

Effect items are fetched once a session (`granted.js` `EFFECT_CACHE`); a summon spell's creature comes from the Actor compendiums, the Monster Core first, never a unique one (`CREATURE_CACHE`, `SUMMON_LEVEL`, `SUMMON_TRAITS`). In a world translated with Babele, an item's rules are read from its English original (the core's `englishName` and `englishDescription`), so they parse in any language.

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
| `abilities.js` | Save abilities from inline checks (`@Check`, `@Damage`, `@Template`, cooldowns); one with a Requirements line it can express carries the core's `requires`, and with no save its damage simply lands. |
| `requirements.js` | An ability's Requirements line as the core's `action.requires` (holding, lastHit, target, self, shieldRaised), by `reading/en.json`'s "requirements"; `strikesNamed` finds the Strikes a line names. |
| `glossary.js` | Standard creature abilities by slug: Draconic Frenzy, Rend and Pounce built from its Strikes, Constrict and Draconic Momentum marked on actions read already, its passives on the spec; `NO_FIGHT_EFFECT` and `PLAYED_ELSEWHERE`. |
| `afflictions.js` | Poisons, diseases and curses from their text, stage by stage. |
| `control.js` | Crowd-control spells by degree, critical riders, holds an Escape breaks. |
| `effects.js` | Spell Effect rule elements to buffs and debuffs; `ONE_ROLL` for one-roll spells. |
| `granted.js` | The effects an item's text links (`linkedEffect`, `theirsToOpen`), and the resistance a reaction's linked effect grants (`grantedResistance`, `resistanceOf`). |
| `champion.js` | A champion's reactions for an ally: its aura (`championAura`: PF2e's `actor.auras` entry `champions-aura`, else `flags.system.champion.aura`, else 15 feet), as `range` and `byRange`; the linked effect's resistance; Retributive Strike's Strike and Nimble Reprisal. |
| `class-actions.js` | Vicious Swing, Double Slice, Sudden Charge, Flurry of Blows, Hunter's Edge. |
| `maneuvers.js` | The skill actions as core maneuvers; `strikeMove` for Push and Pull. |
| `edges.js` | Aid (`AID_DC` 15). |
| `lore.js` | The Lore-Collector advantage setting. |
| `holds.js` | Escape DCs and checks (`levelDC`, `escapeOf`, `escapeWork`). |
| `hands.js` | Free hands each action needs. |
| `gullet.js` | Swallow Whole and Engulf. |
| `remedies.js` | Assisted recovery, First Aid on a bleed, retching. |
| `traits.js` | Personality defaults (`derivePf2eTraits`, `ruleLeans`, `creatureKindOf`, `animalisticOf`). |
| `auto.js` | Playstyle hints and tactics answers for "set up by itself" (`pf2eHints`, `pf2eTactics`). |
| `leadership.js` | `rankLeaders`. |
| `commit.js` | Writing a live battle's turn (`commitPf2eChanges` and the undo record's shape), surrender, concessions, tied-up creatures. |
| `read-turn.js` | A player's turn read from PF2e's chat cards (`flags.pf2e.context`). |
| `strike-roll.js` | A Strike or a spell attack rolled with PF2e's own roller (a live battle's turns and reactions); `strikesOf` and `strikeId`, the Strikes' action ids. |
| `check-roll.js` | Saves and checks rolled with PF2e's own rollers (a live battle's turns), flat checks and Tumble Through among them. |
| `action-roll.js` | An action's own card (`useAction`) and its damage (`rollDamage`), as its user shows and rolls them (a live battle's turns). |
| `reading.js` | The words PF2e's own text is read by where its data says nothing (`reading/en.json`, and the reader's language's `reading/<lang>.json` tried first): `loadReading` at startup, `reading`, `currentReading`. |
| `cards.js` | FastFighting's own damage cards: marked, their Apply buttons and menu entries gone, a spell attack's critical applied doubled. |


## Slugs

Features are found by slug (the same in every language). Where each lives:

- **adapter.js:** attack effects `knockdown`, `improved-knockdown`, `trip`, `improved-trip` (prone rider, `PRONE_EFFECTS`) and `grab`, `improved-grab` (`GRAB_EFFECTS`); `ferocity`, `orc-ferocity` (`FEROCITY`) and `undying-ferocity`; `sneak-attack`, `pack-attack`; `battle-medicine`, `bon-mot`; reactions `shield-block`, `reactive-shield`, `nimble-dodge`, `intercept-attack`; `devise-a-stratagem`, `exploit-vulnerability`, `elemental-blast` (or the `kineticist` class); summon spells (`SUMMON_TRAITS`: `summon-animal` to `animal` ...); `heal`, `heal-animal`, `heal-companion` (`HEAL_SPELLS_TWO_ACTION_BONUS`); the roll options `implements-empowerment` (`ALWAYS_ON`) and `formation`; senses (`SENSES`: `darkvision`, `greater-darkvision`, `infrared-vision`, `truesight` to lowlight, `scent` to smell, any other to feel except `NOT_SENSES`: `vision`, `low-light-vision`, `see-invisibility`); the `commander` class. Regeneration and fast healing come from rule elements, not slugs.
- **champion.js:** `AURA_REACTIONS` (`retributive-strike`, `glimpse-of-redemption`, `liberating-step`, `flash-of-grandeur`), `nimble-reprisal`, and the aura `champions-aura`.
- **maneuvers.js:** `strikeMove` reads `push`, `improved-push`, `push-or-pull`, `pull` and their `-N-feet` forms.
- **gullet.js:** `GULLETS`: `swallow-whole` to swallowed, `engulf` to engulfed.
- **class-actions.js:** `vicious-swing`, `power-attack`, `double-slice`, `sudden-charge`, `flurry-of-blows`; `hunt-prey` with `flurry` or `precision`.
- **glossary.js:** `GLOSSARY_SLUGS`: `draconic-frenzy` (a two-action multiattack of the Strikes its text counts, agile last), `rend` and `rend-jaws` (the named Strike's damage, no roll, after two hits in a row on one foe: `requires.hits`), `pounce` (a Stride and its best melee Strike: `charge: 1`), `constrict` and `greater-constrict` (only on a creature it holds: `requires.holding`), `draconic-momentum` (its breath, by a slug with `breath` in it, back on a critical hit: `rechargeOnCrit`), `swarm-mind` (`spec.swarmMind`: rules.js `isImmune` to a mental effect with no area), `camouflage` (`spec.camouflage`: rules.js `usable` lets it Hide without cover), `slow` (slowed as its text says), `light-blindness` (dazzled where the scene `isBright`), `surprise-attack` (a creature's: `spec.surpriseAttack`, rules.js `exposed` off-guard until the target's first turn); `EVERY_LANGUAGE`: a constant `tongues` or `truespeech` (`social.anyLanguage`). `NO_FIGHT_EFFECT`: `telepathy`, `change-shape`, `dragon-change-shape`, `smoke-vision`, `deep-breath`, `constant-spells`, `ghost-rejuvenation`, `wind-up`, `clockwork-creature-wind-up`. `PLAYED_ELSEWHERE`: `throw-rock` (its Rock Strike), `quick-draw` (adapter.js: a character's draw costs nothing with it).
- **traits.js:** `animalisticOf` gives the core's `spec.animalistic` (an NPC that fights as an animal does): the `animal` trait, or `beast` with no language, else Intelligence +0 or lower with no language; never `mindless`, never a character. `reactive-strike` or `attack-of-opportunity` set `flags.reactiveStrike`; `CLASS_LEANS`, `ANCESTRY_LEANS`, `BACKGROUND_LEANS`, `SKILL_LEANS`, `ITEM_LEANS`, `SELFISH_BY_TRAIT`, `LOYAL_BY_TRAIT`, `SANCTIFIED`.
- **auto.js:** `CLASSES`, `ANCESTRIES`, `TRAITS` (playstyle hints); `CLASS_STYLE`, `SUBCLASS_STYLE`, `CASTERS`; `GUARD_SLUGS`, `SELF_GUARD_SLUGS`, `RESCUE_SLUGS`; `CONSUMABLE_FEATS`.
- **read-turn.js:** `MANEUVERS` (action slugs to the core's maneuvers; `create-a-diversion` is distract) and `TALK`.
- **check-roll.js:** `ACTIONS` and `PURPOSES` (PF2e's action slugs: `trip` ... `hide`, `escape`, `steal`, `administer-first-aid`, `tumble-through`), `ITEM_SKILLS` (`bon-mot`, `battle-medicine`, `swallow-whole`), and the incapacitation trait; `edges.js` `AID_SKILLS`.
- **action-roll.js:** `PART_CARDS` (`force-barrage`).

## Words and translation

Every word this module shows is in `languages/en.json`; the code holds keys, never English. Translating takes only a copy of that file (see **Translating** in [the core's README](https://github.com/galaara98/FastFighting)). `npm run test:reworded` runs the tests with every word in the language files reworded, so no test depends on the wording.

`reading/en.json` holds the patterns this module reads PF2e's own text by, where an item's data says nothing: a reaction's Trigger line, an ability's Requirements. A translation is a copy named for its language (`reading/de.json`), tried before the English; text it doesn't match is read as English, else not at all.

- **requirements** (`requirements.js`): entries `{means, pattern}`, each pattern matching a whole line, lower case, its links as their labels. `line` finds the Requirements line in an ability's text (its `line` group); `holding`, `lastHit` (a `strike` group names the Strike), `target` (a `conditions` group, each word the core's condition key or a `word` entry's, or the entry's own `is` list), `self` (`is`) and `shieldRaised` say what it needs; `word` maps a condition word the core hasn't (`dying` is `unconscious`); `rolled` marks an effect that rolls for itself (a Strike it makes), whose damage then isn't simply dealt. A line no entry matches can't be expressed, and the ability isn't used.
- **multiattack** (`glossary.js` `countedStrikes`): `{pattern, numbers}`, a count word (`n`) and a Strike's name (`strike`) before the word Strike, global over the text; `numbers` gives each count word's value ("two claw Strikes and one jaws Strike").

`hardcoded-toEN.json` lists words that stay in English for now, whatever the reader's language: keys of `languages/en.json`, or a group (`"FFPF2E.Action"`), whose translation would contradict a game system that isn't translated yet. It holds the date it was last updated (`lastUpdated`) and the list (`keys`), and is edited like the language files.

## Development

Check out this repository next to the core (`../FastFighting`), then run `npm install` and `npm test`. The tests use the core through `vitest.config.js`; point them elsewhere with `FASTFIGHTING_CORE`. Junction or symlink the folder into Foundry as `Data/modules/fast-fighting-pf2e`.

- `npm test` (`vitest run`) and `npm run test:reworded` (`vitest run --mode reworded`). `tests/setup.js` gives each test a fake `game.i18n` that reads this module's and the core's language files (`tests/foundry-i18n.js`).
- `.github/workflows/test.yml` runs both on every push to `main` and every pull request, with the core checked out beside this repository.
- `node tools/coverage.mjs --out docs/coverage.md` (dev only, not released): what of PF2e's creature abilities and character options the helper understands, by slug and frequency, with reaction triggers against the core's master list ([docs/coverage.md](docs/coverage.md); options and approximations in the tool's header).
- `.github/workflows/release.yml` runs on a `v*` tag: it tests, sets `version` and `download` in module.json, zips `module.json`, `scripts`, `languages`, `reading`, `hardcoded-toEN.json`, `README.md` and `LICENSE` into `module.zip`, and publishes both files as a GitHub release.
