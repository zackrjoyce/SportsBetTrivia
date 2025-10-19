// src/components/PlayByPlayPage.jsx
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PlayByPlayVisualizer from "./PlayByPlayVisualizer";

export default function PlayByPlayPage() {
  const { state } = useLocation() || {};
  const navigate = useNavigate();

  const home = state?.home || { code: "NWE", name: "New England Patriots", logo: "/assets/logos/patriots.png" };
  const away = state?.away || { code: "TEN", name: "Tennessee Titans",   logo: "/assets/logos/titans.png" };
  const pbp  = state?.pbp  || null;
  const homeTeamStarters  = state?.pbp  || null;
  const awayTeamStarters  = state?.pbp  || null;
  const bets  = state?.bets  || null;
  const graded = state?.graded || null;

  const handleGoGradedBets = () => {
    navigate("/results",  { state: { bets: graded } });
  };

  if (!pbp) {
    return (
      <div style={{ padding: 24, color: "#eaf7ef", background: "#0c2416", minHeight: "100vh" }}>
        <h2 style={{ marginTop: 0 }}>Play by Play</h2>
        <p>No play-by-play data found.</p>
        <button onClick={() => handleGoGradedBets()} style={backBtn}>Back</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, background: "#061b10", minHeight: "100vh" }}>
      <PlayByPlayVisualizer home={home} away={away} pbp={pbp} homeTeamStarters={homeTeamStarters} awayTeamStarters={awayTeamStarters} bets={bets} initialAuto={true} />
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button onClick={() => handleGoGradedBets()} style={backBtn}>Skip to end &gt;</button>
      </div>
    </div>
  );
}

const backBtn = {
  background: "#1a5a33",
  color: "#eaf7ef",
  border: "1px solid #2d7a4a",
  padding: "10px 16px",
  borderRadius: 8,
  fontWeight: 700,
  cursor: "pointer"
};
