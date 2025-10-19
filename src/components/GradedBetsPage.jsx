import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { surfaces } from "../styles/theme";

const OUMap = {
  "O": "Over",
  "U": "Under"
};
/**
 * Displays a bet slip of graded bets.
 * Reads from router state first; falls back to sessionStorage ("gradedBets").
 */
export default function GradedBetsPage() {
  const nav = useNavigate();
  const { state } = useLocation();
  const passed = state?.bets;
  const stored = React.useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem("gradedBets") || "[]"); }
    catch { return []; }
  }, []);
  const bets = Array.isArray(passed) ? passed : Array.isArray(stored) ? stored : [];

  return (
    <div style={page}>
      <div style={panel}>
      <header style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {(() => {
            const { p, legs } = combineParlayProb(bets);
            const ml = probToAmerican(p) ?? "—";

            return (
              <>
                <h1 style={{ margin: 0, fontSize: 18 }}>
                  {legs} LEG PARLAY&emsp;<span style={{ color: "#ffe066" }}>{ml}</span>
                </h1>

              </>
            ); x
          })()}
        </div>

        {/* RIGHT: Back button */}
        <div style={{ display: "flex", gap: 8 }}>
          <ResultTag result={parlayResult(bets)} />
        </div>
      </header>
        {bets.length === 0 ? (
          <div style={empty}>No graded bets found.</div>
        ) : (
          <div style={list}>
            {bets.map((b) => {
              const typeStr = (b.type || b.bet?.type || "").toString().toLowerCase();
              const thresholdLabel = b.threshold ?? b.bet?.threshold ?? "";

              // show when display flag is on EITHER level, or when it's a yards prop
              const showProgress =
                isProgressFlag(b.display) ||
                isProgressFlag(b.bet?.display) ||
                ["pass_yds", "rec_yds", "rush_yds"].includes(typeStr);

              // derive achieved yards + target (uses your existing helpers)
              const { current, target } = showProgress ? deriveProgress(b) : { current: 0, target: 0 };
              const pct = target > 0 ? clamp((current / target) * 100, 0, 100) : 0;

              const resultKey = String(b.result || "pending").toLowerCase();
              const fillBg =
                resultKey === "won"
                  ? "linear-gradient(90deg, #22c55e, #4ade80)" // green
                  : resultKey === "lost"
                  ? "linear-gradient(90deg, #ef4444, #dc2626)" // red
                  : progressFill.background;                   // default

              const oddsText = (b.price ?? "").toString();

              return (
                <div key={b.id || `${b.market}:${b.type}:${b.selection}`} style={card}>
                  {/* Top row: LEFT = result tag, RIGHT = bold odds */}
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
      <button style={btn} onClick={() => nav("/")}>Return to home</button>
    </div>
  );
}

/* ---------- small bits ---------- */

function ResultTag({ result }) {
  const r = String(result || "pending").toLowerCase();
  const styles = {
    won:   { background: "#14532d", color: "#bbf7d0", border: "1px solid #166534" },
    lost:  { background: "#7f1d1d", color: "#fecaca", border: "1px solid #991b1b" },
    push:  { background: "#1f2937", color: "#e5e7eb", border: "1px solid #374151" },
    pending: { background: "#0f172a", color: "#c7d2fe", border: "1px solid #334155" }
  }[r] || { background: "#0f172a", color: "#c7d2fe", border: "1px solid #334155" };
  return <span style={{ ...tag, ...styles }}>{r.toUpperCase()}</span>;
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
  // inside your deriveProgress(b)
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
}

function capitalizeFirst(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Convert probability (0–1) to American moneyline
function probToAmerican(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) return null;
  const odds = x >= 0.5
    ? -Math.round((x / (1 - x)) * 100)  // favorite
    :  Math.round(((1 - x) / x) * 100); // underdog
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Read decimal probability directly from bet.odds (0..1)
function getProbFromBet(b) {
  const x = Number(b?.odds ?? b?.bet?.odds);
  return Number.isFinite(x) && x > 0 && x < 1 ? x : NaN;
}

// Require ALL legs to have valid probs; multiply for parlay
function combineParlayProb(bets) {
  if (!Array.isArray(bets) || bets.length === 0) return { p: NaN, legs: 0 };
  let p = 1;
  for (const b of bets) {
    const pb = getProbFromBet(b);
    if (!Number.isFinite(pb)) return { p: NaN, legs: 0 }; // missing/invalid -> show "—"
    p *= pb;
  }
  return { p, legs: bets.length };
}

// Parlay WIN if every leg result is "won"; else LOSS
function parlayResult(bets) {
  if (!Array.isArray(bets) || bets.length === 0) return "pending";
  const allWon = bets.every(b => String(b.result || "").toLowerCase() === "won");
  const anyLost = bets.some(b => String(b.result || "").toLowerCase() === "lost");
  if (allWon) return "won";
  if (anyLost) return "lost";
  // If you want PUSH handling, adjust here (e.g., "pending" or "push")
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

/* ---------- styles ---------- */

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
  background: "#0c2416",
  border: "1px solid #1f3d2a",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0,0,0,.3)"
};

const header = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  background: "linear-gradient(180deg, rgba(22,60,38,.75), rgba(22,60,38,.55))",
  borderBottom: "1px solid #2a563c"
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

/* NEW: split top row so tag is left, odds is right */
const rowTop = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 4
};
const rowLeft = { display: "flex", alignItems: "center", gap: 8 };
const rowRight = { marginLeft: "auto", display: "flex", alignItems: "center" };
const oddsRight = { fontWeight: 900, letterSpacing: 0.3, fontSize: 14 };

const title = { fontWeight: 800, letterSpacing: 0.3, display: "flex", flexWrap: "wrap", gap: 4 };

const tag = {
  fontWeight: 900,
  padding: "4px 8px",
  borderRadius: 8,
  letterSpacing: 0.6
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
  color: "rgba(255,255,255)"
};

const btn = surfaces.button();
