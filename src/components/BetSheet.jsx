// src/components/BetSheet.jsx
import React, { useMemo, useState, useEffect } from "react";
import "../styles/BetSheet.css";

/**
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - onPrimary: (bets?: any[]) => void
 * - data: see your original schema
 */

/* ======================================================================
 *               Player Headshot Retrieval via Wikipedia/Wikimedia
 * ====================================================================== */

const IMAGE_PROXY = import.meta?.env?.VITE_IMAGE_PROXY || "";
// Fallback image (override via env if you want)
const DEFAULT_HEADSHOT =
  import.meta?.env?.VITE_DEFAULT_HEADSHOT || "/media/default-headshot.png";

// Session cache (name -> { url, thumb })
if (!window.__headshotCache) window.__headshotCache = new Map();

/** Normalize player names for consistent requests */
function normalizeName(n) {
  return String(n || "").trim().replace(/\s+/g, " ");
}

/** Try to get a page summary (has thumbnail/originalimage) for an exact title */
async function fetchSummaryByTitle(title) {
  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

/** If exact title fails (or is a disambiguation), search titles and pick top result */
async function searchBestTitle(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encoded}&limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.pages?.[0]?.title || null;
}

/**
 * Resolve a player name to image URLs using Wikipedia:
 * Returns { url, thumb } (prefer originalimage, fallback thumbnail).
 */
async function resolveWikipediaHeadshot(name) {
  const q = normalizeName(name);
  if (!q) return { url: null, thumb: null };

  let summary = await fetchSummaryByTitle(q);

  const isMissing =
    summary?.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found" ||
    summary?.detail === "Not found.";
  const isDisambig = summary?.type === "disambiguation";

  if (!summary || isMissing || isDisambig) {
    const bestTitle = await searchBestTitle(q);
    if (bestTitle) summary = await fetchSummaryByTitle(bestTitle);
  }

  const url = summary?.originalimage?.source || null;
  const thumb = summary?.thumbnail?.source || null;

  return { url, thumb };
}

/**
 * React hook returning { url, thumb } for a player name using Wikipedia.
 * Caches in-memory for the session.
 */
function useHeadshot(name) {
  const q = normalizeName(name);
  const [state, setState] = useState({ url: null, thumb: null });

  useEffect(() => {
    let cancelled = false;
    if (!q) {
      setState({ url: null, thumb: null });
      return;
    }

    if (!window.__headshotCache) window.__headshotCache = new Map();
    const cache = window.__headshotCache;

    if (cache.has(q)) {
      setState(cache.get(q));
      return;
    }

    (async () => {
      const result = await resolveWikipediaHeadshot(q);
      if (cancelled) return;
      cache.set(q, result);
      setState(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [q]);

  return state; // { url, thumb }
}

/* ======================================================================
 *                    Headshot thumbnail (left of each row)
 * ====================================================================== */

function RowHeadshot({ playerName }) {
  const name = normalizeName(playerName);
  const { url, thumb } = useHeadshot(name);
  const [imgSrc, setImgSrc] = useState(DEFAULT_HEADSHOT);

  useEffect(() => {
    if (!name) {
      setImgSrc(DEFAULT_HEADSHOT);
      return;
    }
    const first =
      (url && (IMAGE_PROXY ? IMAGE_PROXY + encodeURIComponent(url) : url)) ||
      (thumb && (IMAGE_PROXY ? IMAGE_PROXY + encodeURIComponent(thumb) : thumb)) ||
      DEFAULT_HEADSHOT; // ⬅️ fallback immediately
    setImgSrc(first);
  }, [name, url, thumb]);

  function onError(e) {
    // Whatever failed, fall straight back to the default (prevents loops)
    if (imgSrc !== DEFAULT_HEADSHOT) {
      setImgSrc(DEFAULT_HEADSHOT);
    }
  }

  return (
    <div className="bsp-headshot-wrap">
      <img
        className="bsp-headshot"
        alt={name || "Player"}
        src={imgSrc || DEFAULT_HEADSHOT}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={onError}
      />
    </div>
  );
}

/** Try to extract a player name for the row (from its buttons first, else row title) */
function getRowPlayerName(row) {
  // Look through buttons for a player-bearing bet
  for (const btn of row?.buttons ?? []) {
    const n =
      btn?.bet?.selection ||
      btn?.bet?.player ||
      btn?.selection ||
      btn?.player ||
      "";
    const market = btn?.bet?.market || "game";

    if (market != "game"){
      const norm = normalizeName(n);
      if (norm) return norm;
    }
  }
  // Fallback: sometimes the row title is the player name
  return normalizeName(row?.title || "");
}

/* ======================================================================
 *                         Bet Button (NO image now)
 * ====================================================================== */

function BetButton({
  btn,
  isActive,
  isConflict,
  onClick,
  classNameExtras = "",
}) {
  const cls = [
    "bsp-btn",
    !btn.top ? "bsp-btn-single" : "",
    isActive ? "active" : "",
    isConflict ? "conflict" : "",
    classNameExtras,
  ]
    .join(" ")
    .trim();

  return (
    <button
      className={cls}
      onClick={onClick}
      type="button"
      title={isConflict ? "Conflict with selection rules" : undefined}
    >
      {btn.top && <div className="bsp-btn-top">{btn.top}</div>}
      <div className="bsp-btn-bottom">{btn.bottom}</div>
    </button>
  );
}

/* ======================================================================
 *                           Main BetSheet
 * ====================================================================== */

const BetSheet = ({ isOpen, onClose, data, onPrimary }) => {
  if (!isOpen) return null;

  // Selected keys encode section:row:button
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [bets, setBets] = useState([]); // keeps selected bet objects

  const keyFor = (sIdx, rIdx, bIdx) => `${sIdx}:${rIdx}:${bIdx}`;

  // Build a bet object for a button if it didn't provide one
  const buildBetFor = (sIdx, rIdx, bIdx, btn) => {
    const section = data?.sections?.[sIdx];
    const row = section?.rows?.[rIdx];
    const colHeader =
      (Array.isArray(section?.columnHeaders) && section.columnHeaders[bIdx]) ||
      null;

    const id = keyFor(sIdx, rIdx, bIdx);

    // Use provided bet if present, else auto-build a compact one
    const base = btn?.bet ?? {};
    const lockId = btn?.lockId ?? base?.lockId ?? null;

    return {
      id,
      sIdx,
      rIdx,
      bIdx,
      section: section?.title ?? "",
      row: row?.title ?? "",
      column: colHeader,
      labelTop: btn?.top ?? null,
      labelBottom: btn?.bottom ?? null,
      price: btn?.bottom ?? null,
      // parlay probability (0..1) if present
      odds:
        typeof base?.odds === "number"
          ? base.odds
          : typeof btn?.odds === "number"
          ? btn.odds
          : undefined,
      lockId,
      ...base,
    };
  };

  // Toggle selection AND add/remove from bets
  const onToggle = (sIdx, rIdx, bIdx, btn) => {
    const key = keyFor(sIdx, rIdx, bIdx);

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const selecting = !next.has(key);

      if (selecting) {
        next.add(key);
        setBets((prevBets) => {
          const bet = buildBetFor(sIdx, rIdx, bIdx, btn);
          const filtered = prevBets.filter((b) => b.id !== bet.id);
          return [...filtered, bet];
        });
      } else {
        next.delete(key);
        setBets((prevBets) => prevBets.filter((b) => b.id !== key));
      }

      return next;
    });
  };

  const selectedTriples = useMemo(
    () =>
      Array.from(selectedKeys).map((k) => {
        const [s, r, b] = k.split(":").map((n) => parseInt(n, 10));
        return { s, r, b };
      }),
    [selectedKeys]
  );

  // Collect only bets that have a valid decimal probability
  const validProbBets = useMemo(
    () => bets.filter((b) => typeof b?.odds === "number" && b.odds > 0 && b.odds < 1),
    [bets]
  );

  // Multiply their probabilities to get the current parlay probability
  const parlayProb = useMemo(() => {
    if (validProbBets.length === 0) return NaN;
    return validProbBets.reduce((acc, b) => acc * b.odds, 1);
  }, [validProbBets]);

  const parlayAmerican = useMemo(() => probToAmerican(parlayProb), [parlayProb]);
  const parlayPercent = useMemo(
    () => (isFinite(parlayProb) ? `${(parlayProb * 100).toFixed(1)}%` : "—"),
    [parlayProb]
  );

  /** ----------------- NEW: Global + Section-scoped lockId conflicts ----------------- */
  const conflictedLockIds = useMemo(() => {
    const anySectionEnforces = (data?.sections ?? []).some(
      (sec) => sec?.enforceUniqueById
    );
    if (!data?.enforceUniqueById && !anySectionEnforces) return new Set();

    const counts = new Map(); // scopeKey -> count

    // Scope keys: global "__GLOBAL__::<lockId>" ; section "S:<sIdx>::<lockId>"
    for (const { s, r, b } of selectedTriples) {
      const section = data?.sections?.[s];
      const btn = section?.rows?.[r]?.buttons?.[b];
      if (!btn) continue;

      const lid = btn?.lockId ?? btn?.bet?.lockId ?? null;
      if (lid == null) continue;

      if (data?.enforceUniqueById) {
        const gk = `__GLOBAL__::${String(lid)}`;
        counts.set(gk, (counts.get(gk) || 0) + 1);
      }
      if (section?.enforceUniqueById) {
        const sk = `S:${s}::${String(lid)}`;
        counts.set(sk, (counts.get(sk) || 0) + 1);
      }
    }

    return new Set(
      [...counts].filter(([, c]) => c > 1).map(([k]) => k)
    );
  }, [data, selectedTriples]);

  /** ----------------- Column uniqueness conflicts (existing) ----------------- */
  const conflictColsBySection = useMemo(() => {
    const map = new Map(); // sIdx -> Set<bIdx>
    (data?.sections ?? []).forEach((section, sIdx) => {
      if (!section?.enforceUniqueByColumn) return;
      const counts = new Map(); // bIdx -> count
      selectedTriples
        .filter((t) => t.s === sIdx)
        .forEach(({ b }) => counts.set(b, (counts.get(b) || 0) + 1));
      const conflicts = new Set(
        Array.from(counts).filter(([, c]) => c > 1).map(([b]) => b)
      );
      if (conflicts.size) map.set(sIdx, conflicts);
    });
    return map;
  }, [data, selectedTriples]);

  /** ----------------- Row uniqueness conflicts (existing) ----------------- */
  const conflictRowsBySection = useMemo(() => {
    const map = new Map(); // sIdx -> Set<rIdx>
    (data?.sections ?? []).forEach((section, sIdx) => {
      if (!section?.enforceUniqueByRow) return;
      const counts = new Map(); // rIdx -> count
      selectedTriples
        .filter((t) => t.s === sIdx)
        .forEach(({ r }) => counts.set(r, (counts.get(r) || 0) + 1));
      const conflicts = new Set(
        Array.from(counts).filter(([, c]) => c > 1).map(([r]) => r)
      );
      if (conflicts.size) map.set(sIdx, conflicts);
    });
    return map;
  }, [data, selectedTriples]);

  // Any conflicts disable the footer button
  const hasColumnConflicts = Array.from(conflictColsBySection.values()).some(
    (set) => set.size > 0
  );
  const hasRowConflicts = Array.from(conflictRowsBySection.values()).some(
    (set) => set.size > 0
  );
  const hasIdConflicts = useMemo(
    () => conflictedLockIds.size > 0,
    [conflictedLockIds]
  );

  const selectedCount = selectedKeys.size;
  const footerDisabled =
    selectedCount === 0 || hasColumnConflicts || hasRowConflicts || hasIdConflicts;

  /** ----------------- renderers ----------------- */

  // Default rows renderer (now with headshot to the LEFT of the row)
  const renderDefaultSection = (section, sIdx, conflictCols, conflictRows) => (
    <>
      {(section.rows ?? []).map((row, rIdx) => {
        const player = getRowPlayerName(row);

        return (
          <div key={rIdx} className="bsp-row">
            {/* Left: headshot */}
            <RowHeadshot playerName={player} />

            {/* Middle: row title */}
            <div className="bsp-row-label">{row.title}</div>

            {/* Right: buttons */}
            <div className="bsp-row-buttons">
              {(row.buttons ?? []).map((btn, bIdx) => {
                const k = keyFor(sIdx, rIdx, bIdx);
                const isActive = selectedKeys.has(k);
                const isColConflict = isActive && conflictCols.has(bIdx);
                const isRowConflict = isActive && conflictRows.has(rIdx);

                // ID conflict (global and/or section scope)
                const sectionEnforcesId = !!(
                  data?.enforceUniqueById || section?.enforceUniqueById
                );
                const lid = btn?.lockId ?? btn?.bet?.lockId ?? null;

                let isIdConflict = false;
                if (isActive && sectionEnforcesId && lid != null) {
                  const globalKey = `__GLOBAL__::${String(lid)}`;
                  const sectionKey = `S:${sIdx}::${String(lid)}`;
                  if (data?.enforceUniqueById && conflictedLockIds.has(globalKey))
                    isIdConflict = true;
                  if (section?.enforceUniqueById && conflictedLockIds.has(sectionKey))
                    isIdConflict = true;
                }

                const isConflict = isColConflict || isRowConflict || isIdConflict;

                return (
                  <BetButton
                    key={bIdx}
                    btn={btn}
                    isActive={isActive}
                    isConflict={isConflict}
                    onClick={() => onToggle(sIdx, rIdx, bIdx, btn)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );

  // twoRow3 renderer (add headshot in the left label cell)
  const renderTwoRow3Section = (section, sIdx, conflictCols, conflictRows) => {
    const colHeaders = section?.columnHeaders ?? ["", "", ""];
    const rows = section?.rows ?? [];
    return (
      <div className="bsp-matrix">
        <div className="bsp-matrix-head">
          {/* Left area aligns with row labels (headshot+title) */}
          <div className="bsp-matrix-spacer" />
          <div className="bsp-matrix-colheaders">
            {colHeaders.slice(0, 3).map((h, i) => (
              <div key={i} className="bsp-colheader">
                <span className="bsp-colheader-text">{h}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bsp-matrix-body">
          {rows.map((row, rIdx) => {
            const player = getRowPlayerName(row);
            return (
              <div key={rIdx} className="bsp-matrix-row">
                <div className="bsp-matrix-rowlabel">
                  <RowHeadshot playerName={player} />
                  <div className="bsp-matrix-rowtitle">{row.title}</div>
                </div>
                <div className="bsp-matrix-buttons">
                  {(row.buttons ?? []).slice(0, 3).map((btn, bIdx) => {
                    const k = keyFor(sIdx, rIdx, bIdx);
                    const isActive = selectedKeys.has(k);
                    const isColConflict = isActive && conflictCols.has(bIdx);
                    const isRowConflict = isActive && conflictRows.has(rIdx);

                    // ID conflict
                    const sectionEnforcesId = !!(
                      data?.enforceUniqueById || section?.enforceUniqueById
                    );
                    const lid = btn?.lockId ?? btn?.bet?.lockId ?? null;

                    let isIdConflict = false;
                    if (isActive && sectionEnforcesId && lid != null) {
                      const globalKey = `__GLOBAL__::${String(lid)}`;
                      const sectionKey = `S:${sIdx}::${String(lid)}`;
                      if (data?.enforceUniqueById && conflictedLockIds.has(globalKey))
                        isIdConflict = true;
                      if (section?.enforceUniqueById && conflictedLockIds.has(sectionKey))
                        isIdConflict = true;
                    }

                    const isConflict = isColConflict || isRowConflict || isIdConflict;

                    return (
                      <BetButton
                        key={bIdx}
                        btn={btn}
                        isActive={isActive}
                        isConflict={isConflict}
                        onClick={() => onToggle(sIdx, rIdx, bIdx, btn)}
                        classNameExtras="bsp-btn-cell"
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderConflictHint = () => {
    const parts = [];
    if (hasColumnConflicts) parts.push("column rule");
    if (hasRowConflicts) parts.push("row rule");
    if (hasIdConflicts) parts.push("ID rule");
    if (parts.length === 0) return null;
    const label =
      parts
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" + ") + " violated.";
    return <div className="bsp-conflict-hint">{label}</div>;
  };

  return (
    <div
      className={`bsp-overlay ${isOpen ? "bsp-visible" : "bsp-hidden"}`}
      onClick={onClose}
      aria-hidden={!isOpen}
    >
      <div className="bsp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bsp-header">
          <div className="bsp-grab" />
          <h2 className="bsp-title">{data?.title ?? "Details"}</h2>
          <button className="bsp-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="bsp-content">
          {(data?.sections ?? []).map((section, sIdx) => {
            const type = section?.type ?? "default";
            const conflictCols = conflictColsBySection.get(sIdx) || new Set();
            const conflictRows = conflictRowsBySection.get(sIdx) || new Set();

            return (
              <section key={sIdx} className="bsp-section">
                <h3 className="bsp-section-title">{section.title}</h3>
                {type === "twoRow3"
                  ? renderTwoRow3Section(section, sIdx, conflictCols, conflictRows)
                  : renderDefaultSection(section, sIdx, conflictCols, conflictRows)}
              </section>
            );
          })}
        </div>

        <div className="bsp-footer">
          <div className="bsp-footer-inner">
            {renderConflictHint()}
            <button
              className="bsp-footer-btn"
              disabled={footerDisabled}
              onClick={() => onPrimary?.(bets)}
              type="button"
            >
              {selectedCount} Selected
              {selectedCount > 0 && (
                <>
                  {" "}
                  ({parlayAmerican ?? parlayPercent /* prefer American if valid, else % */})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ======================================================================
 *                               Utils
 * ====================================================================== */

// Convert a decimal probability (0..1) to American odds
function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5
    ? `${-Math.round((p / (1 - p)) * 100)}`
    : `+${Math.round(((1 - p) / p) * 100)}`;
}

export default BetSheet;
