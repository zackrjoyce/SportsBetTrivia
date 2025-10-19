// S3 public URL (change if you move it)
export const GAME_DATA_URL =
  import.meta.env.VITE_GAME_DATA_URL ||
  "https://sportstriviabucket.s3.us-east-2.amazonaws.com/gamedata.json";

/**
 * Load gamedata.json (must be CORS-allowed for localhost)
 */
export async function fetchGameData(url = GAME_DATA_URL) {
  const res = await fetch(url, { credentials: "omit", mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch game data: ${res.status}`);
  return res.json();
}

const teamMap = {
  nwe: { code: "NWE", name: "New England Patriots", logo: "/logos/patriots.png", color: "#002244" },
  oti: { code: "TEN", name: "Tennessee Titans",   logo: "/logos/titans.png",   color: "#0C2340" },
};

const terminologyMap = {
  "1td": "Anytime TD",
  "2td": "2+ TDs",
  "firsttd": "First TD",
  "rec_yds": "Receiving yards",
  "rush_yds": "Rushing yards",
  "pass_yds": "Passing yards",
}

const minimumYardage = 7.5;
const evenOdds = -110;
const evenOddsImplied = .5;

export function extractGameEntities(gd) {
  const data = Array.isArray(gd) ? gd : [gd];

  const matchupParsed = data.find(d => d?.matchup_info !== undefined);
  const team1Parsed = data.find(d => d?.team1 !== undefined);
  const team2Parsed = data.find(d => d?.team2 !== undefined);

  const home = teamMap[team1Parsed?.team1];
  const away = teamMap[team2Parsed?.team2];

  const date = matchupParsed?.matchupstats?.scorebox_meta?.date || "";
  const time = matchupParsed?.matchupstats?.scorebox_meta?.start_time || "";
  const stadium = matchupParsed?.matchupstats?.scorebox_meta?.stadium || "";

  const pbp = matchupParsed?.matchupstats?.pbp || null;
  const game_info = matchupParsed?.matchupstats?.game_info || {};

  const matchup_passing = matchupParsed?.matchupstats?.passing_advanced || {};
  const matchup_rushing = matchupParsed?.matchupstats?.rushing_advanced || {};
  const matchup_receiving = matchupParsed?.matchupstats?.receiving_advanced || {};
  const matchup_defense = matchupParsed?.matchupstats?.advanced_defense || {};
  const scoring = matchupParsed?.matchupstats.scoring || {};

  // Starters (guard against null)
  const homeTeamStarters = matchupParsed?.matchupstats?.home_starters || {};
  const awayTeamStarters = matchupParsed?.matchupstats?.vis_starters || {};

  const seasonstats_team1 = team1Parsed?.data || {};
  const seasonstats_team2 = team2Parsed?.data || {};

  return {
    home, away, date, time, stadium, game_info, pbp, scoring,
    matchup_passing, matchup_rushing, matchup_receiving, matchup_defense,
    homeTeamStarters, awayTeamStarters,
    seasonstats_team1, seasonstats_team2
  };
}

/**
 * Build BetSheet sections, incl. new 2x3 section type.
 */
export function buildBetSections(
  home, away, game_info,
  matchup_passing, matchup_rushing, matchup_receiving, matchup_defense,
  homeTeamStarters, awayTeamStarters,
  seasonstats_team1, seasonstats_team2
) {
  const homeStartersKeys = Object.keys(homeTeamStarters || {});
  const awayStartersKeys = Object.keys(awayTeamStarters || {});

  const recordedStatsPassing   = Object.keys(matchup_passing   || {});
  const recordedStatsRushing   = Object.keys(matchup_rushing   || {});
  const recordedStatsReceiving = Object.keys(matchup_receiving || {});
  const recordedStatsDefense   = Object.keys(matchup_defense   || {});

  const gameprops  = Object.values(game_info || {});
  const teamstats1  = Object.values(seasonstats_team1?.team_stats || {});
  const teamstats2  = Object.values(seasonstats_team2?.team_stats || {});

  const teamgames1  = Object.values(seasonstats_team1?.games || {});
  const teamgames2  = Object.values(seasonstats_team2?.games || {});

  const weeks_played = getLargestNumericWeek(teamgames1) - 1;

  const team1pointsfor = Number(teamstats1.find(r => r.player === "Team Stats")?.points ?? 0);
  const team1pointsagainst = Number(teamstats1.find(r => r.player === "Opp Stats")?.points ?? 0);

  const team2pointsfor = Number(teamstats2.find(r => r.player === "Team Stats")?.points ?? 0);
  const team2pointsagainst = Number(teamstats2.find(r => r.player === "Opp Stats")?.points ?? 0);

  const team1_overline = divideAndRoundHalf((team1pointsfor+(team1pointsfor+team2pointsagainst)/2)/2, weeks_played);
  const team2_overline = divideAndRoundHalf((team2pointsfor+(team2pointsfor+team1pointsagainst)/2)/2, weeks_played);

  const game_overline = team1_overline + team2_overline + .5;

  const passing1   = Object.values(seasonstats_team1?.passing || {});
  const rushRec1   = Object.values(seasonstats_team1?.rushing_and_receiving || {});
  const tds1   = Object.values(seasonstats_team1?.scoring || {});

  const passing2   = Object.values(seasonstats_team2?.passing || {});
  const rushRec2   = Object.values(seasonstats_team2?.rushing_and_receiving || {});
  const tds2   = Object.values(seasonstats_team2?.scoring || {});

  const passing1_starters = passing1.filter(i => homeStartersKeys.includes(i.name_display) || recordedStatsPassing.includes(i.name_display));
  const rushing1_starters = rushRec1.filter(i => homeStartersKeys.includes(i.name_display) || recordedStatsRushing.includes(i.name_display));
  const receiving1_starters = rushRec1.filter(i => homeStartersKeys.includes(i.name_display) || recordedStatsReceiving.includes(i.name_display));
  const td1_starters = tds1.filter(i => awayStartersKeys.includes(i.name_display) || recordedStatsReceiving.includes(i.name_display) || recordedStatsRushing.includes(i.name_display) || recordedStatsPassing.includes(i.name_display));

  const passing2_starters = passing2.filter(i => awayStartersKeys.includes(i.name_display) || recordedStatsPassing.includes(i.name_display));
  const rushing2_starters = rushRec2.filter(i => awayStartersKeys.includes(i.name_display) || recordedStatsRushing.includes(i.name_display));
  const receiving2_starters = rushRec2.filter(i => awayStartersKeys.includes(i.name_display) || recordedStatsReceiving.includes(i.name_display));
  const td2_starters = tds2.filter(i => awayStartersKeys.includes(i.name_display) || recordedStatsReceiving.includes(i.name_display) || recordedStatsRushing.includes(i.name_display) || recordedStatsPassing.includes(i.name_display));

  // Vegas line parsing (handles "+3", "-2.5", stray team names)
  const vegasLineStr = (game_info?.["Vegas Line"]?.stat || "").toString();
  const numMatch = vegasLineStr.match(/([+-]?\d+(\.\d+)?)/);
  const lineNum = numMatch ? parseFloat(numMatch[1]) : 1;

  const favIsHome = vegasLineStr.includes(home?.name);
  const homeSpread = favIsHome ? lineNum : -lineNum;
  const awaySpread = -homeSpread;

  const mkRow = (title, entries = []) => ({
    title,
    buttons: entries.map(e => ({
      ...e, // <-- preserve extra fields such as `bet`, `lockGroup`, etc.
      top: e.top ?? e.name_display ?? e.player ?? "",
      bottom: e.bottom ?? e.line ?? "O/U",
    })),
  });

  /* NEW: Example 2×3 matrix section (two teams, three columns with vertical headers).
    You can generate these dynamically for any market that fits this shape. */

    const homeMoneyLineImplied = spreadToMoneyline(homeSpread);
    const awayMoneyLineImplied = spreadToMoneyline(awaySpread);

    const homeMoneyLine = probToAmerican(homeMoneyLineImplied);
    const awayMoneyLine = probToAmerican(awayMoneyLineImplied);

    const general = {
    type: "twoRow3",
    title: "Game Props",
    columnHeaders: ["Spread", "Total", "Moneyline"], // change labels per market
    enforceUniqueByColumn: true, // one selection per column total
    enforceUniqueByRow: false,    // one selection per row
    enforceUniqueById: true,
    rows: [
      {
        title: home?.name ?? "Home",
        buttons: [
          { 
            top: homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`, 
            bottom: evenOdds,
            bet: {
              market: "game",
              type: "spread",
              selection: home?.code ?? "Home",
              threshold: homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`,
              price: evenOdds,
              odds: evenOddsImplied,
              displayText: "Spread",
              display: ""
            },
            lockId: "game"
          },
          { 
            top: "O " + game_overline, 
            bottom: evenOdds,
            bet: {
              market: "game",
              type: "total",
              selection: "over",
              threshold: game_overline,
              price: evenOdds,
              odds: evenOddsImplied,
              displayText: "Total",
              display: "progress"
            },
          },
          { 
            top: "", 
            bottom: homeMoneyLine,
            bet: {
              market: "game",
              type: "moneyline",
              selection: home?.code ?? "Home",
              threshold: "",
              odds: homeMoneyLineImplied,
              price: homeMoneyLine,
              displayText: "Moneyline",
              display: ""
            },
            lockId: "game"
          },
          
        ],
      },
      {
        title: away?.name ?? "Away",
        buttons: [
          { 
            top: awaySpread > 0 ? `+${awaySpread}` : `${awaySpread}`, 
            bottom: evenOdds,
            bet: {
              market: "game",
              type: "spread",
              selection: away?.code ?? "Away",
              threshold: awaySpread > 0 ? `+${awaySpread}` : `${awaySpread}`,
              odds: evenOddsImplied,
              price: evenOdds,
              displayText: "Spread",
              display: ""
            },
            lockId: "game"
          },
          { 
            top: "U " + game_overline, 
            bottom: evenOdds,
            bet: {
              market: "game",
              type: "total",
              selection: "under",
              threshold: game_overline,
              odds: evenOddsImplied,
              price: evenOdds,
              displayText: "Total",
              display: "progress"
            },
          },
          { 
            top: "", 
            bottom: awayMoneyLine,
            bet: {
              market: "game",
              type: "moneyline",
              selection: away?.code ?? "Away",
              threshold: "",
              odds: awayMoneyLineImplied,
              price: awayMoneyLine,
              displayText: "Moneyline",
              display: ""
            },
            lockId: "game"
          },
        ],
      },
    ],
  };
  
  const touchdowns = {
    type: "twoRow3",
    title: "Touchdowns",
    columnHeaders: ["First TD", "Anytime TD", "2+ TDs"], // change labels per market
    enforceUniqueByColumn: false, // one selection per column total
    enforceUniqueByRow: true,    // one selection per row
    enforceUniqueById: true,
    rows: [
    ...mkTopPlayers(td1_starters, "total_td")
      .filter(p => Number(p.total_td) > 0 && Number(p.games) > 0)
      .map(p => mkRow(p.name_display + " (" + home.code + ")", [
        { 
          bottom: `${probToAmerican(firstTdProb(p.total_td, p.games)) ?? "—"}`, 
          bet: {
            market: "player",
            type: "td",
            team: home?.code ?? "Home",
            selection: p.name_display,
            threshold: "first",
            odds: firstTdProb(p.total_td, p.games),
            displayText: "First TD",
            price: probToAmerican(firstTdProb(p.total_td, p.games)),
          },
          lockId: "firstTD"
        }, // First TD
        { 
          bottom: `${probToAmerican(anytimeTdProb(p.total_td, p.games)) ?? "—"}`,
          bet: {
            market: "player",
            type: "td",
            team: home?.code ?? "Home",
            selection: p.name_display,
            threshold: "1",
            odds: anytimeTdProb(p.total_td, p.games),
            displayText: "Anytime TD",
            price: probToAmerican(anytimeTdProb(p.total_td, p.games)),
          },
        }, // Anytime TD
        { 
          bottom: `${probToAmerican(twoPlusTdProb(p.total_td, p.games)) ?? "—"}`,
          bet: {
            market: "player",
            type: "td",
            team: home?.code ?? "Home",
            selection: p.name_display,
            threshold: "2",
            odds: twoPlusTdProb(p.total_td, p.games),
            displayText: "2+ TDs",
            price: probToAmerican(twoPlusTdProb(p.total_td, p.games)),
          },
        }, // 2+ TDs-ish
      ])),

    // Add another series here (example: Receiving TDs)
    ...mkTopPlayers(td2_starters, "total_td")
      .filter(p => Number(p.total_td) > 0 && Number(p.games) > 0)
      .map(p => mkRow(p.name_display + " (" + away.code + ")", [
        { 
          bottom: `${probToAmerican(firstTdProb(p.total_td, p.games)) ?? "—"}`,
          bet: {
            market: "player",
            type: "td",
            team: away?.code ?? "Away",
            selection: p.name_display,
            threshold: "first",
            odds: firstTdProb(p.total_td, p.games),
            displayText: "First TD",
            price: probToAmerican(firstTdProb(p.total_td, p.games)),
          },
          lockId: "firstTD"
        },
        { 
          bottom: `${probToAmerican(anytimeTdProb(p.total_td, p.games)) ?? "—"}`,
          bet: {
            market: "player",
            type: "td",
            team: away?.code ?? "Away",
            selection: p.name_display,
            threshold: "1",
            odds: anytimeTdProb(p.total_td, p.games),
            displayText: "Anytime TD",
            price: probToAmerican(anytimeTdProb(p.total_td, p.games)),
          },
        },
        { 
          bottom: `${probToAmerican(twoPlusTdProb(p.total_td, p.games)) ?? "—"}`,
          bet: {
            market: "player",
            type: "td",
            team: away?.code ?? "Away",
            selection: p.name_display,
            threshold: "2",
            odds: twoPlusTdProb(p.total_td, p.games),
            displayText: "2+ TDs",
            price: probToAmerican(twoPlusTdProb(p.total_td, p.games)),
          },
        },
      ])),
    ]
  };

  const section1 = {
    title: `Passing Yds (${home?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(passing1_starters, "pass_yds")
      .filter(p => divideAndRoundHalf(p.pass_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.pass_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "pass_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.pass_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Passing yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.pass_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "pass_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.pass_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Passing yards",
            display: "progress"
          },
        },
      ])),
  };

  const section2 = {
    title: `Passing Yds (${away?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(passing2_starters, "pass_yds")
      .filter(p => divideAndRoundHalf(p.pass_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.pass_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "pass_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.pass_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Passing yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.pass_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "pass_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.pass_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Passing yards",
            display: "progress"
          },
        },
      ])),
  };

  const section3 = {
    title: `Receiving Yards (${home?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(receiving1_starters, "rec_yds")
      .filter(p => divideAndRoundHalf(p.rec_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.rec_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rec_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.rec_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Receiving yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.rec_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rec_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.rec_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Receiving yards",
            display: "progress"
          },
        },
      ])),
  };

  const section4 = {
    title: `Receiving Yards (${away?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(receiving2_starters, "rec_yds")
      .filter(p => divideAndRoundHalf(p.rec_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.rec_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rec_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.rec_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Receiving yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.rec_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rec_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.rec_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Receiving yards",
            display: "progress"
          },
        },
      ])),
  };

  const section5 = {
    title: `Rushing Yards (${home?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(rushing1_starters, "rush_yds")
      .filter(p => divideAndRoundHalf(p.rush_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.rush_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rush_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.rush_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Rushing yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.rush_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rush_yds",
            team: home?.code ?? "Home",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.rush_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Rushing yards",
            display: "progress"
          },
        },
      ])),
  };

  const section6 = {
    title: `Rushing Yards (${away?.name})`,
    enforceUniqueByColumn: false,
    enforceUniqueByRow: true,
    rows: mkTopPlayers(rushing2_starters, "rush_yds")
      .filter(p => divideAndRoundHalf(p.rush_yds, p.games) > minimumYardage)
      .map(p => mkRow(p.name_display, [
        { 
          top: `O ${divideAndRoundHalf(p.rush_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rush_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "O",
            threshold: divideAndRoundHalf(p.rush_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Rushing yards",
            display: "progress"
          },
        },
        { 
          top: `U ${divideAndRoundHalf(p.rush_yds, p.games)}`, 
          bottom: evenOdds,
          bet: {
            market: "player",
            type: "rush_yds",
            team: away?.code ?? "Away",
            selection: p.name_display,
            details: "U",
            threshold: divideAndRoundHalf(p.rush_yds, p.games),
            price: evenOdds,
            odds: evenOddsImplied,
            displayText: "Rushing yards",
            display: "progress"
          },
        },
      ])),
  };

  return [
    general, touchdowns, section1, section2, section3, section4, section5, section6
  ].filter(s => (s?.rows?.length ?? 0) > 0);
}

function getLargestNumericWeek(rows) {
  let max = -Infinity;
  for (const r of rows || []) {
    // pull first number from week_num (handles "10", "10*", etc.)
    const m = String(r?.week_num ?? "").match(/\d+/);
    if (!m) continue;
    const n = Number(m[0]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max === -Infinity ? null : max;
}

function mkTopPlayers(arr, key) {
  return (arr || [])
    .map(a => ({ ...a, _val: parseFloat(a[key] || "0") }))
    .sort((a, b) => (b._val || 0) - (a._val || 0))
}

function divideAndRoundHalf(valA, valB) {
  const a = Number(valA) || 0;
  const b = Number(valB) || 0;
  if (b === 0) return 0;
  const result = a / b;
  return Math.floor(result) + 0.5;
}

//HELPERS FOR SETTINGS ODDS!
function anytimeTdProb(tds, games) {
  if (!(tds >= 0) || !(games > 0)) return NaN;
  const lambda = tds / games;
  return 1 - Math.exp(-lambda);
}

const lambda = (tds, games) => (games > 0 ? tds / games : NaN);

function twoPlusTdProb(tds, games) {
  const l = lambda(tds, games);
  if (!isFinite(l)) return NaN;
  return 1 - Math.exp(-l) * (1 + l); // 1 - e^-λ(1+λ)
}

function firstTdProb(tds, games) {
  const LAMBDA_TOTAL = 5; // assumed combined TDs per game
  const g = Number(games);
  const td = Number(tds);
  if (!(g > 0) || !(td >= 0)) return 0;

  const lambdaPlayer = td / g;                       // player's TDs per game
  const share = Math.max(0, Math.min(1, lambdaPlayer / LAMBDA_TOTAL));
  const pAny = 1 - Math.exp(-LAMBDA_TOTAL);          // probability any TD occurs
  const pFirst = share * pAny;                       // player gets the first TD
  return pFirst;                               // decimal percent (e.g., 21.2)
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = x > 0 ? 1 - p : p;
  return cdf;
}

function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;

  let odds = p >= 0.5
    ? -Math.round((p / (1 - p)) * 100)
    : Math.round(((1 - p) / p) * 100);
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function spreadToMoneyline(spread, { sigma = 13.5, vig = 0.048 } = {}) {
  const absSpread = Math.abs(spread);
  const favProb = normCdf(absSpread / sigma);
  const dogProb = 1 - favProb;

  // Apply juice
  const favProbJuiced = Math.min(favProb * (1 + vig), 0.999);
  const dogProbJuiced = Math.min(dogProb * (1 + vig), 0.999);

  console.log(favProbJuiced);
  console.log(dogProbJuiced);

  if (spread < 0) {
    // Favorite
    return favProbJuiced;
  } else {
    // Underdog
    return dogProbJuiced;
  }
}
