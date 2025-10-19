// src/components/HomePage.jsx
import React, { useEffect, useRef } from "react";
import "../styles/HomePage.css";

export default function HomePage({
  date,
  time,
  stadium,
  home,
  away,
  onOpenBets,
  bgHls = "",
  bgMp4 = "/media/bg-720p.mp4",
  poster = "/media/bg-fallback.jpg"
}) {
  return (
    <>
      <VideoBackdrop bgHls={bgHls} bgMp4={bgMp4} poster={poster} />

      <div className="wrap">
        {/* ⬇️ Title logo at center top */}
        <header className="site-header">
          <img
            src="/footballtimemachine.png"
            alt="Football Time Machine"
            className="site-logo"
          />
        </header>

        <div className="wrap-inner">
          <div className="teams-row">
            <div className="team-card">
              <img src={home.logo} alt={home.name} className="logo" />
              <TeamName name={home.name}/>
            </div>

            <div className="date-badge"><br></br>{date}<br></br>{time}, {stadium}</div>

            <div className="team-card">
              <img src={away.logo} alt={away.name} className="logo" />
              <TeamName name={away.name}/>
            </div>
          </div>

          <button className="primary-btn--fixed" onClick={onOpenBets}>
            Open Bet Sheet &gt;
          </button>
        </div>
      </div>
    </>
  );
}

function VideoBackdrop({ bgHls, bgMp4, poster }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const tryPlay = () => v.play().catch(() => {});
    let hls;
    (async () => {
      if (bgHls && v.canPlayType("application/vnd.apple.mpegurl")) { v.src = bgHls; tryPlay(); return; }
      if (bgHls) {
        let HlsLib = window.Hls; if (!HlsLib) { try { ({ default: HlsLib } = await import("hls.js")); } catch {} }
        if (HlsLib?.isSupported()) { hls = new HlsLib({ capLevelToPlayerSize: true, maxBufferLength: 20 }); hls.loadSource(bgHls); hls.attachMedia(v); hls.on(HlsLib.Events.MANIFEST_PARSED, tryPlay); return; }
      }
      v.src = bgMp4 || ""; tryPlay();
    })();
    const onVis = () => (document.hidden ? v.pause() : tryPlay());
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); hls?.destroy?.(); };
  }, [bgHls, bgMp4]);
  return (
    <div className="video-bg" aria-hidden="true">
      <video ref={ref} className="video-bg__media" muted loop playsInline preload="metadata" poster={poster} />
      <div className="video-bg__overlay" />
    </div>
  );
}

function TeamName({ name, upper = false }) {
  const parts = String(name || "").trim().split(/\s+/);
  const last = parts.pop() || "";
  const first = parts.join(" ");
  return (
    <div className={`team-name ${upper ? "team-name--upper" : ""}`}>
      <span className="team-name-first">{first}</span>
      <span className="team-name-last">{last}</span>
    </div>
  );
}
