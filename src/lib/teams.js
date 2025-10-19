// src/lib/teams.js
export function parseTeamCode(teamField) {
  // "nwe season" -> "nwe"
  if (!teamField) return null;
  const m = String(teamField).trim().match(/^([a-z]{2,4})/i);
  return m ? m[1].toLowerCase() : null;
}

// Optional: map codes to pretty names (fallback to uppercased code)
const NAME_MAP = {
  nwe: "New England Patriots",
  oti: "Tennessee Titans",
  // add more as you need...
};

export function teamDisplayName(codeOrField) {
  const code = parseTeamCode(codeOrField) ?? String(codeOrField).slice(0,3).toLowerCase();
  return NAME_MAP[code] ?? code.toUpperCase();
}

// Optional: map to logo asset paths (adjust to your files)
const LOGO_MAP = {
  nwe: "/logos/patriots.png",
  oti: "/logos/titans.png",
  // ...
};

export function teamLogoPath(codeOrField) {
  const code = parseTeamCode(codeOrField);
  return (code && LOGO_MAP[code]) ? LOGO_MAP[code] : "/helmet.png";
}