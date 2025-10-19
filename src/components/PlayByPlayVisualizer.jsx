// src/components/PlayByPlayVisualizer.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildStartersMap, flattenPlays, annotatePlays,
  isHomeLeftForQuarter, makeSideIsHomeFn,
  yardlineToPercentBySide, parseLocation,
  dirForTeam, inferOffense, ordinalSuffix,
  findSnapIndex, classifyEvent, classifyScore,
  toNum, clamp01, displayNum, extractTdScorerFromPlay,
  findDriveHeadIndexRobust, findSeriesHeadIndex, rx
} from "../lib/football";
import { initBetUI } from "../lib/bets";
import { palette, surfaces } from "../styles/theme";

/* ---------------- helpers ---------------- */

// --- robust name cleaners + matcher ---
function cleanTdName(s) {
  let t = String(s || "");
  t = t.replace(/[,;]+.*$/, "")
       .replace(/\(.*?\)\s*$/, "")
       .replace(/\s+-\s+.*$/, "")
       .replace(/\s+\b(?:for|to|from|on|at|with)\b.*$/i, "")
       .replace(/[^a-zA-Z'.\-\s]/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  t = t.replace(/\b(?:for|to|from|on|at|with)$/i, "").trim();
  return t;
}
function canonName(s) {
  return cleanTdName(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function samePlayer(a, b) {
  const A = canonName(a), B = canonName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const At = A.split(" "), Bt = B.split(" ");
  const Al = At[At.length - 1], Bl = Bt[Bt.length - 1];
  if (!Al || !Bl || Al !== Bl) return false;
  const Ai = At[0]?.[0], Bi = Bt[0]?.[0];
  return !Ai || !Bi || Ai === Bi;
}

function lastNameOf(s) {
  const toks = canonName(s).split(/\s+/).filter(Boolean);
  return toks[toks.length - 1] || "";
}

function didThisPlayScoreFor(player, play) {
  if (!play) return false;
  const events = play?.parsed?.events ?? [];

  // parser signals
  if (events.some(e =>
      samePlayer(e.player, player) &&
      (/td/i.test(String(e.stat || "")) || /touchdown/i.test(String(e.note || "")))
  )) return true;

  // extracted scorer
  const who = extractTdScorerFromPlay(play);
  if (who && samePlayer(who, player)) return true;

  // text fallback
  const detail = String(play.detail || "").toLowerCase();
  const last = canonName(player).split(" ").pop();
  if (/\btouchdown\b/i.test(detail) && last && detail.includes(last)) return true;

  return false;
}

// ================= NEW: piggyback helpers over existing parsed events/grading ================
const STAT_ALIASES = {
  rush: new Set(["rush_yds", "rush_yards", "rushing_yards"]),
  rec:  new Set(["rec_yds", "recv_yards", "rec_yards", "receiving_yards"]),
  pass: new Set(["pass_yds", "pass_yards", "passing_yards"]),
};

function getPlayerFromRaw(raw) {
  // Use whatever your bet objects already carry
  return raw?.selection || raw?.player || raw?.name || raw?.type || "";
}

function getTeamCodeFromRaw(raw, home, away) {
  const Hcode = String(home.code || "").toUpperCase();
  const Acode = String(away.code || "").toUpperCase();
  const Hname = String(home.name || "").toUpperCase();
  const Aname = String(away.name || "").toUpperCase();

  const t = String(raw?.team || raw?.side || raw?.selection || raw?.name || "").toUpperCase();
  if (!t) return null;

  const match = (needle, code, name) =>
    needle === code || needle === name || needle.includes(code) || needle.includes(name) ||
    code.includes(needle) || name.includes(needle);

  if (match(t, Hcode, Hname)) return Hcode;
  if (match(t, Acode, Aname)) return Acode;
  return null;
}

function getKindFromRaw(raw) {
  const m = String(raw?.market || "").toLowerCase();
  const t = String(raw?.type || "").toLowerCase();
  if (/rush/.test(m) || /rush/.test(t)) return "rush";
  if (/(rec|recv|receive)/.test(m) || /(rec|recv|receive)/.test(t)) return "rec";
  if (/pass/.test(m) || /pass/.test(t)) return "pass";
  return null;
}

function getOUSideFromRaw(raw) {
  const m = String(raw?.market || "").toLowerCase();
  const d = String(raw?.details || raw?.side || raw?.ou || raw?.labelTop || "").toLowerCase();
  if (/over/.test(m) || /^(o|over)\b/.test(d)) return "OVER";
  if (/under/.test(m) || /^(u|under)\b/.test(d)) return "UNDER";
  return null;
}

function deltaForPlayerOnPlay(events, player, kind /* 'rush'|'rec'|'pass' */) {
  if (!kind) return 0;
  const set = STAT_ALIASES[kind] || new Set();
  return (events || [])
    .filter(e => samePlayer(e.player, player) && set.has(String(e.stat || "").toLowerCase()))
    .reduce((s, e) => s + (Number(e.delta) || 0), 0);
}

function getScoreAt(play) {
  // Read the running score stamped on a play row
  return {
    home: Number.isFinite(toNum(play?.pbp_score_hm)) ? toNum(play.pbp_score_hm) : null,
    away: Number.isFinite(toNum(play?.pbp_score_aw)) ? toNum(play.pbp_score_aw) : null,
  };
}

function findPrevScore(enriched, idx) {
  for (let k = idx - 1; k >= 0; k--) {
    const s = getScoreAt(enriched[k]);
    if (s.home != null || s.away != null) return s;
  }
  return { home: null, away: null };
}
// ============================================================================================

/* ================================================================ */

export default function PlayByPlayVisualizer({
  home,
  away,
  pbp,
  homeTeamStarters = [],
  awayTeamStarters = [],
  initialAuto = false,
  bets = []
}) {
  const H = (home.code || "").toUpperCase();
  const A = (away.code || "").toUpperCase();

  /** ---------------- Bet UI state ---------------- */
  const [betUI, setBetUI] = useState(() =>
    initBetUI(bets).map(c =>
      String(c.type).toLowerCase() === "td" ? { ...c, hits: 0 } : c
    )
  );
  useEffect(() => {
    setBetUI(
      initBetUI(bets).map(c =>
        String(c.type).toLowerCase() === "td" ? { ...c, hits: 0 } : c
      )
    );
  }, [bets]);

  /** ---------------- Derived data ---------------- */
  const startersMap = useMemo(
    () => buildStartersMap(homeTeamStarters, awayTeamStarters, H, A),
    [homeTeamStarters, awayTeamStarters, H, A]
  );
  const plays = useMemo(() => flattenPlays(pbp), [pbp]);
  const enriched = useMemo(
    () => annotatePlays(plays, home, away, startersMap),
    [plays, home, away, startersMap]
  );

  /** ---------------- Playback state ---------------- */
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(initialAuto);
  const current = enriched[i] ?? null;

  const renderHomeLeft = useMemo(() => isHomeLeftForQuarter(current?.quarter), [current?.quarter]);
  const isHomeSide = useMemo(() => makeSideIsHomeFn(home, away), [home, away]);

  /** ---------------- Score carry-forward ---------------- */
  const [score, setScore] = useState({ home: 0, away: 0 });
  const prevScoreRef = useRef({ home: 0, away: 0 });

  useEffect(() => {
    const hm = toNum(current?.pbp_score_hm);
    const aw = toNum(current?.pbp_score_aw);
    setScore(prev => ({
      home: Number.isFinite(hm) ? hm : prev.home,
      away: Number.isFinite(aw) ? aw : prev.away
    }));
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ---------------- Snap neighbors ---------------- */
  const prevSnapIdx = useMemo(() => findSnapIndex(enriched, i, -1), [enriched, i]);
  const nextSnapIdx = useMemo(() => findSnapIndex(enriched, i, +1), [enriched, i]);
  const prevSnap = prevSnapIdx >= 0 ? enriched[prevSnapIdx] : null;
  const nextSnap = nextSnapIdx >= 0 ? enriched[nextSnapIdx] : null;

  const evt = current ? classifyEvent(current.detail, current.down) : "OTHER";
  const scoreKind = classifyScore(current?.detail);

  const nextChangesDrive =
    !!nextSnap &&
    (nextSnap.startOfDrive ||
      (prevSnap?.posTeam && nextSnap.posTeam && nextSnap.posTeam !== prevSnap.posTeam));

  const activeSnap =
    current?.isSnap
      ? current
      : ((evt === "KICKOFF" || evt === "PUNT" || nextChangesDrive) && nextSnap)
      ? nextSnap
      : prevSnap;

  const activeIdx = activeSnap ? activeSnap.idx : -1;

  const headIdx = useMemo(
    () => findDriveHeadIndexRobust(enriched, activeIdx),
    [enriched, activeIdx]
  );
  const headSnap = headIdx >= 0 ? enriched[headIdx] : null;

  const seriesHeadIdx = useMemo(
    () => findSeriesHeadIndex(enriched, prevSnapIdx >= 0 ? prevSnapIdx : activeIdx, headIdx),
    [enriched, prevSnapIdx, activeIdx, headIdx]
  );
  const seriesHeadSnap = seriesHeadIdx >= 0 ? enriched[seriesHeadIdx] : headSnap;

  const driveOffense = headSnap?.posTeam || inferOffense(headSnap, isHomeSide, H, A);

  const driveDirInRender = (() => {
    if (!driveOffense || !headSnap) return 0;
    const headFrameLeft = isHomeLeftForQuarter(headSnap.quarter);
    const d = dirForTeam(driveOffense, headFrameLeft, H, A);
    return headFrameLeft === renderHomeLeft ? d : -d;
  })();

  const flipDrive = evt === "KICKOFF" || scoreKind === "XP";
  const driveDirForField = flipDrive
    ? (driveDirInRender ? -driveDirInRender : -1)
    : (driveDirInRender || 1);

  const xInFrame = (loc, homeLeftFrame) =>
    yardlineToPercentBySide(parseLocation(loc), isHomeSide, homeLeftFrame);
  const toRenderFrame = (pctFromFrame, homeLeftFrame) =>
    homeLeftFrame === renderHomeLeft ? pctFromFrame : 100 - pctFromFrame;

  const renderLosPrev = prevSnap
    ? toRenderFrame(xInFrame(prevSnap.location, isHomeLeftForQuarter(prevSnap.quarter)), isHomeLeftForQuarter(prevSnap.quarter))
    : 50;

  const renderLosNext = nextSnap
    ? toRenderFrame(xInFrame(nextSnap.location, isHomeLeftForQuarter(nextSnap.quarter)), isHomeLeftForQuarter(nextSnap.quarter))
    : renderLosPrev;

  // Start marker
  const evtClass = evt;
  const startX = (() => {
    if (evtClass === "KICKOFF") {
      const kFrame = isHomeLeftForQuarter(current?.quarter);
      const kPct = current?.location ? xInFrame(current.location, kFrame) : renderLosPrev;
      return toRenderFrame(kPct, kFrame);
    }
    const base = headSnap?.location ? headSnap : prevSnap;
    if (base?.location) {
      const bFrame = isHomeLeftForQuarter(base.quarter);
      const bPct = xInFrame(base.location, bFrame);
      return toRenderFrame(bPct, bFrame);
    }
    return renderLosPrev;
  })();

  // Result marker (endzone pinning)
  const offenseOnPrevSnap = prevSnap?.posTeam || inferOffense(prevSnap, isHomeSide, H, A);
  let resultEndzoneSide = null;
  if (scoreKind && offenseOnPrevSnap) {
    const prevFrameLeft = isHomeLeftForQuarter(prevSnap?.quarter);
    const dirPrev = dirForTeam(offenseOnPrevSnap, prevFrameLeft, H, A);
    const endInPrevFrame = dirPrev > 0 ? "right" : "left";
    resultEndzoneSide =
      prevFrameLeft === renderHomeLeft ? endInPrevFrame : endInPrevFrame === "right" ? "left" : "right";
  }

  let resultX = renderLosNext;
  if (evtClass === "KICKOFF" || evtClass === "PUNT") {
    if (evtClass === "KICKOFF") {
      const isTB = rx.touchback.test(current?.detail || "");
      if (isTB) {
        const kickSide = parseLocation(current?.location)?.side;
        const kickerIsHome = kickSide ? isHomeSide(kickSide) : null;
        const receivingIsHome = kickerIsHome === null ? null : !kickerIsHome;
        const receivingLeftInRender =
          receivingIsHome === null ? renderHomeLeft : receivingIsHome ? renderHomeLeft : !renderHomeLeft;
        resultEndzoneSide = receivingLeftInRender ? "left" : "right";
      } else {
        resultEndzoneSide = null;
        resultX = renderLosNext;
      }
    } else {
      resultEndzoneSide = null;
      resultX = renderLosNext;
    }
  }
  if (current?.fumble && current.fumble.recoveredByTeam && prevSnap?.posTeam) {
    const offTeam = prevSnap.posTeam;
    if (current.fumble.recoveredByTeam === offTeam && current.fumble.recoveryLoc) {
      const recFrame = isHomeLeftForQuarter(current.quarter);
      const recPct = xInFrame(current.fumble.recoveryLoc, recFrame);
      resultEndzoneSide = null;
      resultX = toRenderFrame(recPct, recFrame);
    }
  }

  // First-down line
  let firstDownX = null;
  if (scoreKind !== "XP" && evtClass !== "KICKOFF") {
    const baseSnap = evtClass === "PUNT" ? (seriesHeadSnap || prevSnap || activeSnap) : (activeSnap || prevSnap || seriesHeadSnap);
    if (baseSnap?.location) {
      const frameLeft = isHomeLeftForQuarter(baseSnap.quarter);
      const losPct = xInFrame(baseSnap.location, frameLeft);
      const ytg = toNum(baseSnap.yds_to_go);
      const off = baseSnap.posTeam || inferOffense(baseSnap, isHomeSide, H, A);
      const dir = dirForTeam(off, frameLeft, H, A);
      if (Number.isFinite(ytg) && ytg > 0 && (dir === 1 || dir === -1)) {
        const firstPct = clamp01(losPct + dir * ytg);
        firstDownX = toRenderFrame(firstPct, frameLeft);
      }
    }
  }

  /** ---------------- Auto-play timer ---------------- */
  const timerRef = useRef(null);
  useEffect(() => {
    if (!auto) { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setI(prev => (prev >= enriched.length - 1 ? prev : prev + 1));
    }, 250);
    return () => clearInterval(timerRef.current);
  }, [auto, enriched.length]);

  /** ---------------- Bet impact pulse piggyback ---------------- */
  const [impactFlash, setImpactFlash] = useState(null); // NEW: 'pos' | 'neg' | null

  useEffect(() => {
    if (!current) return;

    const events = current?.parsed?.events ?? [];
    let posCount = 0, negCount = 0; // net color for field flash

    const prevScore = findPrevScore(enriched, i);
    const nowScore = getScoreAt(current);
    const hDelta = (nowScore.home != null && prevScore.home != null) ? nowScore.home - prevScore.home : 0;
    const aDelta = (nowScore.away != null && prevScore.away != null) ? nowScore.away - prevScore.away : 0;
    const anyScoreThisPlay = (hDelta > 0) || (aDelta > 0);
    
    setBetUI(prev =>
      prev.map(c => {
        const raw = c.raw || {};
        let { progress = Number(c.progress) || 0, status = c.status ?? null } = c;
        let pulse = null;

        // ---------------- Player yard props (OVER/UNDER)
        const kind = getKindFromRaw(raw);         // 'rush' | 'rec' | 'pass' | null
        const side = getOUSideFromRaw(raw);       // 'OVER' | 'UNDER' | null
        const player = getPlayerFromRaw(raw);

        const yardDelta = deltaForPlayerOnPlay(events, player, kind);
        if (kind && side && yardDelta !== 0) {
          const helpful = (side === "OVER"  && yardDelta > 0) ||
                          (side === "UNDER" && yardDelta < 0);
          pulse = helpful ? "pos" : "neg";
          helpful ? posCount++ : negCount++;

          // Keep your existing progress/threshold model:
          const before = progress;
          const after  = before + yardDelta;
          progress = after;

          const th = Number(c.threshold) || 0;
          // Only lock status on actual crossing — this piggybacks your model
          if (side === "OVER") {
            if (before < th && after >= th) status = "won";
            else if (before >= th && after < th) status = status ?? null; // don't flip to lost mid-game unless you want symmetry
          } else if (side === "UNDER") {
            if (before > th && after <= th) status = "won";
            else if (before <= th && after > th) status = status ?? null;
          }
        }

        // ---------------- Game totals (OVER/UNDER) piggyback: use score delta
        const mkt = String(raw.market || "").toLowerCase();
        const tstr = String(raw.type || "").toLowerCase();
        const isTotal = /total|over_under|game_total/.test(mkt) || /over|under/.test(tstr);
        if (isTotal && anyScoreThisPlay) {
          const sideTotal = getOUSideFromRaw(raw) || (tstr.includes("over") ? "OVER" : tstr.includes("under") ? "UNDER" : null);
          
          if (sideTotal) {
            const points = (hDelta || 0) + (aDelta || 0);
            const helpful = (sideTotal === "OVER"  && points > 0) ||
                            (sideTotal === "UNDER" && points > 0 ? false : false); // any points hurt UNDER
            pulse = helpful ? "pos" : "neg";
            helpful ? posCount++ : negCount++;
          }
        }

        // ---------------- Team moneyline/spread piggyback: score delta by team
        const isMoneyline = /moneyline|ml\b/.test(mkt) || tstr === "moneyline" || tstr === "ml";
        const isSpread    = /spread/.test(mkt) || tstr === "spread";

        if ((isMoneyline || isSpread) && (hDelta !== 0 || aDelta !== 0)) {
          const teamCode = getTeamCodeFromRaw(raw, home, away);
          if (teamCode) {
            const isHomeTeam = teamCode === H;
            const teamPoints = isHomeTeam ? hDelta : aDelta;
            const oppPoints  = isHomeTeam ? aDelta : hDelta;
      
            if (teamPoints > 0) { pulse = "pos"; posCount++; }
            else if (oppPoints > 0) { pulse = "neg"; negCount++; }
          }
        }

        // ---------------- Player TD markets (first / anytime / N+), keep your logic but add pulse
        const isTdMarket =
          mkt.includes("td") || tstr === "td" || /(touchdown)/.test(tstr);
        if (isTdMarket) {
          const p = getPlayerFromRaw(raw);
          const thRaw  = String(raw.threshold ?? "").toLowerCase();
          const isFirst = thRaw === "first" || thRaw === "1st";
          const need = isFirst ? 1 : (parseInt(thRaw.replace(/[^\d]/g, ""), 10) || 1);
          const prevHits = Number.isFinite(c.hits) ? c.hits : 0;

          const scoredNow = didThisPlayScoreFor(p, current);

          if (isFirst) {
            const isTDNow = /\btouchdown\b/i.test(String(current?.detail || ""));
            const tdOccurredEarlier = enriched.slice(0, i).some(ply => /\btouchdown\b/i.test(String(ply.detail || "")));

            if (status == null && (isTDNow || tdOccurredEarlier)) {
              if (!tdOccurredEarlier && isTDNow) {
                if (scoredNow) { pulse = "pos"; status = "won"; posCount++; }
                else           { pulse = "neg"; status = "lost"; negCount++; }
              } else if (tdOccurredEarlier && !isTDNow) {
                const firstTDPlay = enriched.find(ply => /\btouchdown\b/i.test(String(ply.detail || "")));
                const our = didThisPlayScoreFor(p, firstTDPlay);
                status = our ? "won" : "lost";
              }
            }
          } else {
            if (scoredNow) {
              const hits = prevHits + 1;
              c = { ...c, hits };
              pulse = "pos"; posCount++;
              if (hits >= need && status !== "won") status = "won";
            }
          }
        }
        console.log((pulse === "pos" || pulse === "neg"));
        setAuto(!(pulse === "pos" || pulse === "neg"));

        return { ...c, progress, pulse, status };
      })
    );

    // field flash once per play
    const net = posCount > negCount ? "pos" : negCount > posCount ? "neg" : null;
    if (net) {
      setImpactFlash(net);
      const t = setTimeout(() => setImpactFlash(null), 420);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.idx, i]);

  // Pause autoplay whenever any bet pulses, then clear the pulse after ~0.5s
  useEffect(() => {
    const hasPulse = betUI.some(b => b.pulse === "pos" || b.pulse === "neg");
    if (!hasPulse) return;

    // stop autoplay on any pulse (your requirement)
    setAuto(false);

    // clear pulses after the visual flash
    const t = setTimeout(() => {
      setBetUI(prev => prev.map(b => (b.pulse ? { ...b, pulse: null } : b)));
    }, 550);
    return () => clearTimeout(t);
  }, [betUI]);

  // ------------------------------------------------------------------------------------------

  /** ---------------- Field width ---------------- */
  const fieldContainerRef = useRef(null);
  const [fieldWidth, setFieldWidth] = useState(980);
  useEffect(() => {
    const el = fieldContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFieldWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    setFieldWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  if (!enriched.length) return <div style={wrap}>No play-by-play available.</div>;

  const downLabel = !current?.down || !current?.yds_to_go ? "—" : `${current.down}${ordinalSuffix(current.down)} & ${current.yds_to_go}`;
  const ballLabel = current?.location || "—";
  const clockLabel = [current?.quarter ? `Q${current.quarter}` : "", current?.qtr_time_remain || ""].filter(Boolean).join("  •  ");

  return (
    <div style={wrap}>
      {/* Score Bug */}
      <div style={{ ...bugWrap, width: fieldWidth }}>
        <ScoreBug
          away={away}
          home={home}
          score={score}
          clock={clockLabel}
          downAndDist={downLabel}
          possession={current?.posTeam || prevSnap?.posTeam || inferOffense(prevSnap, isHomeSide, H, A)}
        />
      </div>
      
      {/* Field */}
      <div ref={fieldContainerRef} style={{ ...fieldWrap }}>
        {/* NEW: impact flash overlay */}
        {impactFlash && (
          <div
            key={`impact-${i}`}
            style={{
              position: "absolute",
              inset: 0,
              background: impactFlash === "pos" ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
              boxShadow: impactFlash === "pos"
                ? "inset 0 0 0 2px rgba(34,197,94,0.35)"
                : "inset 0 0 0 2px rgba(239,68,68,0.35)",
              pointerEvents: "none",
              opacity: 1,
              transition: "opacity 420ms ease"
            }}
          />
        )}

        <Field
          homeLogo={home.logo}
          awayLogo={away.logo}
          homeLeft={renderHomeLeft}
          startX={startX}
          resultX={resultX}
          resultEndzoneSide={resultEndzoneSide}
          snapStartX={renderLosPrev}
          firstDownX={firstDownX}
          animateKey={`${startX}-${resultX}-${i}`}
          driveDir={driveDirForField}
        />
      </div>

      {/* Play text */}
      <div style={playText}>{current?.detail || "—"}</div>

      {/* Controls */}
      <div style={controls}>
        <div style={toggleWrap}>
          <button
            type="button"
            onClick={() => setAuto(a => !a)}
            aria-pressed={auto}
            aria-label={auto ? "Pause autoplay" : "Start autoplay"}
            title={auto ? "Pause autoplay" : "Start autoplay"}
            style={{ ...circleBtn, ...(auto ? circleBtnOn : circleBtnOff) }}
          >
            {auto ? <IconPause /> : <IconPlay />}
          </button>
        </div>
      </div>

      {/* Bet Slip */}
      <BetSlip components={betUI} />
    </div>
  );
}

/* =============================================================================
 *  UI SUBCOMPONENTS
 * ============================================================================= */

function ScoreBug({ away, home, score, clock, downAndDist, possession }) {
  const possHome = possession && (possession.toUpperCase?.() === (home.code || "").toUpperCase());
  const possAway = possession && (possession.toUpperCase?.() === (away.code || "").toUpperCase());

  return (
    <div
      style={{
        ...bug,
        gridTemplateColumns: "max-content minmax(96px, 1fr) max-content",
      }}
    >
      <div style={{ ...bugTeam }}>
        <img src={away.logo} alt={away.name} style={{ ...bugLogo, marginRight: 8 }} />
        <div style={bugCode}>{(away.code || away.name || "AWY").toUpperCase().slice(0,3)}</div>
        <PossDot active={!!possAway} />
        <div style={bugScore}>{score.away}</div>
      </div>

      <div style={bugCenter}>
        <div style={bugCenterRowTop}><span style={bugClock}>{clock || "—"}</span></div>
        <div style={bugCenterRowBot}><span style={bugDn}>{downAndDist || "—"}</span></div>
      </div>

      <div style={{ ...bugTeam, justifyContent: "end" }}>
        <div style={bugScore}>{score.home}</div>
        <PossDot active={!!possHome} right />
        <div style={bugCode}>{(home.code || home.name || "HME").toUpperCase().slice(0,3)}</div>
        <img src={home.logo} alt={home.name} style={{ ...bugLogo, marginLeft: 8 }} />
      </div>
    </div>
  );
}

function PossDot({ active, right }) {
  return (
    <div
      aria-label="possession"
      style={{
        width: 10, height: 10, borderRadius: 6,
        marginLeft: right ? 8 : 0, marginRight: right ? 0 : 8,
        background: active ? "radial-gradient(circle at 30% 30%, #fff, #ffe066)" : "transparent",
        boxShadow: active ? "0 0 12px rgba(255,224,102,0.9)" : "none",
        transition: "all 240ms ease"
      }}
    />
  );
}

/* ---------- Status/pulse dot ---------- */
function BetStatusDot({ status }) {
  // Only show color for final outcomes
  const good = status === "won";
  const bad  = status === "lost";

  const fill   = good ? "#22c55e" : bad ? "#ef4444" : "transparent";
  const border = good ? "#166534" : bad ? "#7f1d1d" : "#2a563c";
  const glow   = good ? "0 0 8px rgba(34,197,94,.75)" : bad ? "0 0 8px rgba(239,68,68,.75)" : "none";

  return (
    <span
      aria-label={good ? "bet won" : bad ? "bet lost" : "in progress"}
      style={{
        display: "inline-block",
        width: 14, height: 14, minWidth: 14,
        borderRadius: 9,
        border: `2px solid ${border}`,
        background: fill,
        boxShadow: glow,
        transition: "all 180ms ease",
        marginRight: 8
      }}
    />
  );
}


/* ===== Helpers reused from your graded sheet (adapted) ===== */
const OUMap = { O: "Over", U: "Under" };
const clampPct = (v) => Math.max(0, Math.min(100, v));

const isProgressFlag = (v) => String(v || "").toLowerCase() === "progress";

function deriveProgress(b) {
  // Works with your betUI items
  // try explicit numeric first
  let current = Number.isFinite(Number(b.actual))
    ? Number(b.actual)
    : toNum(b.progress ?? b.currentValue ?? b.currentvalue);
  let target  = toNum(b.threshold ?? b.raw?.threshold ?? "");

  // last-resort parse from reason text (if present)
  if ((!Number.isFinite(current) || current === 0) || !Number.isFinite(target)) {
    const t = String(b.reason || "");
    const m = t.match(/(\d+(?:\.\d+)?)\s*[><=]\s*(\d+(?:\.\d+)?)/) || t.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const got = toNum(m[1]);
      const th  = toNum(m[2]);
      if (!Number.isFinite(current)) current = got;
      if (!Number.isFinite(target))  target  = th;
    }
  }

  return {
    current: Number.isFinite(current) ? current : 0,
    target:  Number.isFinite(target)  ? target  : 0,
  };
}

function createHeader(b) {
  const market = (b.market ?? b.raw?.market ?? "").toString().toLowerCase();
  const type   = (b.type   ?? b.raw?.type   ?? "").toString().toLowerCase();
  const sel    = b.selection ?? b.raw?.selection ?? "";
  const details= (b.details ?? b.raw?.details ?? "").toString().toUpperCase();
  const threshold = b.threshold ?? b.raw?.threshold ?? "";
  const displayText = b.displayText ?? b.raw?.displayText ?? "";

  if (market === "player" && type.includes("yds")) {
    return `${sel} ${OUMap[details] ?? details} ${threshold} ${displayText}`.trim();
  } else if (market === "player" && type.includes("td")) {
    return `${sel} ${displayText}`.trim();
  } else if (market === "game") {
    const capSel = sel ? sel.charAt(0).toUpperCase() + sel.slice(1) : "";
    return `${capSel} ${threshold} ${displayText}`.trim();
  }
  // fallback
  return `${sel || market || "Bet"}`.trim();
}

/* ===== New BetSlip (graded style, circle status) ===== */
function BetSlip({ components = [] }) {
  const items = components;

  return (
    <div style={slipPanel}>
      <div style={slipHeader}>
        <span>Bet Slip</span>
        <span style={{ color: "#9dc5a8", fontWeight: 700 }}>
          {items.length} {items.length === 1 ? "bet" : "bets"}
        </span>
      </div>

      {items.length === 0 ? (
        <div style={slipEmpty} aria-label="no-bets">No bets selected.</div>
      ) : (
        <div style={slipList}>
          {items.map((b) => {
            // header text
            const headerText = createHeader(b);

            // progress decision (like graded page)
            const typeStr = (b.type || b.raw?.type || "").toString().toLowerCase();
            const showProgress =
              isProgressFlag(b.display) ||
              isProgressFlag(b.raw?.display) ||
              ["pass_yds", "rec_yds", "rush_yds"].includes(typeStr);

            const { current, target } = showProgress ? deriveProgress(b) : { current: 0, target: 0 };
            const pct = target > 0 ? clampPct((current / target) * 100) : 0;

            const status = b.status ?? null; // "won" | "lost" | null
            const oddsText = (b.price ?? b.raw?.price ?? "").toString();

            // Fill color aligns with result when locked
            const resultKey = String(status || "pending").toLowerCase();
            const fillBg =
              resultKey === "won"
                ? "linear-gradient(90deg, #22c55e, #4ade80)"
                : resultKey === "lost"
                ? "linear-gradient(90deg, #ef4444, #dc2626)"
                : progressFillViz.background;

            return (
              <div
                key={b.id || `${b.market}:${b.type}:${b.selection}`}
                style={{
                  ...card,
                  ...(b.pulse === "pos" ? pulseGreen
                    : b.pulse === "neg" ? pulseRed
                    : {
                        // explicitly restore defaults so no inline style lingers
                        borderColor: CARD_BORDER,
                        boxShadow: "none",
                        background: card.background,
                      }),
                }}
              >
                <div style={rowTop}>
                  {/* status circle stays status-only */}
                  <BetStatusDot status={b.status} />
                  <div style={title} title={headerText}>{headerText}</div>
                  <div style={oddsRight}>{oddsText}</div>
                </div>

                {showProgress && (
                  <div
                    style={progressWrapViz}
                    role="progressbar"
                    aria-valuenow={current}
                    aria-valuemin={0}
                    aria-valuemax={target || 0}
                  >
                    <div style={{ ...progressFillViz, width: `${pct}%`, background: fillBg }} />
                    <div style={progressLabelViz}>
                      {displayNum(current)}{Number.isFinite(target) && target > 0 ? ` / ${displayNum(target)}` : ""}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  homeLogo,
  awayLogo,
  homeLeft,
  startX = 50,
  resultX = 50,
  resultEndzoneSide = null,
  snapStartX = 50,
  firstDownX = null,
  animateKey = "0",
  driveDir = 0,
}) {
  const w = 880;
  const h = 180;
  const padX = 24;
  const fieldTop = 30;
  const fieldBottom = h - 30;

  const totalInnerWidth = w - padX * 2;
  const ezWidth = totalInnerWidth * 0.10;
  const playableLeft  = padX + ezWidth;
  const playableRight = w - padX - ezWidth;
  const playableWidth = playableRight - playableLeft;

  const yardToX = (pct) => playableLeft + (clamp01(pct) / 100) * playableWidth;

  const leftEzX  = padX;
  const rightEzX = w - padX - ezWidth;
  const midY = (fieldTop + fieldBottom) / 2;

  const leftEzCenter  = leftEzX  + ezWidth / 2;
  const rightEzCenter = rightEzX + ezWidth / 2;

  const resultPx = yardToX(resultX);
  const startPx  = yardToX(startX);
  const losPx    = yardToX(snapStartX);
  const firstPx  = Number.isFinite(firstDownX) ? yardToX(firstDownX) : null;

  const resultTranslateX = resultEndzoneSide === "left"
    ? leftEzCenter
    : resultEndzoneSide === "right"
    ? rightEzCenter
    : resultPx;

  const lineRef = useRef(null);
  const [dash, setDash] = useState({ array: 0, offset: 0 });
  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    const x1 = startPx, x2 = resultTranslateX;
    const length = Math.abs(x2 - x1);
    setDash({ array: length, offset: length });
    const t = requestAnimationFrame(() => setDash({ array: length, offset: 0 }));
    return () => cancelAnimationFrame(t);
  }, [animateKey, startPx, resultTranslateX]);

  function trianglePoints(cx, cy, dir) {
    const L = 12.5;   // length along drive direction
    const H = 17.5;   // base height (thickness)
    const halfL = L / 2;
    const halfH = H / 2;
  
    if (dir >= 0) {
      // pointing right
      const apexX = cx + halfL, baseX = cx - halfL;
      return `${apexX},${cy} ${baseX},${cy - halfH} ${baseX},${cy + halfH}`;
    } else {
      // pointing left
      const apexX = cx - halfL, baseX = cx + halfL;
      return `${apexX},${cy} ${baseX},${cy - halfH} ${baseX},${cy + halfH}`;
    }
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="auto" style={fieldSvg}>
      <defs>
        <pattern id="turf" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#0a3a1a"/>
          <rect width="14" height="7" fill="#0d4a21"/>
        </pattern>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.2" result="b"/>
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* End zones */}
      <rect x={leftEzX} y={fieldTop} width={ezWidth} height={fieldBottom - fieldTop} fill="#093015" />
      <rect x={playableLeft} y={fieldTop} width={playableWidth} height={fieldBottom - fieldTop} fill="url(#turf)" stroke="#2a5b38" strokeWidth="2" />
      <rect x={rightEzX} y={fieldTop} width={ezWidth} height={fieldBottom - fieldTop} fill="#093015" />

      {/* Yard lines */}
      {Array.from({ length: 11 }).map((_, idx) => {
        const pct = idx * 10;
        const x = playableLeft + (pct / 100) * playableWidth;
        return (
          <g key={pct}>
            <line x1={x} y1={fieldTop} x2={x} y2={fieldBottom} stroke="#1e4a2a" strokeWidth={idx % 5 === 0 ? 2 : 1} />
            {idx > 0 && idx < 10 && (
              <text x={x} y={fieldTop - 6} fill="#e6ffe9" fontSize="11" textAnchor="middle" opacity="0.8">{pct}</text>
            )}
          </g>
        );
      })}

      {/* Lines */}
      {Number.isFinite(firstPx) && (
        <line x1={firstPx} y1={fieldTop} x2={firstPx} y2={fieldBottom} stroke={palette.accent} strokeWidth="3" strokeDasharray="6 4" opacity="0.95" />
      )}
      <line x1={losPx} y1={fieldTop} x2={losPx} y2={fieldBottom} stroke="#eaf7ef" strokeOpacity="0.25" strokeWidth="2" />

      {/* Drive path */}
      <line
        ref={lineRef}
        x1={startPx} y1={midY} x2={resultTranslateX} y2={midY}
        stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.9" filter="url(#glow)"
        style={{ transition: "stroke-dashoffset 500ms ease", strokeDasharray: dash.array, strokeDashoffset: dash.offset }}
      />
      <line x1={startPx} y1={midY} x2={resultTranslateX} y2={midY} stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.95" />

      {/* Drive start arrow */}
      <polygon points={trianglePoints(startPx, midY, driveDir || 1)} fill="#ef4444" strokeWidth="2" opacity="0.95" />

      {/* Result dot */}
      <g transform={`translate(${resultTranslateX}, ${midY})`} style={{ transition: "transform 420ms ease" }}>
        <circle r="11" fill="#ffffff" stroke="#111" strokeWidth="2" />
      </g>
    </svg>
  );
}

function IconPlay({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <polygon points="8,5 19,12 8,19" />
    </svg>
  );
}

function IconPause({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

/* ============================= Styles ============================= */
const wrap = surfaces.panel(980);
const bugWrap = { margin: "0 auto 10px" };

const bug = {
  display: "grid",
  gridTemplateColumns: "max-content minmax(96px, 1fr) max-content",
  gap: 0,
  background: "linear-gradient(180deg, rgba(14,40,24,.75), rgba(14,40,24,.65))",
  border: "1px solid #28553b",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 6px 16px rgba(0,0,0,.25)",
};
const bugTeam = {
  display: "grid",
  gridAutoFlow: "column",
  alignItems: "center",
  justifyContent: "start",
  gap: 8,
  padding: "8px 12px",
  background: "rgba(8,25,16,0.55)",
  whiteSpace: "nowrap",
  maxWidth: "max-content",
};
const bugLogo = { width: 36, height: 36, objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" };
const bugCode = { fontSize: 16, fontWeight: 900, color: "#eaf7ef", letterSpacing: 0.8, lineHeight: 1 };
const bugScore = { fontWeight: 900, fontSize: 22, color: "#ffffff", padding: "2px 8px", borderRadius: 8, background: "rgba(255,255,255,0.08)", minWidth: 34, textAlign: "center" };
const bugCenter = {
  display: "grid", gridTemplateRows: "1fr 1fr", alignItems: "center", justifyItems: "center",
  background: "linear-gradient(180deg, rgba(22,60,38,.75), rgba(22,60,38,.55))",
  borderLeft: "1px solid #2a563c", borderRight: "1px solid #2a563c",
  padding: "6px 8px", minWidth: 0,
};
const bugCenterRowTop = { display: "flex", alignItems: "center", gap: 8 };
const bugCenterRowBot = { display: "flex", alignItems: "center", gap: 8 };
const bugClock = { fontWeight: 900, fontSize: "clamp(11px, 1.8vw, 14px)", letterSpacing: 0.6, color: "#fff" };
const bugDn    = { fontWeight: 800, fontSize: "clamp(10px, 1.6vw, 13px)", color: palette.accent };

const fieldWrap = { background: "#0b2617", border: `1px solid ${palette.borderField}`, borderRadius: 10, padding: 8, marginBottom: 10, position: "relative", overflow: "hidden" };
const fieldSvg = { display: "block", width: "100%" };

const playText = {
  background: palette.panelBgAlt,
  border: `1px solid ${palette.borderAlt}`,
  borderRadius: 10,
  padding: "10px 12px",
  color: palette.text,
  lineHeight: 1.35,
  marginTop: 6, marginBottom: 12
};

const controls = { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 10 };

const toggleWrap = { display: "flex", alignItems: "center", gap: 8, marginLeft: 16 };

const circleBtn = {
  width: 40,
  height: 40,
  borderRadius: 9999,
  display: "grid",
  placeItems: "center",
  border: "1px solid #2d7a4a",
  color: "#eaf7ef",
  cursor: "pointer",
  transition: "transform 120ms ease, background 120ms ease, box-shadow 120ms ease"
};
const circleBtnOn = {
  background: "linear-gradient(180deg, rgba(26,90,51,.9), rgba(26,90,51,.7))",
  boxShadow: "0 0 0 2px rgba(45,122,74,.35) inset, 0 4px 12px rgba(0,0,0,.35)"
};
const circleBtnOff = {
  background: "linear-gradient(180deg, rgba(10,22,16,.7), rgba(10,22,16,.55))",
  boxShadow: "inset 0 0 0 1px rgba(42,86,60,.6)"
};
/* ===== Styles to mimic graded sheet ===== */
const slipPanel = {
  marginTop: 14,
  background: "rgba(15,47,28,0.85)",
  border: "1px solid #1f3d2a",
  borderRadius: 12,
  overflow: "hidden",
};
const slipHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  background: "linear-gradient(180deg, rgba(22,60,38,.75), rgba(22,60,38,.55))",
  borderBottom: "1px solid #2a563c",
  fontWeight: 800,
  color: "#eaf7ef",
};
const slipList = { display: "grid", gap: 10, padding: 12 };
const slipEmpty = { padding: 18, textAlign: "center", color: "#9dc5a8", borderTop: "1px solid #2a563c" };

const rowTop = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr max-content",
  alignItems: "center",
  gap: 10,
  marginBottom: 4,
};
const title = { fontWeight: 800, letterSpacing: 0.3, color: "#eaf7ef", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const oddsRight = { fontWeight: 900, letterSpacing: 0.3, fontSize: 14, color: "#eaf7ef" };

const progressWrapViz = {
  position: "relative",
  height: 26,
  borderRadius: 10,
  background: "rgba(234,247,239,0.08)",
  overflow: "hidden",
  border: "1px solid #2a563c",
  marginTop: 8,
};
const progressFillViz = {
  position: "absolute",
  inset: 0,
  width: "0%",
  background: "linear-gradient(90deg, rgba(55,220,0,1), rgba(78,255,30,1))",
  boxShadow: "inset 0 0 6px rgba(0,0,0,0.25)",
  transition: "width 300ms ease",
};
const progressLabelViz = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  color: "rgba(255,255,255)",
};

// 1) Put this near your styles
const CARD_BORDER = "#234a33";

// Replace your `card` style with explicit pieces (avoid the shorthand "border")
const card = {
    // <-- default outline color
  padding: "10px 12px",
};

// Optional: your pulse styles can stay as-is, but they only set borderColor/boxShadow/background
const pulseGreen = {
  boxShadow: "0 0 14px rgba(34,197,94,.55)",
  borderColor: "#1f7a45",
  background: "linear-gradient(180deg, rgba(22,60,38,.55), rgba(22,60,38,.35))",
  transition: "box-shadow 280ms ease, background 280ms ease, border-color 280ms ease",
};
const pulseRed = {
  boxShadow: "0 0 14px rgba(239,68,68,.55)",
  borderColor: "#7a1d1d",
  background: "linear-gradient(180deg, rgba(60,22,22,.45), rgba(60,22,22,.25))",
  transition: "box-shadow 280ms ease, background 280ms ease, border-color 280ms ease",
};
