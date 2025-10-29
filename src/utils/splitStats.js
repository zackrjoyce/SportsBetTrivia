
/**
 * Given a "box" object shaped like:
 * {
 *   "Derrick Henry": {
 *      player: "Derrick Henry",
 *      team: "TEN",
 *      pass_att: "0",
 *      pass_cmp: "0",
 *      pass_yds: "0",
 *      rush_att: "34",
 *      rush_yds: "182",
 *      rec: "1",
 *      rec_yds: "22",
 *      ...
 *   },
 *   "Tom Brady": { ... },
 *   ...
 * }
 *
 * return { passers, rushers, receivers }
 * where each is an array of { player, team, pass_yds, rush_yds, rec_yds, ... }
 */

export function splitOffenseStats(boxObj) {
  if (!boxObj || typeof boxObj !== "object") {
    return { passers: [], rushers: [], receivers: [] };
  }

  const passers = [];
  const rushers = [];
  const receivers = [];

  for (const key of Object.keys(boxObj)) {
    const row = boxObj[key] || {};
    const player = row.player || key;
    const team = row.team || null;

    // normalize numeric-ish fields (strings like "0", "", null)
    const pass_att = toNum(row.pass_att);
    const pass_cmp = toNum(row.pass_cmp);
    const pass_yds = toNum(row.pass_yds);
    const pass_td  = toNum(row.pass_td);
    const pass_int  = toNum(row.pass_int);

    const rush_att = toNum(row.rush_att);
    const rush_yds = toNum(row.rush_yds);
    const rush_td  = toNum(row.rush_td);

    const rec      = toNum(row.rec);        // receptions
    const targets  = toNum(row.targets);
    const rec_yds  = toNum(row.rec_yds);
    const rec_td   = toNum(row.rec_td);

    // --- PASSERS ---
    // We'll consider someone a passer if they have:
    // - any attempts > 0 OR
    // - any pass yards > 0 OR
    // - any pass TD > 0
    if ((pass_att > 0) || (pass_yds > 0) || (pass_td > 0)) {
      passers.push({
        player,
        team,
        pass_att,
        pass_cmp,
        pass_yds,
        pass_td,
        pass_int,
      });
    }

    // --- RUSHERS ---
    // We'll consider someone a rusher if they have:
    // - any rush attempts > 0 OR
    // - any rush yards > 0 OR
    // - any rush TDs > 0
    if ((rush_att > 0) || (rush_yds > 0) || (rush_td > 0)) {
      rushers.push({
        player,
        team,
        rush_att,
        rush_yds,
        rush_td,
      });
    }

    // --- RECEIVERS ---
    // We'll consider someone a receiver if they have:
    // - any targets > 0 OR
    // - any receptions > 0 OR
    // - any receiving yards > 0 OR
    // - any receiving TD > 0
    if ((targets > 0) || (rec > 0) || (rec_yds > 0) || (rec_td > 0)) {
      receivers.push({
        player,
        team,
        targets,
        receptions: rec,
        rec_yds,
        rec_td,
      });
    }
  }

  return { passers, rushers, receivers };
}

/** Safe numeric conversion */
function toNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}
