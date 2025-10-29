// src/pages/GradedBetsPage.jsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { surfaces } from "../styles/theme";

const OUMap = { O: "Over", U: "Under" };

export default function GradedBetsPage() {
  const nav = useNavigate();
  const { state } = useLocation();
  const passed = state?.bets;

  const stored = React.useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem("gradedBets") || "[]"); }
    catch { return []; }
  }, []);

  // ---- localStorage-backed state for daily_parlay (so UI updates immediately) ----
  const [dailyParlay, setDailyParlay] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("daily_parlay") || "[]"); }
    catch { return []; }
  });

  const fallbackBets = Array.isArray(passed) ? passed : Array.isArray(stored) ? stored : [];
  const bets = Array.isArray(dailyParlay) && dailyParlay.length ? dailyParlay : fallbackBets;

  // ---- WRITE: when we have incoming graded bets, clear daily_parlay then set it to incoming ----
  // Only do this if the incoming set is non-empty.
  React.useEffect(() => {
    const incoming =
      (Array.isArray(passed) && passed.length ? passed :
       Array.isArray(stored) && stored.length ? stored : null);

    if (incoming && incoming.length) {
      try {
        localStorage.removeItem("daily_parlay");                 // clear first
        localStorage.setItem("daily_parlay", JSON.stringify(incoming)); // then set
        setDailyParlay(incoming);                                // update state so UI reflects immediately
      } catch {}
    }
  }, [passed, stored]);

  // Keep UI in sync if daily_parlay changes in another tab
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "daily_parlay") {
        try { setDailyParlay(JSON.parse(e.newValue || "[]")); } catch { setDailyParlay([]); }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ----- compute current parlay DECIMAL product (won legs only) -----
  const { currentProductDec, wonCount, lostCount } = React.useMemo(() => {
    const wins = (bets || []).filter(b => String(b.result || "").toLowerCase() === "won");
    const losses = (bets || []).filter(b => String(b.result || "").toLowerCase() === "lost");
    let product = 1;
    for (const w of wins) {
      const dec = extractDecimalOdds(w);
      if (Number.isFinite(dec) && dec > 0) product *= dec;
    }
    if (wins.length === 0 || (product === 1 && !wins.some(w => Number.isFinite(extractDecimalOdds(w))))) {
      product = NaN;
    }
    return { currentProductDec: product, wonCount: wins.length, lostCount: losses.length };
  }, [bets]);

  // ----- read stored stats from localStorage -----
  const bestEverDec = useNumberFromLS("best_odds_ever", 0);
  const betStreak   = useNumberFromLS("bet_streak", 0);
  const legsHit     = useNumberFromLS("bet_legs_hit", 0);
  const legsMissed  = useNumberFromLS("bet_legs_missed", 0);

  const isCurrentHighest =
    Number.isFinite(currentProductDec) && currentProductDec >= (bestEverDec || 0) && wonCount > 0;

  // fire confetti once when this becomes true
  React.useEffect(() => {
    if (isCurrentHighest) {
      const end = Date.now() + 2000;
      const id = setInterval(() => makeConfettiBurst(), 180);
      const killer = setTimeout(() => clearInterval(id), end - Date.now());
      return () => { clearInterval(id); clearTimeout(killer); };
    }
  }, [isCurrentHighest]);

  // ---------- SHARE BUTTON HANDLER ----------
  const onShare = React.useCallback(async () => {
    try {
      // Parlay moneyline odds header
      const { p, legs } = combineParlayProb(bets);
      let parlayML = probToAmerican(p);

      // Fallback: build from per-leg decimal odds product if probability missing
      if (!parlayML) {
        let decProduct = 1;
        let anyDec = false;
        for (const b of bets) {
          const d = extractDecimalOdds(b);
          if (Number.isFinite(d) && d > 1) { decProduct *= d; anyDec = true; }
        }
        if (anyDec) parlayML = toAmericanFromDecimal(decProduct) || null;
      }
      if (!parlayML) parlayML = "—";

      // Lines for each leg: emoji + header + moneyline
      const lines = bets.map((b) => {
        const won = String(b.result || "").toLowerCase() === "won";
        const symbol = won ? "🟢" : "🔴";
        // try to read an American line directly; otherwise derive from prob/decimal
        let ml = null;
        const tryCands = [b?.price, b?.bet?.price, b?.raw?.price, b?.raw?.odds, b?.labelBottom, b?.display];
        for (const c of tryCands) {
          if (ml) break;
          if (c != null) {
            const s = String(c).trim();
            const m = s.match(/^[+\-]?\d+/);
            if (m) {
              const n = Number(m[0]);
              if (Number.isFinite(n) && n !== 0) ml = n > 0 ? `+${n}` : `${n}`;
            }
          }
        }
        if (!ml) {
          const prob = getProbFromBet(b);
          if (Number.isFinite(prob)) ml = probToAmerican(prob);
        }
        if (!ml) {
          const d = extractDecimalOdds(b);
          if (Number.isFinite(d) && d > 1) ml = toAmericanFromDecimal(d);
        }
        if (!ml) ml = "—";

        return `${symbol} ${CreateHeader(b)}  ${ml}`;
      });

      const header = `${bets.length} LEG PARLAY    ${parlayML}`;
      const text = [header, ...lines].join("\n");

      if (navigator.share && /Mobi|Android|iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        alert("Parlay summary copied to clipboard!");
      }
    } catch (e) {
      console.error(e);
      alert("Sorry—couldn't share. Try copying manually.");
    }
  }, [bets]);

  return (
    <div style={page}>
      <div style={panel}>
        <header style={header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {(() => {
              // Header uses bets from daily_parlay (via `bets`)
              const { p, legs } = combineParlayProb(bets);
              const ml = probToAmerican(p) ?? "—";
              return (
                <>
                  <h1 style={{ margin: 0, fontSize: 18 }}>
                    {legs} LEG LEG PARLAY&nbsp;&nbsp;&nbsp;
                    <span style={{
                      color: "#ffe066",
                      textShadow: "0 0 10px rgba(255,224,102,0.45)"
                    }}>{ml}</span>
                  </h1>
                </>
              );
            })()}
          </div>

          {/* RIGHT: Parlay result */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ResultTag result={parlayResult(bets)} />
          </div>
        </header>

        {bets.length === 0 ? (
          <div style={empty}>No graded bets found.</div>
        ) : (
          <div style={list}>
            {/* The bet slip renders from daily_parlay-loaded `bets` */}
            {bets.map((b) => {
              const typeStr = (b.type || b.bet?.type || "").toString().toLowerCase();

              const showProgress =
                isProgressFlag(b.display) ||
                isProgressFlag(b.bet?.display) ||
                ["pass_yds", "rec_yds", "rush_yds"].includes(typeStr);

              const { current, target } = showProgress ? deriveProgress(b) : { current: 0, target: 0 };
              const pct = target > 0 ? clamp((current / target) * 100, 0, 100) : 0;

              const resultKey = String(b.result || "pending").toLowerCase();
              const fillBg =
                resultKey === "won"
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : resultKey === "lost"
                  ? "linear-gradient(90deg, #ef4444, #dc2626)"
                  : progressFill.background;

              const oddsText = (b.price ?? "").toString();

              return (
                <div key={b.id || `${b.market}:${b.type}:${b.selection}`} style={card}>
                  <div style={rowTop}>
                    <div style={rowLeft}>
                      <BetStatusDot status={String(b.result || "pending").toLowerCase()} />
                    </div>
                    <div style={title}>
                      <span>{CreateHeader(b)}</span>
                    </div>
                    <div style={rowRight}>
                      {oddsText && <strong style={oddsRight}>{oddsText}</strong>}
                    </div>
                  </div>

                  {showProgress && (
                    <div
                      style={progressWrap}
                      role="progressbar"
                      aria-valuenow={current}
                      aria-valuemin={0}
                      aria-valuemax={target || 0}
                    >
                      <div style={{ ...progressFill, width: `${pct}%`, background: fillBg }} />
                      <div style={progressLabel}>
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

      {/* ======== STATS / HISTORY SECTION (under slip) ======== */}
      <StatsPanel
        currentProductDec={currentProductDec}
        bestEverDec={bestEverDec}
        isCurrentHighest={isCurrentHighest}
        betStreak={betStreak}
        legsHit={legsHit}
        legsMissed={legsMissed}
      />

      {/* SHARE button */}
      <button style={btn} onClick={onShare}>Share Result</button>

      {/* confetti container */}
      <div id="confetti-root" style={confettiRoot} />
    </div>
  );
}

/* ===================== Stats Panel ===================== */

function StatsPanel({
  currentProductDec,
  bestEverDec,
  isCurrentHighest,
  betStreak,
  legsHit,
  legsMissed
}) {
  const hasBest = Number.isFinite(bestEverDec) && bestEverDec > 1;
  const decToShow = hasBest
    ? bestEverDec
    : (Number.isFinite(currentProductDec) && currentProductDec > 1 ? currentProductDec : NaN);

  const showingAnything = Number.isFinite(decToShow) && decToShow > 1;
  const american = showingAnything ? toAmericanFromDecimal(decToShow) : null;

  const emphasize = Boolean(isCurrentHighest && showingAnything);

  const streak = Number(betStreak) || 0;
  const streakColor = streak > 1 ? "#22c55e" : streak === 0 ? "#ef4444" : "#ffffff";

  const totalLegSamples = Math.max(0, Number(legsHit) + Number(legsMissed));
  const legLine = `${Number(legsHit)} / ${totalLegSamples}`;

  return (
    <section style={statsWrap}>
      <h2 style={statsHeader}>Player Stats &amp; History</h2>

      <div style={statsCard}>
        <div style={statsSubheader}>Top Payout</div>

        {!showingAnything ? (
          <div style={statsEmpty}>No payout data yet.</div>
        ) : (
          <div style={singleRow}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontWeight: emphasize ? 900 : 800,
                  color: emphasize ? "#ffe066" : "#eaf7ef",
                  textShadow: emphasize ? "0 0 12px rgba(255,224,102,0.55)" : "none"
                }}
              >
                {emphasize ? "This Parlay (NEW TOP!)" : "Best Ever"}
              </span>
            </div>

            {/* MONEYLINE ONLY */}
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 0.3,
                fontSize: 18,
                fontWeight: emphasize ? 900 : 800,
                color: emphasize ? "#ffe066" : "#a2ff00",
                textShadow: emphasize ? "0 0 10px rgba(255,224,102,0.45)" : "none"
              }}
              aria-label="Top payout moneyline"
            >
              {american || "—"}
            </span>
          </div>
        )}

        <div style={divider} />

        <div style={metricRow}>
          <div style={metricLabel}>Bet Streak</div>
          <div style={{ ...metricValue, color: streakColor }}>{streak}</div>
        </div>

        <div style={metricRow}>
          <div style={metricLabel}>Legs Hit</div>
          <div style={metricValue}>{legLine}</div>
        </div>
      </div>
    </section>
  );
}

/* ===================== Helpers (already in your file) ===================== */

function useNumberFromLS(key, fallback = 0) {
  const [val, setVal] = React.useState(() => {
    try {
      const v = localStorage.getItem(key);
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch { return fallback; }
  });
  React.useEffect(() => {
    const onStorage = (e) => {
      if (e.key === key) {
        const n = Number(e.newValue);
        setVal(Number.isFinite(n) ? n : fallback);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, fallback]);
  return val;
}

function ResultTag({ result }) {
  const r = String(result || "pending").toLowerCase();
  const styles = {
    won:     { background: "rgba(0, 255, 0, 0.35)", color: "#a2ff00", border: "2.5px solid #a2ff00" },
    lost:    { background: "rgba(255, 0, 0, 0.35)", color: "#ff6060", border: "2.5px solid #ff6060" },
    push:    { background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" },
    pending: { background: "#0f172a", color: "#c7d2fe", border: "1px solid #334155" },
  }[r] || { background: "#0f172a", color: "#c7d2fe", border: "1px solid #334155" };

  return <span style={{ ...tag, ...styles }}>{r.toUpperCase()}</span>;
}

// prefer American odds strings like "+120", "-110"...
function extractDecimalOdds(bet) {
  const cands = [
    bet?.price, bet?.bet?.price, bet?.labelBottom, bet?.display,
    bet?.raw?.price, bet?.raw?.odds, bet?.odds, bet?.bet?.odds
  ].filter(v => v != null);
  for (const c of cands) {
    const dec = americanToDecimal(c);
    if (Number.isFinite(dec) && dec > 0) return dec;
  }
  const p = Number(bet?.odds ?? bet?.bet?.odds);
  if (Number.isFinite(p) && p > 0 && p < 1) return 1 / p;
  return NaN;
}

function americanToDecimal(oddsLike) {
  if (oddsLike == null) return NaN;
  const s = String(oddsLike).trim();
  const m = s.match(/^[+\-]?\d+/);
  if (!m) return NaN;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n === 0) return NaN;
  return n > 0 ? 1 + (n / 100) : 1 + (100 / Math.abs(n));
}

function toAmericanFromDecimal(dec) {
  if (!Number.isFinite(dec) || dec <= 1) return "";
  const profit = dec - 1;
  const am = profit >= 1 ? Math.round(profit * 100) : Math.round(-100 / profit);
  return am > 0 ? `+${am}` : `${am}`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toNum  = (v) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const displayNum = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
};

const isProgressFlag = (v) => String(v || "").toLowerCase() === "progress";

function deriveProgress(b) {
  let current = Number.isFinite(Number(b.actual)) ? Number(b.actual) : toNum(b.progress ?? b.currentValue ?? b.currentvalue);
  let target  = toNum(b.threshold ?? b.bet?.threshold ?? "");

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

function CreateHeader(bet){
  if (bet.market === "player" && bet.type.includes("yds")){
    return bet.selection + " " + OUMap[bet.details] + " " + bet.threshold + " " + bet.displayText;
  }
  else if (bet.market === "player" && bet.type.includes("td")){
    return bet.selection + " " + bet.displayText;
  }
  else if (bet.market === "game"){
    return capitalizeFirst(bet.selection) + " " + bet.threshold + " " + bet.displayText;
  }
  return "";
}

function capitalizeFirst(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function probToAmerican(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) return null;
  const odds = x >= 0.5
    ? -Math.round((x / (1 - x)) * 100)
    :  Math.round(((1 - x) / x) * 100);
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function getProbFromBet(b) {
  const x = Number(b?.odds ?? b?.bet?.odds);
  return Number.isFinite(x) && x > 0 && x < 1 ? x : NaN;
}

function combineParlayProb(bets) {
  if (!Array.isArray(bets) || bets.length === 0) return { p: NaN, legs: 0 };
  let p = 1;
  for (const b of bets) {
    const pb = getProbFromBet(b);
    if (!Number.isFinite(pb)) return { p: NaN, legs: 0 };
    p *= pb;
  }
  return { p, legs: bets.length };
}

function parlayResult(bets) {
  if (!Array.isArray(bets) || bets.length === 0) return "pending";
  const allWon = bets.every(b => String(b.result || "").toLowerCase() === "won");
  const anyLost = bets.some(b => String(b.result || "").toLowerCase() === "lost");
  if (allWon) return "won";
  if (anyLost) return "lost";
  return "pending";
}

function BetStatusDot({ status }) {
  const good = status === "won";
  const bad  = status === "lost";

  const fill   = good ? "#22c55e" : bad ? "#ef4444" : "transparent";
  const border = good ? "#166534" : bad ? "#7f1d1d" : "#2a563c";
  const glow   = good ? "0 0 8px rgba(34,197,94,.75)"
                      : bad ? "0 0 8px rgba(239,68,68,.75)"
                            : "none";

  return (
    <span
      style={{
        display: "inline-block",
        width: 14, height: 14, minWidth: 14,
        borderRadius: 9,
        border: `2px solid ${border}`,
        background: fill,
        boxShadow: glow,
        marginRight: 8,
        transition: "all 180ms ease",
      }}
    />
  );
}

/* ===================== mini confetti ===================== */
function makeConfettiBurst() {
  const root = document.getElementById("confetti-root");
  if (!root) return;
  for (let i = 0; i < 16; i++) {
    const el = document.createElement("div");
    const size = 6 + Math.random() * 6;
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = `${Math.random() * 100}%`;
    el.style.width = `${size}px`;
    el.style.height = `${size * (0.6 + Math.random() * 0.8)}px`;
    el.style.background = randomConfettiColor();
    el.style.opacity = "0.95";
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    el.style.borderRadius = "1px";
    el.style.pointerEvents = "none";
    el.style.filter = "drop-shadow(0 0 4px rgba(255,255,255,0.3))";

    const duration = 1200 + Math.random() * 800;
    el.animate(
      [
        { transform: `translateY(0) rotate(0deg)`, opacity: 0.95 },
        { transform: `translateY(${80 + Math.random() * 100}px) rotate(${120 + Math.random()*180}deg)`, opacity: 0 }
      ],
      { duration, easing: "cubic-bezier(.17,.67,.42,1)", fill: "forwards" }
    );
    root.appendChild(el);
    setTimeout(() => root.removeChild(el), duration + 60);
  }
}
function randomConfettiColor() {
  const palette = ["#ffe066","#a2ff00","#60a5fa","#f472b6","#facc15","#34d399","#f87171"];
  return palette[Math.floor(Math.random() * palette.length)];
}

/* ===================== styles ===================== */

const page = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "start center",
  background: "#061b10",
  padding: "32px 16px",
  color: "#eaf7ef",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
};

const panel = {
  width: "min(980px, 96vw)",
  background: "#191919",
  border: "1px solid #374151",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0,0,0,.3)"
};

const header = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  background: "#121212",
  borderBottom: "1px solid #374151",
  color: "#ff6060",
  fontSize: "large"
};

const list = { display: "grid", gap: 10, padding: 12 };

const empty = {
  padding: 18,
  textAlign: "center",
  color: "#9dc5a8",
  borderTop: "1px solid #2a563c"
};

const card = {
  borderRadius: 10,
  padding: "10px 12px"
};

const rowTop = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 4
};
const rowLeft = { display: "flex", alignItems: "center", gap: 8 };
const rowRight = { marginLeft: "auto", display: "flex", alignItems: "center" };
const oddsRight = { fontWeight: 900, letterSpacing: 0.3, fontSize: "medium", color: "#a2ff00" };

const title = { fontWeight: 800, letterSpacing: 0.3, display: "flex", flexWrap: "wrap", gap: 4, color: "#a2ff00", textTransform: "uppercase" };

const tag = {
  fontWeight: 900,
  padding: "4px 8px",
  borderRadius: 2.5,
  fontSize: "medium",
};

const progressWrap = {
  position: "relative",
  height: 26,
  borderRadius: 5,
  background: "rgba(234,247,239,0.08)",
  overflow: "hidden",
  border: "1px solid #2a563c",
  marginTop: 8
};
const progressFill = {
  position: "absolute",
  inset: 0,
  width: "0%",
  background: "linear-gradient(90deg, rgba(55,220,0,1), rgba(78,255,30,1))",
  boxShadow: "inset 0 0 6px rgba(0,0,0,0.25)",
  transition: "width 300ms ease"
};
const progressLabel = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: "medium",
  color: "rgba(255,255,255)"
};

// ---- Stats styles ----
const statsWrap = { width: "min(980px, 96vw)", marginTop: 14 };
const statsHeader = { margin: "10px 0 10px", fontSize: "large", color: "#9dc5a8", letterSpacing: 0.5 };
const statsCard = { borderRadius: 10, padding: 12 };
const statsSubheader = { color: "#a2ff00", fontWeight: 800, marginBottom: 8, letterSpacing: 0.4 };
const statsEmpty = { color: "#9dc5a8", opacity: 0.8 };
const divider = { height: 1, margin: "12px 0" };
const metricRow = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px" };
const metricLabel = { color: "#9dc5a8" };
const metricValue = { fontWeight: 900, color: "#eaf7ef" };

// confetti root
const confettiRoot = {
  position: "fixed",
  pointerEvents: "none",
  left: 0,
  right: 0,
  top: 0,
  height: "40vh",
  zIndex: 9999,
};

const singleRow = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  padding: "8px 10px",
  background: "rgba(0,0,0,0.25)",
  borderRadius: 8,
  border: "1px solid rgba(42,86,60,0.6)"
};

const btn = {
  background: "linear-gradient(to bottom, #ffcc00, #d4a017)",
  color: "rgba(255, 255, 255, 1)",
  border: "3px solid #111",
  borderRadius: "10px",
  padding: "12px 28px",
  fontSize: "medium",
  cursor: "pointer",
  boxShadow: "0 4px 0 #000, 0 6px 14px rgba(0,0,0,0.6)",
  transition: "transform 0.15s, box-shadow 0.15s, opacity 0.15s, filter 0.15s"
};
