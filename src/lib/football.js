// src/lib/football.js
import { parsePlayDetail } from "./parsePlayDetail";

/** ===================== Shared Normalizers ===================== */
export const SNAP_DOWNS = new Set(["1","2","3","4"]);
export const rx = {
  kickoff: /\bkicks off\b|\bkickoff\b/i,
  punt: /\bpunts?\b/i,
  int: /\bintercept|\bpicked off|\binterception\b/i,
  fumbleAny: /\bfumbles?\b/i,
  fumbleLost: /\bfumble[sd]?.*\brecovered by\b/i,
  safety: /\bsafety\b/i,
  timeout: /\btimeout\b/i,
  touchback: /\btouchback\b/i,
  tod: /\bturnover on downs\b|\bon downs\b/i,
  noPlay: /\bno play\b|nullified|offsetting/i,
  recoveredBy: /\brecovered by ([^,]+?)(?: at ([A-Z]{2,3})[- ]?(\d{1,2}|50))?\b/i,
};

export function normName(n) {
  return String(n || "")
    .toLowerCase()
    .replace(/[^a-z\s'.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanPlayerDisplayName(s) {
  let t = String(s || "");
  t = t.replace(/[,;]+.*$/, "");
  t = t.replace(/\(.*?\)\s*$/, "");
  t = t.replace(/\s+-\s+.*$/, "");
  t = t.replace(/\s+for\b.*$/i, "");
  t = t.replace(/\s+(?:to|from|on|at|with)\b.*$/i, "");
  t = t.replace(/[^a-zA-Z'.\-\s]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(?:for|to|from|on|at|with)$/i, "").trim();
  return t;
}

export const toNum = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : NaN;
};
export const clamp01 = (v) => Math.max(0, Math.min(100, v));
export function displayNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
}

/** ===================== Event Classification ===================== */
export function classifyEvent(detail, down) {
  const t = (detail || "").toLowerCase();
  if (rx.kickoff.test(t)) return "KICKOFF";
  if (rx.punt.test(t)) return "PUNT";
  if (rx.int.test(t)) return "TURNOVER";
  if (rx.tod.test(t)) return "TURNOVER";
  if (rx.safety.test(t)) return "SAFETY";
  if (rx.timeout.test(t)) return "TIMEOUT";
  if (SNAP_DOWNS.has(String(down))) return "SNAP";
  if (rx.fumbleAny.test(t)) return "FUMBLE";
  return "OTHER";
}

export function classifyScore(detail) {
  const t = (detail || "").toLowerCase();
  if (/\btouchdown\b/.test(t)) return "TD";
  if (/\b(extra point|pat)\b.*\bgood\b/i.test(t)) return "XP";
  if (/\bfield goal\b.*\bgood\b/i.test(t)) return "FG";
  return null;
}

/** ===================== Teams, Sides, Orientation ===================== */
function buildTeamAliases(team) {
  const code = (team?.code || "").toUpperCase();
  const name = (team?.name || "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const words = name.split(" ").filter(Boolean);
  const aliases = new Set([code]);
  if (words.length >= 2) aliases.add(words[0][0] + words[1][0]);
  if (words.length >= 1) {
    aliases.add(words.map(w => w[0]).join(""));
    aliases.add(words[0].slice(0, 2));
    aliases.add(words[0].slice(0, 3));
  }
  if (words.length >= 2) {
    aliases.add(words[1].slice(0, 2));
    aliases.add(words[1].slice(0, 3));
  }
  const specials = {
    "NEW ENGLAND": ["NE"], "NEW ORLEANS": ["NO"], "NEW YORK": ["NY"],
    "LOS ANGELES": ["LA"], "SAN FRANCISCO": ["SF"], "TAMPA BAY": ["TB"],
    "GREEN BAY": ["GB"], "KANSAS CITY": ["KC"], "LAS VEGAS": ["LV"],
    "JACKSONVILLE JAGUARS": ["JAX","JAC"], "WASHINGTON COMMANDERS": ["WAS","WSH"],
  };
  const key2 = words.slice(0,2).join(" ");
  if (specials[key2]) specials[key2].forEach(a => aliases.add(a));
  return aliases;
}

export function makeSideIsHomeFn(home, away) {
  const homeSet = buildTeamAliases(home);
  const awaySet = buildTeamAliases(away);
  return (sideRaw) => {
    const s = String(sideRaw || "").toUpperCase();
    if (!s) return false;
    if (homeSet.has(s)) return true;
    if (awaySet.has(s)) return false;
    for (const a of homeSet) if (a && (a.startsWith(s) || s.startsWith(a))) return true;
    for (const a of awaySet) if (a && (a.startsWith(s) || s.startsWith(a))) return false;
    return false;
  };
}

export function parseLocation(loc) {
  if (!loc) return null;
  const s = String(loc).trim().toUpperCase().replace(/\s+/g, " ");
  let m = s.match(/^([A-Z]{2,3})[- ]?(\d{1,2}|50)$/);
  if (m) return { side: m[1], yard: Number(m[2]) };
  m = s.match(/^(\d{1,2}|50)[- ]?([A-Z]{2,3})$/);
  if (m) return { side: m[2], yard: Number(m[1]) };
  m = s.match(/^(\d{1,2}|50)$/);
  if (m) return { side: null, yard: Number(m[1]) };
  return null;
}

export function yardlineToPercentBySide(ctx, isHomeSide, homeLeft) {
  if (!ctx || !Number.isFinite(ctx.yard)) return 50;
  const base = ctx.side == null ? 50 : (isHomeSide(ctx.side) ? ctx.yard : 100 - ctx.yard);
  return homeLeft ? base : 100 - base;
}

export function dirForTeam(teamCode, homeLeft, H, A) {
  if (teamCode !== H && teamCode !== A) return 0;
  const isHome = teamCode === H;
  return homeLeft ? (isHome ? +1 : -1) : (isHome ? -1 : +1);
}

export function inferOffense(snap, isHomeSide, H, A) {
  if (!snap?.location) return null;
  const ctx = parseLocation(snap.location);
  if (!ctx || ctx.side == null) return null;
  return isHomeSide(ctx.side) ? A : H;
}

export function ordinalSuffix(nStr) {
  const n = Number(nStr);
  if (!Number.isFinite(n)) return "";
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

/** ===================== PBP Flatten / Finders ===================== */
export function flattenPlays(pbp) {
  if (!pbp || typeof pbp !== "object") return [];
  const order = ["1", "2", "3", "4", "5", "OT", "ot"];
  const keys = Object.keys(pbp).sort((a,b)=>{
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const out = [];
  for (const k of keys) {
    const arr = Array.isArray(pbp[k]) ? pbp[k] : [];
    for (const p of arr) out.push({ ...p, quarter: p.quarter ?? k });
  }
  return out;
}

export function findSnapIndex(arr, i, dir) {
  if (!Array.isArray(arr) || i == null) return -1;
  if (dir === -1) { for (let k = i; k >= 0; k--) if (arr[k]?.isSnap) return k; return -1; }
  if (dir === +1) { for (let k = i + 1; k < arr.length; k++) if (arr[k]?.isSnap) return k; return -1; }
  return -1;
}

export function isHomeLeftForQuarter(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return false; // OT -> homeRight
  return n === 1 || n === 3;
}

/** ===================== Starters map ===================== */
export function startersToList(starters) {
  if (!starters) return [];
  if (Array.isArray(starters)) return starters;
  if (typeof starters === "object") {
    const vals = Object.values(starters);
    const flat = [];
    for (const v of vals) {
      if (Array.isArray(v)) flat.push(...v);
      else if (v != null) flat.push(v);
    }
    return flat;
  }
  return [starters];
}

export function buildStartersMap(homeStarters, awayStarters, H, A) {
  const map = new Map();
  const pullName = (row) => {
    if (typeof row === "string") return row;
    if (!row || typeof row !== "object") return null;
    return (
      row.name || row.player || row.fullName || row.displayName || row.last_first ||
      row.lastFirst || row.Player || row["Player Name"] || null
    );
  };
  const homeList = startersToList(homeStarters);
  const awayList = startersToList(awayStarters);
  for (let idx = 0; idx < homeList.length; idx++) {
    const nm = pullName(homeList[idx]);
    if (nm) map.set(normName(nm), H);
  }
  for (let idx = 0; idx < awayList.length; idx++) {
    const nm = pullName(awayList[idx]);
    if (nm) map.set(normName(nm), A);
  }
  return map;
}

/** ===================== Parsing helpers / annotation ===================== */
function parseRecovery(detail) {
  if (!detail) return null;
  const m = detail.match(rx.recoveredBy);
  if (!m) return null;
  const name = (m[1] || "").trim();
  const side = m[2] ? m[2].toUpperCase() : null;
  const yard = m[3] ? Number(m[3]) : null;
  const loc = side && Number.isFinite(yard) ? { side, yard } : null;
  return { name, loc };
}

function normalizeParsedPlayers(parsed, startersMap) {
  if (!parsed || !Array.isArray(parsed.events)) return parsed;
  const events = parsed.events.map(e => {
    const cleaned = cleanPlayerDisplayName(e.player);
    return { ...e, player: cleaned };
  });
  return { ...parsed, events };
}

export function annotatePlays(plays, home, away, startersMap) {
  const H = (home.code || "").toUpperCase();
  const A = (away.code || "").toUpperCase();
  const sideIsHome = makeSideIsHomeFn(home, away);

  const out = plays.map((p, idx) => ({
    ...p,
    idx,
    event: classifyEvent(p.detail, p.down),
    isSnap: SNAP_DOWNS.has(String(p.down)),
    startOfDrive: false,
    posTeam: null,
    fumble: null,
    parsed: normalizeParsedPlayers(parsePlayDetail(p.detail), startersMap)
  }));

  let posTeam = null;
  let pendingFlip = false;
  let pendingOffense = null;
  let lastSnapPosTeam = null;

  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    const text = p.detail || "";
    const tLower = text.toLowerCase();

    let fumbleInfo = null;
    if (rx.fumbleAny.test(tLower) && rx.recoveredBy.test(text)) {
      const parsed = parseRecovery(text);
      if (parsed?.name) {
        const recTeamCode = startersMap.get(normName(parsed.name)) || null; // H or A
        fumbleInfo = { recoveredByTeam: recTeamCode, recoveryLoc: parsed.loc || null };
      }
    }

    if (p.event === "KICKOFF" && !rx.noPlay.test(text)) {
      pendingFlip = true;
      const kickSide = parseLocation(p.location)?.side;
      const kickerIsHome = kickSide ? sideIsHome(kickSide) : null;
      pendingOffense = kickerIsHome === null ? null : (kickerIsHome ? A : H);
    } else if (p.event === "PUNT" && !rx.noPlay.test(text)) {
      pendingFlip = true;
      pendingOffense = posTeam ? (posTeam === H ? A : H) : null;
    } else if ((p.event === "TURNOVER" || p.event === "SAFETY") && !rx.noPlay.test(text)) {
      pendingFlip = true;
      pendingOffense = posTeam ? (posTeam === H ? A : H) : null;
    } else if (p.event === "FUMBLE" && !rx.noPlay.test(text)) {
      if (fumbleInfo) {
        p.fumble = fumbleInfo;
        if (posTeam && fumbleInfo.recoveredByTeam) {
          if (fumbleInfo.recoveredByTeam !== posTeam) {
            pendingFlip = true;
            pendingOffense = fumbleInfo.recoveredByTeam;
          }
        } else if (posTeam && !fumbleInfo.recoveredByTeam) {
          pendingFlip = true;
          pendingOffense = posTeam === H ? A : H;
        }
      } else if (rx.fumbleLost.test(tLower)) {
        pendingFlip = true;
        pendingOffense = posTeam === H ? A : H;
      }
    }

    if (p.isSnap) {
      if (pendingFlip) {
        posTeam = pendingOffense ?? inferOffense(p, sideIsHome, H, A) ?? posTeam;
        pendingFlip = false;
        pendingOffense = null;
      }
      if (!posTeam) posTeam = inferOffense(p, sideIsHome, H, A) ?? posTeam;
      p.posTeam = posTeam;
      if (lastSnapPosTeam == null || p.posTeam !== lastSnapPosTeam) p.startOfDrive = true;
      lastSnapPosTeam = p.posTeam;
    } else {
      p.posTeam = posTeam;
      if (fumbleInfo && !p.fumble) p.fumble = fumbleInfo;
    }
  }

  return out;
}

export function findDriveHeadIndexRobust(arr, snapIdx) {
  if (snapIdx == null || snapIdx < 0) return -1;
  for (let j = snapIdx; j >= 0; j--) {
    const p = arr[j];
    const t = p?.detail || "";
    if ((p?.event === "KICKOFF" || p?.event === "PUNT" || p?.event === "TURNOVER" || p?.event === "SAFETY") && !rx.noPlay.test(t)) {
      for (let q = j + 1; q < arr.length; q++) if (arr[q]?.isSnap) return q;
      return -1;
    }
  }
  const off = arr[snapIdx]?.posTeam ?? null;
  for (let j = snapIdx; j >= 0; j--) {
    const p = arr[j];
    if (!p?.isSnap) continue;
    if (off == null) continue;
    if (p.posTeam !== off) {
      for (let q = j + 1; q <= snapIdx; q++) if (arr[q]?.isSnap && arr[q].posTeam === off) return q;
      return -1;
    }
  }
  for (let q = 0; q <= snapIdx; q++) if (arr[q]?.isSnap && (off == null || arr[q].posTeam === off)) return q;
  return -1;
}

export function findSeriesHeadIndex(arr, refIdx, driveHeadIdx) {
  if (refIdx == null || refIdx < 0) return -1;
  const driveHead = driveHeadIdx ?? findDriveHeadIndexRobust(arr, refIdx);
  if (driveHead < 0) return -1;
  const off = arr[refIdx]?.posTeam ?? null;
  for (let j = refIdx; j >= driveHead; j--) {
    const p = arr[j];
    if (p?.isSnap && p.posTeam === off && String(p.down) === "1") return j;
  }
  return driveHead;
}

/** ===================== TD detection helpers ===================== */
export function isTouchdownPlay(play) {
  const d = String(play?.detail || "");
  if (/\btouchdown\b/i.test(d)) return true;
  const hasPatOr2pt = /\((?:[^)]*\bkick\b|[^)]*\bextra point\b|[^)]*\btwo[-\s]?point\b|[^)]*\b2\s*pt\b|[^)]*\brun failed\b)\)/i.test(d);
  const tdShaped =
    /\b\d+\s+yard\s+pass\s+from\b/i.test(d) ||
    /\b\d+\s+yard\s+rush\b/i.test(d) ||
    /\b\d+\s+yard\s+(?:interception|fumble|punt|kickoff)\s+return\b/i.test(d);
  if (/\bfield goal\b/i.test(d)) return false;
  return hasPatOr2pt && tdShaped;
}

export function extractTdScorerFromPlay(play) {
  const detail = String(play?.detail || "");
  const parsed = play?.parsed;
  if (parsed && Array.isArray(parsed.events)) {
    const tdEv = parsed.events.find(e => /td|touchdown/i.test(String(e?.stat)));
    if (tdEv?.player) return cleanPlayerDisplayName(tdEv.player);
    const recOnTd = parsed.events.find(e => e?.stat === "rec_yds" && /touchdown/i.test(String(e?.note || detail)));
    if (recOnTd?.player) return cleanPlayerDisplayName(recOnTd.player);
  }
  let m = detail.match(/\bto\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)+)\s+for\b/);
  if (m) return cleanPlayerDisplayName(m[1]);
  m = detail.match(/^\s*([^,(]+?)\s+\d+\s+yard\s+pass\s+from\b/i);
  if (m) return cleanPlayerDisplayName(m[1]);
  m = detail.match(/^\s*([^,(]+?)\s+\d+\s+yard\s+rush\b/i);
  if (m) return cleanPlayerDisplayName(m[1]);
  m = detail.match(/^\s*([^,(]+?)\s+\d+\s+yard\s+(?:interception|fumble|punt|kickoff)\s+return\b/i);
  if (m) return cleanPlayerDisplayName(m[1]);
  m = detail.match(/\btouchdown\b.*?\bby\s+([^,(]+?)(?:\s+for\b|,|\(|\.|$)/i);
  if (m) return cleanPlayerDisplayName(m[1]);
  m = detail.match(/\bto\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)+)\b/);
  if (m) return cleanPlayerDisplayName(m[1]);
  return null;
}
