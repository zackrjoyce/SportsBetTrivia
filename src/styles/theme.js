// src/styles/theme.js
export const palette = {
  pageBg: "#061b10",
  panelBg: "#0c2416",
  panelBgAlt: "#0f2f1c",
  text: "#eaf7ef",
  border: "#1f3d2a",
  borderAlt: "#29553a",
  borderField: "#254c35",
  accent: "#ffe066",
  green1: "#217346",
  green2: "#1a5a33",
  greenBorder: "#2d7a4a",
};

export const fonts = "'Jersey 10', sans-serif";

export const surfaces = {
  panel(maxWidth = 980) {
    return {
      maxWidth,
      margin: "0 auto",
      padding: "16px 16px 24px",
      fontFamily: fonts,
      color: palette.text,
      background: palette.panelBg,
      border: `1px solid ${palette.border}`,
      borderRadius: 12,
    };
  },
  button() {
    return {
      background: `linear-gradient(180deg, ${palette.green1}, ${palette.green2})`,
      color: palette.text,
      border: `1px solid ${palette.greenBorder}`,
      padding: "8px 14px",
      borderRadius: 10,
      fontWeight: 400,
      cursor: "pointer",
      letterSpacing: 0.2,
      transition: "transform 120ms ease, box-shadow 120ms ease",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)"
    };
  },
  pill() {
    return {
      background: "rgba(15,47,28,0.85)",
      border: `1px solid ${palette.borderAlt}`,
      borderRadius: 10,
      padding: "8px 12px",
      backdropFilter: "blur(4px)"
    };
  }
};
