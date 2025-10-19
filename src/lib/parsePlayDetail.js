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

const NAME_TOKEN = String.raw`(?:[A-Z][a-zA-Z'.-]+|[A-Z]\.)`;
const NAME_RE = new RegExp(String.raw`\b(${NAME_TOKEN}(?:\s+${NAME_TOKEN})+)\b`, 'g');

const rx = {
  noPlay: /\bno play\b|nullified|offsetting/i,
  td: /\btouchdown\b|\bfor a td\b/i,
  fumble: /\bfumble[sd]?\b/i,
  sack: /\bsack(?:ed)?\b/i,
  pass: /\bpass(?:es|ed)?\b/i,
  incomplete: /\bincomplete\b/i,
  completeTo: /\b(?:to|complete(?:d)? to)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)+)\b/i,
  // yards (order matters: loss/no gain first)
  lossOf: /\b(?:for\s+(?:a\s+)?loss\s+of|for)\s*-?\s*(\d+)\s*yards?\b/i, // use sign separately
  forMinus: /\bfor\s*-+\s*(\d+)\s*yards?\b/i,
  forYards: /\bfor\s+(\d+)\s*yards?\b/i,
  noGain: /\bno gain\b/i,
  // rush-ish hints
  rushHint: /\brun|rush|scramble|left|right|middle|guard|tackle|end\b/i,
  // receiver "to NAME" (fallback)
  toName: new RegExp(String.raw`\bto\s+(${NAME_TOKEN}(?:\s+${NAME_TOKEN})+)\b`, 'i'),
};

/** Extract all "First Last" / "F. Last" style names in order of appearance. */
function extractNames(detail) {
  const names = [];
  if (!detail) return names;
  let m;
  while ((m = NAME_RE.exec(detail)) !== null) {
    names.push(m[1].replace(/\s+/g, ' ').trim());
  }
  // de-dup, keep order
  return [...new Set(names)];
}

/** Find the last name that appears BEFORE the given regex' first match index. */
function lastNameBefore(detail, regex, fallback) {
  const idx = (detail || '').search(regex);
  if (idx < 0) return fallback || null;
  const names = extractNames(detail.slice(0, idx));
  return names.length ? names[names.length - 1] : (fallback || null);
}

/** Parse signed yards from text; returns integer or null if unknown. */
function parseSignedYards(detail) {
  if (!detail) return null;
  if (rx.noGain.test(detail)) return 0;

  // explicit negative like "for -5 yards"
  const mMinus = detail.match(rx.forMinus);
  if (mMinus) return -Number(mMinus[1] || 0);

  // "for a loss of 5 yards" OR "for 5 yards" — need to infer sign from "loss"
  const hasSack = rx.sack.test(detail);
  const hasLossWord = /\bloss\b/i.test(detail);
  const mLossOf = detail.match(rx.lossOf);
  if (mLossOf) {
    const n = Number(mLossOf[1] || 0);
    // If "loss" (or it's a sack), treat as negative
    return (hasLossWord || hasSack) ? -n : n;
  }

  const mFor = detail.match(rx.forYards);
  if (mFor) return Number(mFor[1] || 0);

  return null;
}

/** Parse receiver from "to NAME" if present. */
function parseReceiver(detail) {
  const m = detail.match(rx.completeTo) || detail.match(rx.toName);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** Main parser */
export function parsePlayDetail(detail) {
  const out = {
    type: 'other',
    yards: null,
    touchdown: false,
    fumble: null, // { by: 'Name' }
    players: { passer: null, receiver: null, rusher: null, sackedQb: null },
    events: [],
  };

  if (!detail || rx.noPlay.test(detail)) return out;

  const lower = detail.toLowerCase();
  const names = extractNames(detail);
  const yards = parseSignedYards(detail);
  out.yards = yards;

  const hasTD = rx.td.test(detail);
  out.touchdown = hasTD;

  // ---- SACK (your custom rule: sack => negative rush yards for QB) ----
  if (rx.sack.test(detail)) {
    out.type = 'sack';
    const qb = lastNameBefore(detail, rx.sack, names[0] || null);
    out.players.sackedQb = qb;
    out.players.rusher = qb; // treat QB as rusher for yard loss
    const y = Number.isFinite(yards) ? yards : 0;
    // Ensure negative on sacks
    const signed = y <= 0 ? y : -Math.abs(y);
    out.events.push({ player: qb, stat: 'rush_yds', delta: signed, detail: 'sack' });

    // Fumble on sacks?
    if (rx.fumble.test(detail)) {
      const fum = lastNameBefore(detail, rx.fumble, qb);
      out.fumble = { by: fum };
      out.events.push({ player: fum, stat: 'fumble', delta: 1 });
    }
    if (hasTD) {
      // Very rare: strip-sack returned for TD wouldn’t credit QB; but if you ever encode, attach meta only
      out.events.push({ player: qb, stat: 'sack', delta: 1 });
    }
    return out;
  }

  // ---- PASS PLAYS ----
  if (rx.pass.test(detail)) {
    out.type = 'pass';
    // passer: name nearest before "pass"
    const passer = lastNameBefore(detail, rx.pass, names[0] || null);
    const receiver = parseReceiver(detail);
    out.players.passer = passer;
    out.players.receiver = receiver;

    if (rx.incomplete.test(detail)) {
      // Incomplete: no yards
      out.events.push({ player: passer, stat: 'pass_att', delta: 1 });
      if (receiver) out.events.push({ player: receiver, stat: 'target', delta: 1 });
    } else {
      const y = Number.isFinite(yards) ? yards : 0;
      out.events.push({ player: passer, stat: 'pass_yds', delta: y });
      out.events.push({ player: passer, stat: 'pass_cmp', delta: 1 });
      if (receiver) {
        out.events.push({ player: receiver, stat: 'rec_yds', delta: y });
        out.events.push({ player: receiver, stat: 'rec',  delta: 1 });
      }
      if (hasTD) {
        out.events.push({ player: passer,   stat: 'pass_td', delta: 1 });
        if (receiver) out.events.push({ player: receiver, stat: 'rec_td', delta: 1 });
      }
    }

    // Post-catch fumble?
    if (rx.fumble.test(detail)) {
      // prefer carrier at time of fumble (receiver if completed, else passer if strip before throw)
      const carrier = (!rx.incomplete.test(detail) && receiver) ? receiver : passer;
      out.fumble = { by: lastNameBefore(detail, rx.fumble, carrier) };
      out.events.push({ player: out.fumble.by, stat: 'fumble', delta: 1 });
    }
    return out;
  }

  // ---- RUSH / SCRAMBLE ----
  if (rx.rushHint.test(detail)) {
    out.type = 'rush';
    const rusher = names[0] || null; // first name is almost always the ballcarrier
    out.players.rusher = rusher;
    const y = Number.isFinite(yards) ? yards : 0;
    out.events.push({ player: rusher, stat: 'rush_yds', delta: y });
    out.events.push({ player: rusher, stat: 'rush_att', delta: 1 });
    if (hasTD) out.events.push({ player: rusher, stat: 'rush_td', delta: 1 });

    if (rx.fumble.test(detail)) {
      const fum = lastNameBefore(detail, rx.fumble, rusher);
      out.fumble = { by: fum };
      out.events.push({ player: fum, stat: 'fumble', delta: 1 });
    }
    return out;
  }

  // ---- Fallback (other) ----
  if (rx.fumble.test(detail)) {
    const fum = lastNameBefore(detail, rx.fumble, names[0] || null);
    out.fumble = { by: fum };
    out.events.push({ player: fum, stat: 'fumble', delta: 1 });
  }
  return out;
}

/** Optional: accumulate events into a per-player stat line */
export function accumulateEvents(events) {
  const map = new Map();
  for (const e of events) {
    if (!e.player) continue;
    const k = e.player;
    const row = map.get(k) || {};
    row[e.stat] = (row[e.stat] || 0) + (e.delta || 0);
    map.set(k, row);
  }
  return Object.fromEntries(map);
}
