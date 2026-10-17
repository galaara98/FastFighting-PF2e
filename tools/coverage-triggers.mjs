/**
 * A small grammar for the coverage scan (tools/coverage.mjs): a PF2e reaction's Trigger line filed under the core's
 * master list of triggers (FastFighting's scripts/story/master.js REACTION_TRIGGERS, docs/reaction-triggers.md), and the
 * lines it can't file written as a pattern shape with every noun replaced ("<creature> within <range> uses a <trait>
 * action"), never as the text itself. Developer tool, never in the module. Pure.
 *
 * Each pattern has a short name of its own (written here, not the books' words), the master trigger it means, and a
 * regular expression over the normalized line: lower case, the creature's own name made "you" ("the dragon is
 * targeted" reads "you is targeted"), so "you is" and "you are" both occur. The first pattern that matches files the
 * line; any later ones that match too are kept as its other triggers (Reactive Strike's: foeOpening, then
 * foeLeavesReach and foeMovesInReach). Order matters: the specific before the general.
 */

const ALLY = String.raw`\b(?:all(?:y|ies|ied)|companions?|eidolon|minions?|students?|rider)\b`;
const FOE = String.raw`\b(?:creatures?|enem(?:y|ies)|foes?|opponents?|attackers?|someone|another|hazard)\b`;
const BE = String.raw`(?:is|are|was|were|be|been|becomes?)`;
const CONDITION = String.raw`(?:blinded|clumsy|confused|controlled|dazzled|deafened|doomed|drained|dying|enfeebled|fascinated|fatigued|fleeing|frightened|grabbed|immobilized|off-guard|paralyzed|persistent|petrified|prone|quickened|restrained|sickened|slowed|stunned|stupefied|unconscious|wounded)`;
const re = s => new RegExp(s, "i");

/**
 * The patterns, in the order they're tried: [name, master trigger, expression]. Names are this tool's own short
 * descriptions of the shape they match.
 */
export const PATTERNS = Object.freeze([
  // Turns and the round.
  ["rolls initiative", "fightStarts", re(String.raw`\b(?:roll(?:s|ing)?|about to roll) initiative\b|\bfor initiative\b|\binitiative is rolled\b|\b(?:combat|encounter|fight) (?:begins|starts)\b|\bfirst turn of (?:an|the) encounter\b`)],
  ["own turn begins", "ownTurnStarts", re(String.raw`^\s*you(?:r)? (?:own )?turn (?:begins|starts)|^\s*you (?:begin|begins|start|starts) (?:your|its) turn|\bstart of your turn\b`)],
  ["own turn ends", "ownTurnEnds", re(String.raw`^\s*you(?:r)? (?:own )?turn ends|^\s*you (?:end|ends) (?:your|its) turn|\bend of your turn\b|\bat the end of your turn\b`)],
  ["another's turn begins", "otherTurnStarts", re(`${FOE}[^.;]*\\b(?:starts?|begins?) (?:its|their|his|her) turn\\b|${ALLY}[^.;]*\\b(?:starts?|begins?) (?:its|their|his|her) turn\\b|'s turn (?:begins|starts)`)],
  ["another's turn ends", "otherTurnEnds", re(String.raw`\b(?:ends?|finish(?:es)?) (?:its|their|his|her) turn\b|'s turn ends`)],

  // A friend.
  ["ally would drop", "allyWouldDrop", re(`${ALLY}[^.;]*\\bwould (?:be reduced to 0|die|be killed|be knocked out|fall unconscious|gain the dying|increase)|dying condition of an ally`)],
  ["ally drops", "allyDown", re(`${ALLY}[^.;]*\\b(?:${BE} reduced to 0|dies|is killed|falls? unconscious|gains? the dying|is knocked out|drops? to 0)|reduces? (?:an? |your )?${ALLY.slice(2, -2)}[^.;]* to 0`)],
  ["ally panics", "allyPanics", re(`${ALLY}[^.;]*\\b(?:becomes? frightened|is frightened|flees|is fleeing|panics)`)],
  ["ally targeted", "allyTargeted", re(`${ALLY}[^.;]*\\b(?:${BE} (?:the )?target(?:ed)?|${BE} attacked)\\b|\\b(?:targets|attacks) (?:an? |your |one of your )?(?:adjacent |nearby )?${ALLY.slice(2, -2)}|attack against (?:an? |your )?${ALLY.slice(2, -2)}`)],
  ["enemy damages an ally", "allyHit", re(`${FOE}[^.;]*\\b(?:damages?|hits?|critically hits?|deals? damage to) (?:an? |your |one of your |its |the )?(?:\\w+ )?${ALLY.slice(2, -2)}|${ALLY}[^.;]*\\b(?:${BE} (?:critically )?hit|would (?:take|be dealt) damage)`)],
  ["ally takes damage", "allyDamaged", re(`${ALLY}[^.;]*\\b(?:takes?|is dealt) (?:\\w+ )?damage|${ALLY}[^.;]*\\bis damaged`)],
  ["ally afflicted", "allyAfflicted", re(`${ALLY}[^.;]*\\b(?:becomes?|is|gains? the) (?:\\w+ )?${CONDITION}|${ALLY}[^.;]*\\b(?:is|becomes?) (?:affected by|subjected to)`)],
  ["ally's roll", "allyRolls", re(`${ALLY}[^.;]*\\b(?:attempts?|fails?|critically fails?|succeeds?|critically succeeds?|would (?:fail|succeed)|rolls?|is about to roll)\\b`)],
  ["ally strikes", "allyStrikes", re(`${ALLY}[^.;]*\\b(?:hits?|critically hits?|damages?|attacks?|strikes?|lands? a|reduces? (?:a|an) (?:creature|enemy|foe)|kills?)\\b`)],
  ["ally casts or acts", "allyActs", re(`${ALLY}[^.;]*\\b(?:casts?|uses?|activates?|sustains?)\\b`)],
  ["ally moves", "allyMoves", re(`${ALLY}[^.;]*\\b(?:moves?|ends? (?:a|its|their) move|strides?|steps?|leaps?|ends? (?:its|their) movement)\\b`)],
  ["mounted or commanded", "commanded", re(String.raw`\bmounts?\b|\bcommand an animal\b|\bcommands? you\b|\bwhile riding you\b|\bis commanded\b`)],
  ["mount targeted", "rideTargeted", re(String.raw`\b(?:your|its) mount\b[^.;]*\btarget|\btargets? (?:your|its) mount\b`)],

  // About to fall, falling, slain.
  ["would drop to 0", "wouldDrop", re(String.raw`\byou(?:r)?\b[^.;]*\bwould (?:be reduced to 0|die|be killed|be knocked out|fall unconscious|be destroyed|gain the dying)|\bwould reduce you(?:r)? (?:hit points )?to 0|\btakes? damage that would reduce you to 0|\babout to gain the dying\b|\bwould die\b`)],
  ["reduced to 0, slain", "slain", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:(?:are|is) (?:reduced to 0|killed|destroyed|slain)|(?:hit points|hp) (?:are|is) reduced to 0|dies?\b|falls? unconscious)|\byou(?:r)? (?:are|is) reduced\b|\breduces? you to 0\b`)],
  ["badly hurt", "badlyHurt", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:reduced to|falls? to|drops? (?:to|below)) (?:half|fewer than|below|\d+ hit points or fewer)|\bbloodied\b|\bbelow half\b`)],

  // The attack sequence, at itself.
  ["shield raised, takes damage", "wouldTakeDamage", re(String.raw`\bshield raised\b[^.;]*\bdamage\b`)],
  ["attack misses it", "missed", re(String.raw`\bmiss(?:es|ed)? you\b|\bmiss(?:es)? [^.;]*against you\b|\b(?:fails?|critically fails?) (?:on |at )?(?:an? )?(?:\w+ )?(?:attack|strike|spell attack)(?: roll)? (?:against|targeting) you\b|\battack roll for a strike targeting you fails\b|\byou (?:are|is) missed\b`)],
  ["hit or critically hit", "hit", re(String.raw`\byou (?:are|is) (?:critically )?(?:hit|struck)\b|\b(?:hits?|critically hits?) you\b|\b(?:would hit|succeeds? at an attack against) you\b|\byou would be hit\b|\b(?:an? )?(?:attack|strike) (?:would )?hits? you\b|\bcritical hit (?:on|against) you\b|\bstrikes? you\b`)],
  ["would take damage", "wouldTakeDamage", re(String.raw`\byou(?:r)? (?:\w+ )?would (?:take|be dealt) (?:[\w,-]+ ){0,6}(?:damage|acid|cold|electricity|fire|sonic|physical)|\bwould (?:deal damage to|damage) you\b`)],
  ["takes damage", "damaged", re(String.raw`\byou (?:take|takes|are dealt|is dealt) (?:[\w,-]+ ){0,6}damage\b|\b(?:damages?|deals? (?:\w+ ){0,3}damage to) you\b|\byou (?:are|is) damaged\b`)],
  ["targeted by an attack", "attacked", re(String.raw`\byou\b[^.;]*\b(?:are|is) (?:the )?target(?:ed)?\b(?:[^.;]*\b(?:attack|strike|weapon)|\s*$)|\byou\b[^.;]*\b(?:are|is) attacked\b|\btargets? (?:you|them) with (?:an? )?(?:[\w-]+ ){0,3}(?:attack|strike)|\battacks? you\b|\b(?:makes?|attempts?) (?:an? )?(?:[\w-]+ ){0,3}(?:attack|strike) (?:against|targeting) you\b|\btargets you\b`)],
  ["targeted by a spell or effect", "spellTargets", re(String.raw`\byou\b[^.;]*\b(?:are|is) (?:the )?(?:target(?:ed)?|in the (?:area|emanation)) (?:by|with|of) (?:an? )?(?:[\w-]+ (?:or [\w-]+ )?){0,3}(?:spell|effect|magic|cantrip)\b|\b(?:spell|effect)s? (?:that )?targets? you\b|\bcasts? a spell (?:that )?(?:targets|targeting|at) you\b|\btargets? you with (?:a |an )?(?:[\w-]+ )?(?:spell|effect)\b|\bto target you with\b`)],
  ["must save", "mustSave", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:attempt|attempts|would attempt|must attempt|about to attempt|roll|rolls|make|makes)\b (?:a |an )?(?:[\w-]+ ){0,2}(?:saving throw|save)\b|\bwould (?:require|force) you to (?:attempt|make) a save\b`)],
  ["would gain a condition", "wouldGainCondition", re(`\\byou\\b[^.;]*\\b(?:would (?:become|be|gain(?: the)?|be affected by)|about to gain) (?:an? |the )?(?:\\w+ )?(?:${CONDITION}|condition|affliction|curse|disease|poison|adverse effect)|\\bwould (?:frighten|grab|poison|curse|blind|stun|paralyze) you\\b|\\bwould cause you to become\\b`)],
  ["maneuver tried on it", "maneuvered", re(String.raw`\battempts? to (?:grapple|trip|shove|disarm|reposition|steal|grab|swallow|push|pull)\b[^.;]*\byou\b|\b(?:grapples?|trips?|shoves?|disarms?|repositions?) you\b|\b(?:athletics|thievery) check against you\b`)],
  ["becomes grabbed", "grabbed", re(String.raw`\byou (?:are|is|become|becomes) (?:grabbed|restrained|swallowed|engulfed|grappled)\b|\b(?:grabs|swallows|engulfs) you\b`)],
  ["knocked prone", "knockedDown", re(String.raw`\byou would (?:be knocked|fall) prone\b|\byou (?:are|is) (?:knocked prone|tripped)\b|\bknocks? you prone\b`)],
  ["moved by force", "forcedMovement", re(String.raw`\byou would be (?:moved|pushed|pulled|shoved|forced|teleported)\b|\b(?:pushes|pulls|shoves|drags) you\b|\bforced movement\b`)],
  ["touched", "touched", re(String.raw`\btouch(?:es)? you\b|\byou (?:are|is) touched\b|\bhits? you with an unarmed\b|\bhits or touches you\b`)],
  ["starts to fall", "falling", re(String.raw`\byou (?:fall|falls|begin to fall|would fall|are falling)\b(?! unconscious| prone)|\bairborne at the end\b`)],
  ["gear breaks", "gearBreaking", re(String.raw`\b(?:your|an?) (?:shield|weapon|armor|item)\b[^.;]*\b(?:would (?:be|become) (?:broken|destroyed)|becomes? broken|breaks)\b`)],

  // What a foe does.
  ["foe in reach manipulates, shoots or moves", "foeOpening", re(String.raw`\b(?:within|in) (?:your |the )?reach\b[^.;]*\buses? a manipulate action|\buses? a manipulate action\b|\bmakes? a ranged attack\b|\b(?:drops?|picks? up|retrieves?|draws?|reloads?|eats?|drinks?) (?:an? |the )?(?:item|weapon|object|potion|elixir)|\b(?:within|in) (?:your |the )?reach\b[^.;]*\b(?:makes? a strike|attempts? a skill check|takes? an action)`)],
  ["held foe struggles", "heldFoeStruggles", re(String.raw`\b(?:grabbed|restrained|swallowed|grappled|engulfed) by you\b[^.;]*\b(?:attempts?|escapes?|attacks?|moves?)|\b(?:you have|you has) (?:a creature )?(?:grabbed|restrained|swallowed)\b[^.;]*\b(?:attempts? to escape|escapes?)|\battempts? to escape (?:from )?you\b|\bescapes? (?:your|from your)\b`)],
  ["foe's roll fails", "foeFails", re(`${FOE}[^.;]*\\b(?:fails?|critically fails?|fumbles?)\\b|${FOE}[^.;]*\\bbecomes? prone\\b`)],
  ["foe's roll", "foeRolls", re(`${FOE}[^.;]*\\b(?:attempts?|rolls?|would succeed|succeeds?|critically succeeds?|would roll) (?:an? |at an? |on an? )?(?:[\\w-]+ ){0,3}(?:check|save|saving throw|attack roll|skill check|flat check)\\b`)],
  ["foe spotted", "foeSpotted", re(String.raw`\bbecomes? (?:visible|observed|detected|unhidden)\b|\bis revealed\b|\bcomes? into view\b|\byou (?:see|notice|detect|perceive|become aware of) (?:an? |the )?(?:\w+ )?(?:creature|enemy|foe)\b|\bteleports? (?:into|to|adjacent|within)\b|\bturns? invisible\b|\bappears?\b`)],
  ["about to be found", "aboutToBeFound", re(String.raw`\bseeks?\b|\bwould (?:detect|find|locate|notice) you\b|\battempts? to (?:find|locate|detect|seek) you\b|\byou would be (?:detected|seen|revealed|found)\b|\bwould observe\b`)],

  // Movement.
  ["foe comes close", "foeApproaches", re(`${FOE}[^.;]*\\b(?:moves? (?:from beyond[^.;]* )?(?:to )?(?:within|into) (?:your |its )?reach|enters? (?:your |its )?(?:reach|aura|area)|comes? within|approaches|moves? (?:to )?(?:within \\d+ feet|adjacent)|moves? into an? adjacent (?:square|space)|moves? from beyond [^.;]* to within|ends? (?:a|its|their) (?:move|movement)(?: action)? (?:adjacent|within)|enters? a square)`)],
  ["foe moves within reach", "foeMovesInReach", re(String.raw`\b(?:within|in) (?:your |the )?reach\b[^.;]*\b(?:uses? a move action|moves?|stands?(?: up)?)\b|\bstands? up\b|\bprone [\w ]*stands\b|\bmoves? through (?:your |the )?reach\b`)],
  ["foe leaves reach", "foeLeavesReach", re(String.raw`\bleaves? (?:a square|your reach|the reach|reach)\b|\bmoves? (?:away from|out of) (?:you|your reach)\b|\bmoves? away\b|\bretreats?\b`)],
  ["something in its space", "inItsSpace", re(String.raw`\b(?:enters?|leaves?|moves? (?:into|through|out of)|occupies|is in) (?:your|its) space\b|\bwalks? (?:on top of|over|across) you\b|\b(?:enters?|moves? into) a (?:square|space) occupied by you\b|\bsteps? on you\b`)],

  // Magic.
  ["foe casts a spell", "foeCasts", re(String.raw`^(?!\s*you\b)[^;]*?(?:\bcasts? a spell\b|\bcast a spell\b|\bcasting a spell\b|\bsustains? a spell\b|\bactivates? (?:an? )?(?:magic )?item\b|\bcasts? (?:an? )?(?:[\w-]+ )?(?:spell|cantrip|ritual)\b)`)],
  ["magic or an effect nearby", "magicNearby", re(String.raw`\b(?:healing|teleportation|teleport|[\w-]+) (?:spell|effect)s?\b[^.;]*\b(?:within|in) \d+ feet\b|\b(?:within|in) \d+ feet\b[^.;]*\b(?:spell|effect|teleports?|heals?|restores? hit points)\b|\bhealing effect\b|\brestores? hit points\b|\bspell (?:comes into|takes) effect\b|\buses? an? (?:[\w-]+ (?:or [\w-]+ )?)?(?:spell|effect)\b|\bteleports?\b`)],

  // Words.
  ["pressed or threatened", "pressed", re(String.raw`\b(?:coerce|demoralize|make an impression|request|intimidate|persuade|bargain|bribe)s?\b[^.;]*\byou\b|\b(?:diplomacy|intimidation) check (?:against|targeting) you\b`)],
  ["lied to or feinted", "deceived", re(String.raw`\b(?:feints?|lies|create a diversion|deceives?)\b[^.;]*\byou\b|\blies to you\b|\byou (?:are|is) deceived\b|\bdisguise\b`)],
  ["hears speech", "speech", re(String.raw`\b(?:speaks?|says?|sings?|performs?|shouts?|whispers?)\b|\buses? a linguistic\b|\b(?:your|its) name\b`)],
  ["rule broken", "ruleBroken", re(String.raw`\btrespass|\bviolates?\b|\bdesecrat|\bbreaks? (?:a|your|the) (?:rule|oath|vow|ward|anathema)\b|\benters? (?:your|the) (?:temple|shrine|lair|territory|hoard|domain)\b|\bsteals? from\b|\btouches? (?:your|the) hoard\b`)],

  // Its own actions.
  ["drops a foe", "dropsFoe", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:reduces?|kills?|slays?|knocks? out) (?:a |an |the )?(?:[\w-]+ )?(?:creature|enemy|foe|target|opponent)\b[^.;]*(?:to 0|$)|\byou(?:r)?\b[^.;]*\b(?:reduces?|kills?) (?:a |an )?(?:[\w-]+ )?(?:creature|enemy|foe)|\byou (?:kill|kills|slay|slays)\b`)],
  ["own blow lands", "ownHit", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:strike|attack|spellstrike|unarmed attack|spell attack)s? (?:roll )?(?:hits?|critically hits?|deals? damage|damages?)\b|\byou (?:hit|hits|critically hit|critically hits|damage|damages) (?:a |an |the )?(?:[\w-]+ ){0,3}(?:creature|enemy|foe|target|opponent|it)\b|\byour (?:last|previous) action was a successful strike\b|\byou (?:roll|rolls) a critical hit\b|\byou (?:critically )?succeeds? at a strike\b|\byou (?:deal|deals) (?:[\w-]+ )?damage\b|\byou (?:hit|hits) (?:a |an )?(?:[\w-]+ )?with\b|\byou (?:critically )?(?:hit|hits)\b`)],
  ["own attack misses", "ownMiss", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:strike|attack|spell attack)s? (?:roll )?(?:misses|fails)\b|\byou (?:miss|misses|fail a strike|fails a strike)\b`)],
  ["own roll fails", "ownRollFails", re(String.raw`\byou (?:fail|fails|critically fail|critically fails)\b|\byou rolls? a (?:critical )?failure\b`)],
  ["own roll succeeds", "ownRollSucceeds", re(String.raw`\byou (?:succeed|succeeds|critically succeed|critically succeeds|successfully)\b`)],
  ["own roll", "ownRoll", re(String.raw`\byou(?:r)?\b[^.;]*\b(?:roll|rolls|would roll|would attempt|attempt|attempts|are about to attempt|about to roll)\b[^.;]*\b(?:check|roll|d20|strike|attack)\b`)],
  ["a death nearby", "deathNearby", re(`${FOE}[^.;]*\\b(?:dies|is reduced to 0|is killed)\\b|\\bdeath of\\b|\\bdies\\b`)],
  ["uses a certain action", "ownAction", re(String.raw`^\s*you(?:r)? (?:successfully |previous action was to |use |uses )?(?:grab|grabs|trip|trips|shove|shoves|grapple|grapples|hide|hides|stride|strides|step|steps|cast|casts|leap|leaps|jump|jumps|swallow|swallows|engulf|engulfs|enter|enters|transform|transforms|change|changes|reload|reloads|draw|draws|raise|raises|sustain|sustains|activate|activates|command|commands|demoralize|demoralizes|feint|feints|disable|disables|recall|recalls|rouse|rouses|use|uses|begin|begins|reach|reaches|lose|loses|become|becomes|gain|gains|size|push|pushes|fly|flies|make|makes)\b`)],
  ["hazard sensed", "hazardSensed", re(String.raw`\b(?:looks? at|reads?|touches|uses) (?:the )?(?:\w+ )?(?:hazard|trap|object)\b`)]
]);

/** The words a creature's own name gives (and its kind's: "the dragon"), to read "the dragon is hit" as "you are hit". */
const PLAIN_WORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "with", "to", "from", "at", "by", "for", "or", "elite", "weak", "young", "adult", "ancient", "greater", "lesser"]);

/**
 * A trigger's words ready for the grammar: plain text, lower case, its own creature's name (or kind) as "you".
 * @param {string} text   the trigger as plain text
 * @param {object} [o]
 * @param {string} [o.name]      the creature's name (none for a character's feat: "you" already)
 * @param {string[]} [o.kinds]   its traits (dragon, devil ...), for "the dragon"
 */
export function normalizeTrigger(text, { name = "", kinds = [] } = {}) {
  let s = ` ${String(text ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()} `;
  const words = [...new Set([...String(name).toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z'-]+/), ...kinds.map(k => String(k).toLowerCase())])]
    .map(w => w.replace(/'s$/, "")).filter(w => w.length > 2 && !PLAIN_WORDS.has(w));
  const own = m => (/'s$/i.test(m) ? "your" : "you");
  const full = String(name).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Its whole name ("a bog mummy", "Blue Viper's"), then a word of it after "the" ("the dragon", "the goblin pyro's").
  if ( /\s/.test(full) ) s = s.replace(new RegExp(String.raw`(?:\b(?:the|an?) )?\b${full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:'s)?\b`, "gi"), own);
  if ( words.length ) {
    const any = `(?:${words.map(w => w.replace(/[-]/g, "[- ]")).join("|")})`;
    s = s.replace(new RegExp(String.raw`\bthe (?:[\w-]+ ){0,3}${any}(?:'s)?\b`, "gi"), own);
    // A named creature, by its own name, capitalized as names are ("Taljjae's turn begins").
    const first = full.split(/[\s,]+/)[0] ?? "";
    if ( /^[A-Z][a-z'-]{2,}$/.test(first) && !PLAIN_WORDS.has(first.toLowerCase()) ) {
      s = s.replace(new RegExp(String.raw`(?<!\b(?:the|a|an|A|An|The) )\b${first}(?:'s)?\b`, "g"), own);
    }
  }
  s = s.replace(/\bthe monster(?:'s)?/gi, own).replace(/\byou're\b/gi, "you are").replace(/\bit's\b/gi, "it is");
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The master trigger a normalized line means: {trigger, pattern, also}, `also` the other triggers later patterns find
 * in it; null when nothing matches.
 */
export function classifyTrigger(norm) {
  const text = String(norm ?? "");
  if ( !text ) return null;
  let first = null;
  const also = [];
  for ( const [pattern, trigger, expr] of PATTERNS ) {
    if ( !expr.test(text) ) continue;
    if ( !first ) first = { trigger, pattern };
    else if ( trigger !== first.trigger && !also.includes(trigger) ) also.push(trigger);
  }
  return first ? { ...first, also } : null;
}

/**
 * A filing put right by what the reaction does, where its trigger alone can't tell: "reduced to 0 Hit Points" is the
 * moment it would drop (wouldDrop) when the reaction keeps it up at 1 (Ferocity), else the moment it's slain (a death
 * burst).
 * @param {{trigger, pattern, also}|null} filed   classifyTrigger's
 * @param {string} text   the reaction's whole text, plain (read here only)
 */
export function refineTrigger(filed, text) {
  if ( filed?.trigger !== "slain" ) return filed;
  const stays = /\b(?:remains? at 1|at 1 (?:hit point|hp)|avoids? being knocked out|isn'?t knocked out|doesn'?t (?:die|fall unconscious)|stays? (?:up|conscious|alive))\b/i;
  return stays.test(String(text ?? "")) ? { ...filed, trigger: "wouldDrop", pattern: "reduced to 0, stays up" } : filed;
}

/** Words a shape keeps as they are: how a trigger is built, never what it's about. */
const KEEP = new Set(`a an the of to in on at by with within from or and but not if when while during after before as than
  that which who whose it its it's they them their is are was were be been being becomes become would could can can't
  cannot must may has have had does do did no any each every one another other first time times again more less least
  takes take uses use used makes make attempts attempt fails fail critically succeeds succeed success failure hits hit
  damages damage deals deal attack attacks strike strikes spell spells effect effects action actions move turn begins
  starts ends end start reduced points hp save saving throw check roll rolls targeted targets target see sees seen
  observe observed aware adjacent away leaves leave enters enter square space aura reach dies killed casts cast lands
  about yet but either both up down out into onto over under near nearby than same last next previous successful
  successfully triggering triggered trigger condition gains gain loses lose affected area emanation range ranged melee
  physical`.split(/\s+/).filter(Boolean));

/**
 * A line's shape, with every noun replaced: "<creature> within <range> uses a <trait> action". Only the words in KEEP
 * stay; the rest become placeholders (runs of unknown words a single <x>), so no book's wording comes through.
 * @param {string} norm   a normalized line (normalizeTrigger)
 * @param {object} [o]
 * @param {Set<string>} [o.traits]    PF2e's trait words (manipulate, fire ...)
 * @param {Set<string>} [o.actions]   PF2e's action names, one word each (stride, grapple ...)
 * @param {Set<string>} [o.skills]    skills and saves (athletics, fortitude ...)
 */
export function shapeOf(norm, { traits = new Set(), actions = new Set(), skills = new Set() } = {}) {
  const out = [];
  const words = String(norm ?? "").replace(/(\d+)[- ](?:feet|foot|ft)\b/g, " RANGE ").split(/[^a-z0-9'A-Z-]+/).filter(Boolean);
  for ( const raw of words ) {
    const w = raw.replace(/'s$/, "");
    let t;
    if ( raw === "RANGE" || w === "reach" ) t = "<range>";
    else if ( /^\d+$/.test(w) ) t = "<n>";
    else if ( /^(?:you|your|yourself|yours)$/.test(w) ) t = "<self>";
    else if ( /^(?:all(?:y|ies)|companions?|eidolon|minions?)$/.test(w) ) t = "<ally>";
    else if ( /^(?:creatures?|enem(?:y|ies)|foes?|opponents?|attackers?|someone|hazard)$/.test(w) ) t = "<creature>";
    else if ( new RegExp(`^${CONDITION}$`).test(w) ) t = "<condition>";
    else if ( skills.has(w) ) t = "<skill>";
    else if ( actions.has(w) ) t = "<action>";
    else if ( traits.has(w) && !KEEP.has(w) ) t = "<trait>";
    else if ( KEEP.has(w) ) t = w;
    else t = "<x>";
    // (One placeholder for a run of the same: "<x> <x>" is "<x>", "<trait> or <trait>" stays.)
    if ( t.startsWith("<") && out.at(-1) === t ) continue;
    out.push(t);
  }
  return out.slice(0, 16).join(" ");
}
