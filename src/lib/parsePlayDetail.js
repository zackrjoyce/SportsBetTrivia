// src/lib/parsePlayDetail.js

/**
 * Parse a PBP `detail` string into structured events:
 * - players involved
 * - actions (rush/pass/rec yards, TD, sack, fumble)
 * - yardage (signed integer; "loss of 5" => -5; "no gain" => 0)
 *
 * Example output:
 * {
 *   type: 'pass'|'rush'|'sack'|'other',
 *   yards: 12,             // null if unknown
 *   touchdown: true|false,
 *   fumble: { by: 'Name' } | null,
 *   players: {
 *     passer, rusher, receiver, sackedQb
 *   },
 *   events: [
 *     { player: 'Patrick Mahomes', stat: 'pass_yards', delta: +12 },
 *     { player: 'Travis Kelce',    stat: 'recv_yards', delta: +12 },
 *     { player: 'Travis Kelce',    stat: 'reception',  delta: +1  },
 *     { player: 'Patrick Mahomes', stat: 'pass_td',    delta: +1  },   // if TD
 *     { player: 'Travis Kelce',    stat: 'recv_td',    delta: +1  },   // if TD
 *   ]
 * }
 */

// src/lib/parsePlayDetail.js

// --- Name extraction helpers -------------------------------------------------

const NAME_TOKEN = String.raw`(?:[A-Z][a-zA-Z'.-]+|[A-Z]\.)`;
const NAME_RE = new RegExp(String.raw`\b(${NAME_TOKEN}(?:\s+${NAME_TOKEN})+)\b`, "g");

const rx = {
  noPlay: /\bno play\b|nullified|offsetting/i,

  // TD must be explicit in the text. We do NOT infer TD from elsewhere.
  tdText: /\b(?:touchdown|for a td)\b/i,

  fumble: /\bfumble[sd]?\b/i,
  sack: /\bsack(?:ed)?\b/i,

  // "pass" language
  passWord: /\bpass(?:es|ed)?\b/i,
  incomplete: /\bincomplete\b/i,

  // "complete ... to NAME" or "... to NAME"
  completeTo: /\b(?:complete(?:d)?|pass(?:es|ed)?)\s+(?:short|deep|left|right|middle)?\s*(?:to\s+)?([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)+)\b/i,
  toName: new RegExp(
    String.raw`\bto\s+(${NAME_TOKEN}(?:\s+${NAME_TOKEN})+)\b`,
    "i"
  ),

  // rush-ish tell words
  rushHint: /\b(rush|run|scramble|left|right|middle|guard|tackle|end|up the middle|keeper|qb sneak)\b/i,

  // yards extraction, in priority order
  // "for a loss of 5 yards"
  lossOf: /\b(?:for\s+(?:a\s+)?loss\s+of|for)\s*-?\s*(\d+)\s*yards?\b/i,

  // "for -5 yards"
  forMinus: /\bfor\s*-+\s*(\d+)\s*yards?\b/i,

  // "for 6 yards"
  forYards: /\bfor\s+(\d+)\s*yards?\b/i,

  // "no gain"
  noGain: /\bno gain\b/i,
};

/** Get ordered unique list of detected names "First Last" / "F. Last". */
function extractNames(detail) {
  const names = [];
  if (!detail) return names;
  let m;
  while ((m = NAME_RE.exec(detail)) !== null) {
    const nm = m[1].replace(/\s+/g, " ").trim();
    if (!names.includes(nm)) names.push(nm);
  }
  return names;
}

/**
 * Find the last detected name (like "Marcus Mariota") that appears
 * BEFORE the first match of `regex` in `detail`. If not found, fall back.
 */
function lastNameBefore(detail, regex, fallback) {
  const idx = (detail || "").search(regex);
  if (idx < 0) return fallback || null;
  const before = detail.slice(0, idx);
  const names = extractNames(before);
  if (names.length) return names[names.length - 1];
  return fallback || null;
}

/** Safely parse signed yardage from English. Returns integer or null. */
function parseSignedYards(detail) {
  if (!detail) return null;

  // "no gain"
  if (rx.noGain.test(detail)) return 0;

  // explicit "-5 yards"
  const mMinus = detail.match(rx.forMinus);
  if (mMinus) {
    return -Number(mMinus[1] || 0);
  }

  // "for a loss of 5 yards"
  // or "for 5 yards"
  const mLossOf = detail.match(rx.lossOf);
  if (mLossOf) {
    const raw = Number(mLossOf[1] || 0);

    const saidLoss = /\bloss\b/i.test(detail);
    const isSack   = rx.sack.test(detail);

    // if the language actually says "loss" OR it's a sack,
    // treat it as negative. Otherwise treat as positive.
    if (saidLoss || isSack) {
      return -raw;
    }
    return raw;
  }

  // plain "for 6 yards"
  const mFor = detail.match(rx.forYards);
  if (mFor) {
    return Number(mFor[1] || 0);
  }

  return null;
}

/**
 * Attempt to get receiver's name from phrasing like:
 * "pass complete short right to Derrick Henry"
 * Falls back to generic "to Derrick Henry"
 */
function parseReceiver(detail) {
  const m = detail.match(rx.completeTo) || detail.match(rx.toName);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim();
}

/**
 * classifyScoreType:
 * given a play string that *we already believe is a TD*, try to
 * label it so downstream logic can tell "rush TD", "rec TD", etc.
 *
 * We'll use a few heuristics:
 *  - if it's a pass play (has 'pass') => 'rec_td' (receiver caught it in endzone)
 *  - if it's a sack => 'def_td' (scoop/score or pick-six style wacky)
 *  - if it looks like run/scramble => 'rush_td'
 *  - else => 'unknown_td'
 *
 * You can extend this for INT ret / fumble ret / KR / PR if you add regexes.
 */
function classifyScoreType(detail) {
  const lower = (detail || "").toLowerCase();
  if (rx.passWord.test(detail) && !rx.incomplete.test(detail)) {
    return "rec_td";
  }
  if (rx.sack.test(detail)) {
    return "def_td";
  }
  if (rx.rushHint.test(detail)) {
    return "rush_td";
  }
  return "unknown_td";
}

/**
 * Main strict parser.
 * The big changes:
 *  - We ONLY mark touchdown + *_td events if rx.tdText matches the text.
 *  - Sacks always force negative yardage.
 *  - We avoid inventing players if we can't confidently identify them.
 *  - We add scoreType.
 */
export function parsePlayDetail(detail) {
  const out = {
    type: "other",             // 'pass' | 'rush' | 'sack' | 'other'
    yards: null,               // signed int or null
    touchdown: false,          // true ONLY if the literal play text says TD
    scoreType: null,           // 'rec_td' | 'rush_td' | 'def_td' | 'unknown_td' | null
    fumble: null,              // { by: 'Name' } | null
    players: {
      passer: null,
      receiver: null,
      rusher: null,
      sackedQb: null,
    },
    events: [],                // array of { player, stat, delta, [meta/detail] }
  };

  // Fast bail for "no play" / nullified / offsetting
  if (!detail || rx.noPlay.test(detail)) {
    return out;
  }

  const names = extractNames(detail);
  // This calculation is done once per play. We'll reuse it in each branch.
  const yardsSigned = parseSignedYards(detail);

  // Strict touchdown check
  const isTD = rx.tdText.test(detail);
  if (isTD) {
    out.touchdown = true;
    out.scoreType = classifyScoreType(detail);
  }

  // -------------------------
  // CASE 1: SACK
  // -------------------------
  if (rx.sack.test(detail)) {
    out.type = "sack";

    // Who got sacked? Usually "Marcus Mariota sacked..."
    // lastNameBefore(..., rx.sack) should give that QB.
    const qb = lastNameBefore(detail, rx.sack, names[0] || null);
    out.players.sackedQb = qb;
    out.players.rusher = qb; // We treat QB as the rusher for yardage loss logic

    // sacks are always negative yardage. If parser got positive, flip it.
    const sackYards = (() => {
      if (Number.isFinite(yardsSigned)) {
        return yardsSigned <= 0 ? yardsSigned : -Math.abs(yardsSigned);
      }
      // if we couldn't read yardsSigned, default to 0 (not great but safe)
      return 0;
    })();

    if (qb) {
      out.events.push({
        player: qb,
        stat: "rush_yds",
        delta: sackYards,
        detail: "sack",
      });
    }

    // fumble on the sack?
    if (rx.fumble.test(detail)) {
      // "fumble" often comes after the sack. We try to identify who fumbled.
      const fumPlayer = lastNameBefore(detail, rx.fumble, qb || names[0] || null);
      if (fumPlayer) {
        out.fumble = { by: fumPlayer };
        out.events.push({ player: fumPlayer, stat: "fumble", delta: 1 });
      }
    }

    // If the text literally says "touchdown", this is probably a defensive TD
    // (strip sack return, scoop & score, etc). We still won't assign rush_td.
    if (isTD && qb) {
      // We do NOT automatically credit the QB with a TD here.
      // We just record meta so downstream can pick the scorer
      out.events.push({
        player: qb,
        stat: "sack_context_td",
        delta: 1,
        detail: "sack play resulted in TD",
      });
    }

    return out;
  }

  // -------------------------
  // CASE 2: PASS
  // -------------------------
  if (rx.passWord.test(detail)) {
    out.type = "pass";

    // passer is whoever's name appears most confidently before the word "pass"
    // ex: "Marcus Mariota pass complete short right to Derrick Henry..."
    const passer = lastNameBefore(detail, rx.passWord, names[0] || null);

    // receiver from "to NAME"
    const receiver = parseReceiver(detail);

    if (passer) out.players.passer = passer;
    if (receiver) out.players.receiver = receiver;

    const incomplete = rx.incomplete.test(detail);

    if (incomplete) {
      // Incomplete => attempt + target, no yards
      if (passer) {
        out.events.push({ player: passer, stat: "pass_att", delta: 1 });
      }
      if (receiver) {
        out.events.push({ player: receiver, stat: "target", delta: 1 });
      }
    } else {
      // Completed pass
      const y = Number.isFinite(yardsSigned) ? yardsSigned : 0;

      if (passer) {
        out.events.push({ player: passer, stat: "pass_yds", delta: y });
        out.events.push({ player: passer, stat: "pass_cmp", delta: 1 });
      }
      if (receiver) {
        out.events.push({ player: receiver, stat: "rec_yds", delta: y });
        out.events.push({ player: receiver, stat: "rec", delta: 1 });
      }

      // TD on a completed pass:
      if (isTD) {
        if (passer) {
          out.events.push({ player: passer, stat: "pass_td", delta: 1 });
        }
        if (receiver) {
          out.events.push({ player: receiver, stat: "rec_td", delta: 1 });
        }
      }
    }

    // fumble after completion
    if (rx.fumble.test(detail)) {
      // If it was complete, ballcarrier is receiver. If incomplete, it's passer being strip-sacked-ish.
      const carrier = !incomplete && receiver ? receiver : passer;
      const fumPlayer = lastNameBefore(detail, rx.fumble, carrier || names[0] || null);
      if (fumPlayer) {
        out.fumble = { by: fumPlayer };
        out.events.push({ player: fumPlayer, stat: "fumble", delta: 1 });
      }
    }

    return out;
  }

  // -------------------------
  // CASE 3: RUSH / SCRAMBLE
  // -------------------------
  // Heuristic: if no "pass", but we see obvious rush/run words, treat as a rush.
  if (rx.rushHint.test(detail)) {
    out.type = "rush";

    // first detected name is *usually* the ballcarrier on runs
    const rusher = names[0] || null;
    if (rusher) out.players.rusher = rusher;

    // rushing yards
    // For runs, if text says "loss of X" we already captured that as negative.
    // If it's ambiguous but says "loss", we forceNegativeIfLossWord.
    const rushYards = parseSignedYards(detail);
    const y = Number.isFinite(rushYards) ? rushYards : 0;

    if (rusher) {
      out.events.push({ player: rusher, stat: "rush_yds", delta: y });
      out.events.push({ player: rusher, stat: "rush_att", delta: 1 });

      if (isTD) {
        out.events.push({ player: rusher, stat: "rush_td", delta: 1 });
      }
    }

    // fumble on a run
    if (rx.fumble.test(detail)) {
      const fumPlayer = lastNameBefore(detail, rx.fumble, rusher || names[0] || null);
      if (fumPlayer) {
        out.fumble = { by: fumPlayer };
        out.events.push({ player: fumPlayer, stat: "fumble", delta: 1 });
      }
    }

    return out;
  }

  // -------------------------
  // CASE 4: OTHER / RETURN / WEIRD DEFENSIVE SCORE
  // -------------------------
  // We still want at least: fumble detection, TD marker
  out.type = "other";
  out.yards = Number.isFinite(yardsSigned) ? yardsSigned : null;
  if (isTD) {
    // We *know* it was a touchdown but couldn't classify as pass/rush/sack/rushHint.
    // This could be INT return TD, fumble return TD, blocked punt TD, etc.
    out.events.push({
      player: null,
      stat: "team_td",
      delta: 1,
      detail: "unclassified touchdown",
    });
  }

  if (rx.fumble.test(detail)) {
    const fumPlayer = lastNameBefore(detail, rx.fumble, names[0] || null);
    if (fumPlayer) {
      out.fumble = { by: fumPlayer };
      out.events.push({ player: fumPlayer, stat: "fumble", delta: 1 });
    }
  }

  return out;
}

/**
 * Summarize accumulated stats per player.
 * (same as before)
 */
export function accumulateEvents(events) {
  const map = new Map();
  for (const e of events || []) {
    if (!e.player) continue;
    const k = e.player;
    const row = map.get(k) || {};
    row[e.stat] = (row[e.stat] || 0) + (e.delta || 0);
    map.set(k, row);
  }
  return Object.fromEntries(map);
}
