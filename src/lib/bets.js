// src/lib/bets.js
import {
  normName, cleanPlayerDisplayName,
  flattenPlays, isTouchdownPlay, extractTdScorerFromPlay,
} from "./football";

/** ============ Bet UI ============ */
export function initBetUI(betsArg) {
  const arr = Array.isArray(betsArg)
    ? betsArg
    : (betsArg && typeof betsArg === "object") ? Object.values(betsArg) : [];

  return arr.map((b, i) => {
    const selection = b.selection ?? "";
    const type = b.type ?? "";
    const id = b.id ?? b.key ?? `bet-${i}`;
    const threshold = Number(b.threshold ?? b.line ?? b.target ?? 0);
    const display = b.display ?? "";
    const current = Number(b.currentvalue ?? b.currentValue ?? b.progress ?? b.value ?? 0);

    return {
      id,
      selection,
      type,
      threshold,
      progress: Number.isFinite(current) ? current : 0,
      display,
      raw: b,
    };
  });
}

/** Increment progress for matching player yard props using parsed events */
export function assessPlayImpactOnBetUI(play, components, setComponents) {
  const events = play?.parsed?.events ?? [];
  if (!events.length) return;

  setComponents(prev =>
    prev.map(c => {
      const playerId =
        c.raw?.player ?? c.raw?.selection ?? c.raw?.name ?? c.raw?.type ?? null;

      const playerIdNorm = normName(cleanPlayerDisplayName(playerId));
      if (!playerIdNorm) return c;

      const gained = events
        .filter(e =>
          normName(cleanPlayerDisplayName(e.player)) === playerIdNorm &&
          /^(rush_yds|rec_yds|pass_yds)$/.test(e.stat)
        )
        .reduce((s, e) => s + (Number(e.delta) || 0), 0);

      return gained ? { ...c, progress: Math.max(0, (Number(c.progress) || 0) + gained) } : c;
    })
  );
}

/** ============ Impact flash logic ============ */
function normalizeBetMarket(raw, H, A) {
  const market = String(raw.market || "").toLowerCase();
  const type   = String(raw.type   || "").toLowerCase();
  const sel    = String(raw.selection ?? "").trim().toUpperCase();
  const teamIn = (raw.team || "").toString().toUpperCase();
  const team = [H, A].includes(teamIn) ? teamIn : ([H, A].includes(sel) ? sel : null);

  if (market === "game") {
    if (type === "moneyline") return { kind: "moneyline", market, team };
    if (type === "spread")    return { kind: "spread",    market, team };
    if (type === "total") {
      const side = /^(over|under)$/i.test(raw.selection ?? "") ? String(raw.selection).toLowerCase() : null;
      return { kind: "total", market, side };
    }
    return { kind: "unknown", market };
  }
  if (market === "player") {
    if (type === "td") return { kind: "player_td", market, playerId: raw.selection, team };
    if (type === "rush_yds" || type === "rec_yds" || type === "pass_yds") {
      const details = String(raw.details || "").toUpperCase();
      const side = details === "O" ? "over" : details === "U" ? "under" : null;
      return { kind: "player_yds", market, stat: type, side, playerId: raw.selection, team };
    }
  }
  return { kind: "unknown", market };
}

function yardsDeltaFor(events, playerId, stat) {
  if (!playerId) return 0;
  return events
    .filter(e => e.player === playerId && (stat ? e.stat === stat : /^(rush_yds|rec_yds|pass_yds)$/.test(e.stat)))
    .reduce((s, e) => s + (Number(e.delta) || 0), 0);
}

function didPlayerScoreTd(events, detail, playerId) {
  if (!playerId) return false;
  const byParser = events.some(e =>
    e.player === playerId && (/td/.test(e.stat) || /touchdown/i.test(String(e.note || "")))
  );
  if (byParser) return true;

  const low = String(detail || "").toLowerCase();
  const parts = String(playerId).toLowerCase().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return /touchdown/i.test(detail || "") && !!last && low.includes(last);
}

export function assessPlayImpactFlash({
  play, betComponents, homeCode: H, awayCode: A,
  offenseOnPrevSnap, scoreKind, isSafety, deltas = { homeDelta: 0, awayDelta: 0 },
}) {
  const events = play?.parsed?.events ?? [];
  const detail = play?.detail || "";

  const metas = betComponents.map(c => normalizeBetMarket(c.raw || {}, H, A));
  const hasTeamScoreBets = metas.some(m => m.market === "game" && (m.kind === "moneyline" || m.kind === "spread"));
  const hasGameTotals    = metas.some(m => m.market === "game" && m.kind === "total");

  let scoringTeam = null;
  const pointsScored = (deltas.homeDelta > 0 || deltas.awayDelta > 0 || isSafety || !!scoreKind);
  if (deltas.homeDelta > 0) scoringTeam = H;
  else if (deltas.awayDelta > 0) scoringTeam = A;
  else if (isSafety) scoringTeam = offenseOnPrevSnap === H ? A : offenseOnPrevSnap === A ? H : null;
  else if (scoreKind) scoringTeam = offenseOnPrevSnap || null;

  if (scoreKind === "TD" || /touchdown/i.test(detail)) {
    for (const m of metas) {
      if (m.kind === "player_td" && didPlayerScoreTd(events, detail, m.playerId)) {
        return "positive";
      }
    }
  }

  let sawPlayerImpact = false, playerPositive = false;
  for (const m of metas) {
    if (m.kind !== "player_yds") continue;
    const delta = yardsDeltaFor(events, m.playerId, m.stat);
    if (!delta) continue;
    sawPlayerImpact = true;
    if (m.side === "over") {
      if (delta > 0) playerPositive = true;
      else if (delta < 0 && !playerPositive) playerPositive = false;
    } else if (m.side === "under") {
      if (delta < 0) playerPositive = true;
      else if (delta > 0 && !playerPositive) playerPositive = false;
    }
  }
  if (sawPlayerImpact) return playerPositive ? "positive" : "negative";

  if (pointsScored && hasTeamScoreBets && scoringTeam) {
    const teamFavored = metas.some(m =>
      m.market === "game" && (m.kind === "moneyline" || m.kind === "spread") && m.team === scoringTeam
    );
    return teamFavored ? "positive" : "negative";
  }

  if (pointsScored && hasGameTotals /* && scoreKind !== "XP" */) {
    const overFavored = metas.some(m => m.market === "game" && m.kind === "total" && m.side === "over");
    const underFavored = metas.some(m => m.market === "game" && m.kind === "total" && m.side === "under");
    if (overFavored || underFavored) return overFavored ? "positive" : "negative";
  }
  return null;
}

/** ============ Grading ============ */
const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9\s'.-]/g, " ").replace(/\s+/g, " ").trim();

function cleanPlayer(s) {
  let t = String(s || "");
  t = t.replace(/[,;]+.*$/, "").replace(/\(.*?\)\s*$/, "").replace(/\s+-\s+.*$/, "")
       .replace(/\s+for\b.*$/i, "").replace(/\s+(?:to|from|on|at|with)\b.*$/i, "")
       .replace(/[^a-zA-Z'.\-\s]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(?:for|to|from|on|at|with)$/i, "").trim();
  return t;
}
const toRows = (src) => {
  if (!src) return [];
  if (Array.isArray(src)) return src;
  if (typeof src === "object") {
    const out = [];
    for (const v of Object.values(src)) {
      if (Array.isArray(v)) out.push(...v);
      else if (v != null) out.push(v);
    }
    return out;
  }
  return [];
};

function canonName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[,;]+.*$/, "")
    .replace(/\(.*?\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^a-zA-Z'.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function lastName(s) {
  const t = canonName(s).split(/\s+/).filter(Boolean);
  return t[t.length - 1] || "";
}
function samePlayerLoose(a, b) {
  const A = canonName(a), B = canonName(b);
  if (!A || !B) return false;
  if (A === B) return true;

  // fallback: last name + first initial (or initial missing)
  const At = A.split(" "), Bt = B.split(" ");
  const Al = At[At.length - 1], Bl = Bt[Bt.length - 1];
  if (!Al || !Bl || Al !== Bl) return false;
  const Ai = At[0]?.[0], Bi = Bt[0]?.[0];
  return !Ai || !Bi || Ai === Bi;
}
function didPlayAwardTdTo(play, playerName) {
  if (!play) return false;

  // 1) extractor (preferred)
  const who = extractTdScorerFromPlay(play);
  if (who && samePlayerLoose(who, playerName)) return true;

  // 2) textual fallback
  const detail = String(play.detail || play?.pbp_detail || "").toLowerCase();
  if (!/\btouchdown\b/i.test(detail)) return false; // only TD plays
  const last = lastName(playerName);
  if (last && new RegExp(`\\b${last}\\b`, "i").test(detail)) return true;

  return false;
}

export function gradeTDBetFromPbp(playerName, pbp, which = "first", countNeeded = 1) {
  const plays = flattenPlays(pbp);
  if (!plays.length) return { result: "pending", reason: "No play-by-play", actual: null };

  // collect only TD plays, keep whole play for robust checks
  const tdPlays = [];
  for (const p of plays) {
    if (isTouchdownPlay(p)) tdPlays.push(p);
  }
  if (!tdPlays.length) return { result: "pending", reason: "No touchdowns found", actual: null };

  if (which === "first" || which === "last") {
    const pick = which === "last" ? tdPlays[tdPlays.length - 1] : tdPlays[0];
    const hit = didPlayAwardTdTo(pick, playerName);
    return hit
      ? { result: "won",  reason: `${which === "first" ? "First" : "Last"} TD: ${playerName}`, actual: true }
      : { result: "lost", reason: `${which === "first" ? "First" : "Last"} TD not ${playerName}`, actual: false };
  }

  // Anytime / N+ : count how many TD plays belong to this player
  const got = tdPlays.reduce((n, p) => n + (didPlayAwardTdTo(p, playerName) ? 1 : 0), 0);
  const win = got >= countNeeded;
  return win
    ? { result: "won",  reason: `${got} TDs (need ${countNeeded}+)`, actual: got }
    : { result: "lost", reason: `${got} TDs (need ${countNeeded}+)`, actual: got };
}

export function getPlayerStat(playerName, stat, tables) {
  const { matchup_passing, matchup_receiving, matchup_rushing } = tables || {};
  const key = norm(cleanPlayer(playerName));
  const passRows = toRows(matchup_passing);
  const recRows  = toRows(matchup_receiving);
  const rushRows = toRows(matchup_rushing);

  if (stat === "pass_yds") {
    for (const r of passRows) {
      const nm = norm(cleanPlayer(r?.name_display || r?.name || r?.player));
      if (nm === key) return Number(r?.pass_yds) || 0;
    }
    return 0;
  }
  if (stat === "rec_yds") {
    for (const r of recRows) {
      const nm = norm(cleanPlayer(r?.name_display || r?.name || r?.player));
      if (nm === key) return Number(r?.rec_yds) || 0;
    }
    return 0;
  }
  if (stat === "rush_yds") {
    for (const r of rushRows) {
      const nm = norm(cleanPlayer(r?.name_display || r?.name || r?.player));
      if (nm === key) return Number(r?.rush_yds) || 0;
    }
    return 0;
  }
  return null;
}

export function gradePlayerYards(playerName, stat, side, threshold, tables) {
  const th = Number(String(threshold).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(th)) return { result: "pending", reason: "Invalid threshold", actual: null };

  const got = Number(getPlayerStat(playerName, stat, tables));
  if (!Number.isFinite(got)) return { result: "pending", reason: "Missing stat", actual: null };

  const sideUp = String(side || "").toUpperCase();
  if (sideUp === "O" || sideUp === "OVER") {
    if (got > th)  return { result: "won",  reason: `${stat} ${got} > ${th}`, actual: got };
    if (got === th) return { result: "push", reason: `${stat} ${got} = ${th}`, actual: got };
    return           { result: "lost", reason: `${stat} ${got} < ${th}`, actual: got };
  }
  if (sideUp === "U" || sideUp === "UNDER") {
    if (got < th)  return { result: "won",  reason: `${stat} ${got} < ${th}`, actual: got };
    if (got === th) return { result: "push", reason: `${stat} ${got} = ${th}`, actual: got };
    return           { result: "lost", reason: `${stat} ${got} > ${th}`, actual: got };
  }
  return { result: "pending", reason: "Missing O/U", actual: got };
}

export function gradeMoneyline(teamCode, pbp, H, A) {
  const { home, away } = getFinalScoresFromPbp(pbp, H, A);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { result: "pending", reason: "No final score in PBP", actual: null };
  }

  const isHome = (teamCode || "").toUpperCase() === H;
  const won = isHome ? home > away : away > home;
  const tied = home === away;

  if (tied) return { result: "push", reason: `Tied ${home}-${away}`, actual: null };
  return won
    ? { result: "won",  reason: `${teamCode} won (${home}-${away})`, actual: true }
    : { result: "lost", reason: `${teamCode} lost (${home}-${away})`, actual: false };
}

function gradeSpread(teamCode, spreadThreshold, pbp, H, A) {
  const { home, away } = getFinalScoresFromPbp(pbp, H, A);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { result: "pending", reason: "No final score in PBP", actual: null };
  }

  const isHome = (teamCode || "").toUpperCase() === H;
  const margin = isHome ? (home - away) : (away - home);
  const line = num(spreadThreshold);
  if (!Number.isFinite(line)) return { result: "pending", reason: "Invalid spread", actual: margin };

  if (margin > line)   return { result: "won",  reason: `Margin ${margin} > ${line}`, actual: margin };
  if (margin === line) return { result: "push", reason: `Margin ${margin} = ${line}`, actual: margin };
  return                 { result: "lost", reason: `Margin ${margin} < ${line}`, actual: margin };
}

function gradeTotal(side, totalThreshold, pbp, H, A) {
  const { home, away } = getFinalScoresFromPbp(pbp, H, A);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { result: "pending", reason: "No final score in PBP", actual: null };
  }

  const total = home + away;
  const line = num(totalThreshold);
  if (!Number.isFinite(line)) return { result: "pending", reason: "Invalid total", actual: total };

  const sideUp = String(side || "").toLowerCase();
  if (sideUp === "over") {
    if (total > line)   return { result: "won",  reason: `Total ${total} > ${line}`, actual: total };
    if (total === line) return { result: "push", reason: `Total ${total} = ${line}`, actual: total };
    return                { result: "lost", reason: `Total ${total} < ${line}`, actual: total };
  }
  if (sideUp === "under") {
    if (total < line)   return { result: "won",  reason: `Total ${total} < ${line}`, actual: total };
    if (total === line) return { result: "push", reason: `Total ${total} = ${line}`, actual: total };
    return                { result: "lost", reason: `Total ${total} > ${line}`, actual: total };
  }
  return { result: "pending", reason: "Missing O/U side", actual: total };
}

/** Safely coerce to number (supports strings like "24" or "24*") */
function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Get final score from the last valid PBP line */
function getFinalScoresFromPbp(pbp, H, A) {
  const plays = flattenPlays(pbp);
  if (!Array.isArray(plays) || plays.length === 0) {
    return { home: null, away: null };
  }

  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i] || {};

    // Preferred canonical fields if present
    let homeFinal = num(p.pbp_score_hm);
    let awayFinal = num(p.pbp_score_aw);

    // Fallback: fields keyed by team codes (e.g., "NWE", "TEN")
    if (!Number.isFinite(homeFinal) || !Number.isFinite(awayFinal)) {
      const hk = Object.keys(p).find((k) => String(k).toUpperCase() === H);
      const ak = Object.keys(p).find((k) => String(k).toUpperCase() === A);
      if (hk) homeFinal = num(p[hk]);
      if (ak) awayFinal = num(p[ak]);
    }

    if (Number.isFinite(homeFinal) && Number.isFinite(awayFinal)) {
      return { home: homeFinal, away: awayFinal };
    }
  }

  return { home: null, away: null };
}


export function gradeBets(bets = [], ctx = {}) {
  const {
    home, away, pbp, scoring,
    matchup_passing, matchup_receiving, matchup_rushing,
  } = ctx;

  const H = (home?.code || "").toUpperCase();
  const A = (away?.code || "").toUpperCase();

  return (bets || []).map((b) => {
    const market = String(b?.market || b?.bet?.market || "").toLowerCase();
    const type = String(b?.type || b?.bet?.type || "").toLowerCase();
    const sel = b?.selection ?? b?.bet?.selection ?? "";
    const team = (b?.team ?? b?.bet?.team ?? sel).toString().toUpperCase();
    const details = b?.details ?? b?.bet?.details ?? "";
    const threshold = b?.threshold ?? b?.bet?.threshold ?? "";

    let graded = { result: "pending", reason: "Not graded", actual: null };

    if (market === "player") {
      if (type === "td") {
        const th = String(threshold || "").toLowerCase();
        if (th === "first" || th === "last") {
          graded = gradeTDBetFromPbp(sel, pbp, th); // actual: boolean
        } else {
          const need = Number(String(threshold).replace(/[^\d.-]/g, "")) || 1;
          graded = gradeTDBetFromPbp(sel, pbp, "any", need); // actual: count
        }
      } else if (["pass_yds", "rec_yds", "rush_yds"].includes(type)) {
        graded = gradePlayerYards(sel, type, details, threshold, {
          matchup_passing, matchup_receiving, matchup_rushing,
        }); // actual: yards
      } else {
        graded = { result: "pending", reason: `Unknown player market: ${type}`, actual: null };
      }
    } else if (market === "game") {
      if (type === "moneyline") {
        graded = gradeMoneyline(team, pbp, H, A); // now uses PBP
      } else if (type === "spread") {
        graded = gradeSpread(team, threshold, pbp, H, A); // uses PBP
      } else if (type === "total") {
        const side = (sel || "").toString().toLowerCase(); // "over" / "under"
        graded = gradeTotal(side, threshold, pbp, H, A); // uses PBP
      } else {
        graded = { result: "pending", reason: `Unknown game market: ${type}`, actual: null };
      }
    } else {
      graded = { result: "pending", reason: `Unknown market: ${market}`, actual: null };
    }

    return { ...b, result: graded.result, reason: graded.reason, actual: graded.actual };
  });
}
