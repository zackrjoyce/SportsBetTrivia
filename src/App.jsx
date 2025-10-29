// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";

import HomePage from "./components/HomePage";
import BetSheet from "./components/BetSheet";
import PlayByPlayPage from "./components/PlayByPlayPage";
import GradedBetsPage from "./components/GradedBetsPage";

import { fetchGameData, extractGameEntities, buildBetSections } from "./utils/data";
import { gradeBets } from "./lib/bets";
import { palette, fonts } from "./styles/theme";

export default function App() {
  const navigate = useNavigate();

  // data loading
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [gamedata, setGamedata] = useState(null);

  // ui
  const [openBets, setOpenBets] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const gd = await fetchGameData();
        setGamedata(gd);
      } catch (e) {
        setErr(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const {
    home, away, homeRec, awayRec, date, time, stadium, week, game_info, pbp, scoring,
    matchup_passing, matchup_rushing, matchup_receiving, matchup_defense,
    homeTeamStarters, awayTeamStarters,
    seasonstats_team1, seasonstats_team2
  } = useMemo(() => (gamedata ? extractGameEntities(gamedata) : {}), [gamedata]);

  // Build a stable game identifier from home, away, date
  const gameId = useMemo(() => {
    const homeKey = home?.code || home || "";
    const awayKey = away?.code || away || "";
    const dateKey = date || "";
    return [homeKey, awayKey, dateKey].filter(Boolean).join("|");
  }, [home, away, date]);

  // If gameId matches last_bet_game in localStorage, auto-route to results
  useEffect(() => {
    if (!gameId) return;
    try {
      const last = localStorage.getItem("last_bet_game");
      if (last && last === gameId) {
        // NOTE: Your router defines "/results" (plural). If you truly want "/result",
        // change the Route path below and here accordingly.
        //navigate("/results", { replace: true });
      }
    } catch {}
  }, [gameId, navigate]);

  const betData = useMemo(() => {
    if (!seasonstats_team1 || !seasonstats_team2) return null;
    return {
      title: "BET SLIP",
      sections: buildBetSections(
        home, away, game_info,
        matchup_passing, matchup_rushing, matchup_receiving, matchup_defense,
        homeTeamStarters, awayTeamStarters,
        seasonstats_team1, seasonstats_team2
      ),
    };
  }, [
    seasonstats_team1, seasonstats_team2,
    home, away, game_info, matchup_passing, matchup_rushing, matchup_receiving, matchup_defense,
    homeTeamStarters, awayTeamStarters
  ]);

  if (loading) return <div style={page}>Loading…</div>;
  if (err)    return <div style={page}>Error: {String(err.message || err)}</div>;
  if (!home || !away) return <div style={page}>No teams found.</div>;

  const handleGoPlayByPlay = (bets = []) => {
    setOpenBets(false);

    // Save the current game's identifier when the user goes to /play
    try { localStorage.setItem("last_bet_game", gameId); } catch {}

    const graded = gradeBets(bets, {
      home, away, pbp, scoring, matchup_passing, matchup_rushing, matchup_receiving,
    });
    console.log(graded);
    navigate("/play", { state: { home, away, pbp, homeTeamStarters, awayTeamStarters, bets, graded } });
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          <>
            <HomePage
              date={date}
              time={time}
              stadium={stadium}
              week={week}
              home={home}
              away={away}
              homeRec={homeRec}
              awayRec={awayRec}
              onOpenBets={() => setOpenBets(true)}
            />
            <BetSheet
              isOpen={openBets}
              onClose={() => setOpenBets(false)}
              data={betData}
              home={home}
              away={away}
              onPrimary={handleGoPlayByPlay}
            />
          </>
        }
      />
      <Route path="/play" element={<PlayByPlayPage />} />
      {/* Your results route is plural; navigation above uses "/results". */}
      <Route path="/results" element={<GradedBetsPage />} />
    </Routes>
  );
}

const page = {
  height: "100vh",
  width: "100vw",
  display: "grid",
  placeItems: "center",
  background: palette.pageBg,
  color: palette.text,
  fontFamily: fonts,
};
