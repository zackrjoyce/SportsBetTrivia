// src/components/BetSheet.jsx
import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import "../styles/BetSheet.css";

/* ======================================================================
 *               Player Headshot Retrieval via Wikipedia/Wikimedia
 * ====================================================================== */

const IMAGE_PROXY = import.meta?.env?.VITE_IMAGE_PROXY || "";
const DEFAULT_HEADSHOT =
  import.meta?.env?.VITE_DEFAULT_HEADSHOT || "/media/default-headshot.png";

if (!window.__headshotCache) window.__headshotCache = new Map();

function normalizeName(n) {
  return String(n || "").trim().replace(/\s+/g, " ");
}

async function fetchSummaryByTitle(title) {
  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

async function searchBestTitle(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encoded}&limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.pages?.[0]?.title || null;
}

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

function RowHeadshot({ playerName, header }) {
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
      DEFAULT_HEADSHOT;
    setImgSrc(first);
  }, [name, url, thumb]);

  function onError() {
    if (imgSrc !== DEFAULT_HEADSHOT) setImgSrc(DEFAULT_HEADSHOT);
  }

  const fit = String(header).toLowerCase() === "game" ? "contain" : "cover";

  return (
    <div className="bsp-headshot-wrap">
      <img
        className="bsp-headshot"
        alt={name || "Player"}
        src={imgSrc || DEFAULT_HEADSHOT}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={onError}
        style={{ objectFit: fit }}
      />
    </div>
  );
}

/** Extract a player name + market from row */
function getRowNameMarket(row) {
  let market = "";
  for (const btn of row?.buttons ?? []) {
    const n =
      btn?.bet?.selection ||
      btn?.bet?.player ||
      btn?.selection ||
      btn?.player ||
      "";
    market = btn?.bet?.market || "game";
    if (market !== "game") {
      const norm = normalizeName(n);
      if (norm) return { player: norm, market };
    }
  }
  return { player: normalizeName(row?.title || ""), market };
}

/* ======================================================================
 *                         Bet Button
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

const MIN_VH = 40;
const MAX_VH = 95;
const DEFAULT_VH = 85;

const vhToPx = (vh) => Math.round((vh / 100) * window.innerHeight);

const BetSheet = ({ isOpen, onClose, data, home, away, onPrimary }) => {
  if (!isOpen) return null;

  /* ---------------- DRAG / RESIZE STATE ---------------- */
  const sheetRef = useRef(null);

  // Height (for expand up) and translate (for drag down follow)
  const [heightPx, setHeightPx] = useState(() => vhToPx(DEFAULT_VH));
  const [translateY, setTranslateY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Exit animation state (MUST be inside component)
  const [isExiting, setIsExiting] = useState(false);

  // Drag ref (truthy live flag avoids stale state in listeners)
  const dragRef = useRef({
    startY: 0,
    startHeight: vhToPx(DEFAULT_VH),
    draggedDown: 0,
    draggedUp: 0,
    closeReady: false,
    isDragging: false,
  });

  const clampHeight = useCallback((px) => {
    const minPx = vhToPx(MIN_VH);
    const maxPx = vhToPx(MAX_VH);
    return Math.max(minPx, Math.min(maxPx, px));
  }, []);

  // Keep same vh ratio if viewport changes
  useEffect(() => {
    const onResize = () => {
      const vh = (heightPx / window.innerHeight) * 100;
      setHeightPx(vhToPx(Math.max(MIN_VH, Math.min(MAX_VH, vh))));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [heightPx]);

  const getClientY = (e) =>
    e?.clientY ??
    (e?.touches && e.touches[0]?.clientY) ??
    (e?.changedTouches && e.changedTouches[0]?.clientY) ??
    0;

  const onMove = useCallback(
    (e) => {
      if (!dragRef.current.isDragging) return;
      const y = getClientY(e);
      const dy = y - dragRef.current.startY; // +down, -up

      if (dy >= 0) {
        dragRef.current.draggedDown = dy;
        dragRef.current.draggedUp = 0;
        setTranslateY(dy); // follow finger/cursor
        dragRef.current.closeReady = dy >= dragRef.current.startHeight * 0.25;
      } else {
        const up = Math.abs(dy);
        dragRef.current.draggedUp = up;
        dragRef.current.draggedDown = 0;
        setTranslateY(0); // expand up changes height instead of translate
        setHeightPx((prev) => clampHeight(dragRef.current.startHeight + up));
        dragRef.current.closeReady = false;
      }

      if (e.cancelable) e.preventDefault();
    },
    [clampHeight]
  );

  // Animate-out close helper
  const handleRequestClose = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);

    const el = sheetRef.current;
    if (!el) {
      onClose?.();
      return;
    }

    // Ensure transition class is present
    el.classList.add("drag-transition");

    // Force a reflow so the transition will trigger
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;

    // Drive exit with direct style write, avoids React batching issues
    const offscreen = `${window.innerHeight + 200}px`;
    el.style.transform = `translateY(${offscreen})`;

    // Wait for transition end, then unmount
    const onEnd = (evt) => {
      if (evt.target !== el || evt.propertyName !== "transform") return;
      el.removeEventListener("transitionend", onEnd);
      setIsExiting(false);
      onClose?.();
    };
    el.addEventListener("transitionend", onEnd);
  }, [isExiting, onClose]);

  const endDrag = useCallback(() => {
    dragRef.current.isDragging = false;
    setDragging(false);
    document.documentElement.style.userSelect = "";
    document.body.style.cursor = "";

    const closeNow = dragRef.current.closeReady;

    sheetRef.current?.classList.add("drag-transition");

    if (closeNow) {
      handleRequestClose(); // animate out
    } else {
      setTranslateY(0); // snap back
      setTimeout(() => {
        sheetRef.current?.classList.remove("drag-transition");
      }, 190);
    }

    window.removeEventListener("pointermove", onMove, { passive: false });
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("touchmove", onMove, { passive: false });
    window.removeEventListener("touchend", endDrag);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", endDrag);
  }, [handleRequestClose, onMove]);

  const startDragAtY = useCallback(
    (clientY) => {
      dragRef.current.isDragging = true;
      setDragging(true);
      dragRef.current.startY = clientY;
      dragRef.current.startHeight =
        sheetRef.current?.offsetHeight ?? vhToPx(DEFAULT_VH);
      dragRef.current.draggedDown = 0;
      dragRef.current.draggedUp = 0;
      dragRef.current.closeReady = false;

      document.documentElement.style.userSelect = "none";
      document.body.style.cursor = "ns-resize";

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", endDrag);

      // fallbacks for older Safari/webviews
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", endDrag);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", endDrag);
    },
    [onMove, endDrag]
  );

  const onPointerDown = useCallback(
    (e) => {
      const t = e.currentTarget;
      if (t.setPointerCapture && e.pointerId != null) {
        try {
          t.setPointerCapture(e.pointerId);
        } catch {}
      }
      startDragAtY(getClientY(e));
      if (e.cancelable) e.preventDefault();
    },
    [startDragAtY]
  );

  const onTouchStart = useCallback(
    (e) => {
      startDragAtY(getClientY(e));
      if (e.cancelable) e.preventDefault();
    },
    [startDragAtY]
  );

  const onMouseDown = useCallback(
    (e) => {
      startDragAtY(getClientY(e));
    },
    [startDragAtY]
  );

  /* ---------------- Selection / Odds (unchanged) ---------------- */
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [bets, setBets] = useState([]);

  const keyFor = (sIdx, rIdx, bIdx) => `${sIdx}:${rIdx}:${bIdx}`;

  const buildBetFor = (sIdx, rIdx, bIdx, btn) => {
    const section = data?.sections?.[sIdx];
    const row = section?.rows?.[rIdx];
    const colHeader =
      (Array.isArray(section?.columnHeaders) && section.columnHeaders[bIdx]) ||
      null;

    const id = keyFor(sIdx, rIdx, bIdx);
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

  const validProbBets = useMemo(
    () =>
      bets.filter(
        (b) => typeof b?.odds === "number" && b.odds > 0 && b.odds < 1
      ),
    [bets]
  );

  const parlayProb = useMemo(() => {
    if (validProbBets.length === 0) return NaN;
    return validProbBets.reduce((acc, b) => acc * b.odds, 1);
  }, [validProbBets]);

  const parlayAmerican = useMemo(() => probToAmerican(parlayProb), [parlayProb]);
  const parlayPercent = useMemo(
    () => (isFinite(parlayProb) ? `${(parlayProb * 100).toFixed(1)}%` : "—"),
    [parlayProb]
  );

  const conflictedLockIds = useMemo(() => {
    const anySectionEnforces = (data?.sections ?? []).some(
      (sec) => sec?.enforceUniqueById
    );
    if (!data?.enforceUniqueById && !anySectionEnforces) return new Set();

    const counts = new Map();
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

  const conflictColsBySection = useMemo(() => {
    const map = new Map();
    (data?.sections ?? []).forEach((section, sIdx) => {
      if (!section?.enforceUniqueByColumn) return;
      const counts = new Map();
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

  const conflictRowsBySection = useMemo(() => {
    const map = new Map();
    (data?.sections ?? []).forEach((section, sIdx) => {
      if (!section?.enforceUniqueByRow) return;
      const counts = new Map();
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

  const hasColumnConflicts = Array.from(
    conflictColsBySection.values()
  ).some((s) => s.size > 0);
  const hasRowConflicts = Array.from(
    conflictRowsBySection.values()
  ).some((s) => s.size > 0);
  const hasIdConflicts = useMemo(() => conflictedLockIds.size > 0, [conflictedLockIds]);

  const selectedCount = selectedKeys.size;
  const footerDisabled =
    selectedCount === 0 || hasColumnConflicts || hasRowConflicts || hasIdConflicts;

  /* ---------------- RENDERERS ---------------- */
  const renderDefaultSection = (section, sIdx, conflictCols, conflictRows) => (
    <>
      {(section.rows ?? []).map((row, rIdx) => {
        const { player, market } = getRowNameMarket(row);

        return (
          <div key={rIdx} className="bsp-row">
            <RowHeadshot playerName={player} header={market} />
            <div className="bsp-row-label">{row.title}</div>
            <div className="bsp-row-buttons">
              {(row.buttons ?? []).map((btn, bIdx) => {
                const k = keyFor(sIdx, rIdx, bIdx);
                const isActive = selectedKeys.has(k);
                const isColConflict = isActive && conflictCols.has(bIdx);
                const isRowConflict = isActive && conflictRows.has(rIdx);

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

  const renderTwoRow3Section = (section, sIdx, conflictCols, conflictRows) => {
    const colHeaders = section?.columnHeaders ?? ["", "", ""];
    const rows = section?.rows ?? [];
    return (
      <div className="bsp-matrix">
        <div className="bsp-matrix-head">
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
            const { player, market } = getRowNameMarket(row);
            return (
              <div key={rIdx} className="bsp-matrix-row">
                <div className="bsp-matrix-rowlabel">
                  <RowHeadshot playerName={player} header={market} />
                  <div className="bsp-matrix-rowtitle">{row.title}</div>
                </div>
                <div className="bsp-matrix-buttons">
                  {(row.buttons ?? []).slice(0, 3).map((btn, bIdx) => {
                    const k = keyFor(sIdx, rIdx, bIdx);
                    const isActive = selectedKeys.has(k);
                    const isColConflict = isActive && conflictCols.has(bIdx);
                    const isRowConflict = isActive && conflictRows.has(rIdx);

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
      parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" + ") +
      " violated.";
    return <div className="bsp-conflict-hint">{label}</div>;
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div
      className={`bsp-overlay ${isOpen ? "bsp-visible" : "bsp-hidden"} ${isExiting ? "bsp-exiting" : ""}`}
      onClick={handleRequestClose}
      aria-hidden={!isOpen}
    >
      <div
        ref={sheetRef}
        className="bsp-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: `${heightPx}px`,                 // expand up changes height
          transform: `translateY(${translateY}px)`, // drag down follows finger
        }}
      >
        <div className="bsp-header">
          <div
            className={`bsp-grab ${dragging ? "is-dragging" : ""}`}
            onPointerDown={onPointerDown}
            onTouchStart={onTouchStart}
            onMouseDown={onMouseDown}
            role="button"
            aria-label="Drag to resize or close"
            tabIndex={0}
          />
          <h2 className="bsp-title">{data?.title ?? "Details"}</h2>
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
              {selectedCount > 0 && <> ({parlayAmerican ?? parlayPercent})</>}
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
function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5
    ? `${-Math.round((p / (1 - p)) * 100)}`
    : `+${Math.round(((1 - p) / p) * 100)}`;
}

export default BetSheet;
