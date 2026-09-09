export interface ColorToken {
  readonly hex: number;
  readonly css: string;
}

function token(css: string): ColorToken {
  return { hex: Number.parseInt(css.slice(1), 16), css };
}

export const theme = {
  font: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  background: token("#e8edf5"),
  text: token("#172033"),
  textMuted: token("#536077"),
  textMutedAlt: token("#66738a"),
  textMutedStrong: token("#435067"),
  panel: token("#f8fafc"),
  panelAlt: token("#fbfcfe"),
  panelSubtle: token("#f4f7fb"),
  border: token("#c9d1df"),
  borderStrong: token("#cfd7e6"),
  borderSubtle: token("#d5dce8"),
  accent: token("#1f5de2"),
  accentSelectedBg: token("#eef4ff"),
  connectable: token("#00a86b"),
  connectableSelectedBg: token("#dcfce7"),
  focusRing: token("#77a2ff"),
  diagnostic: token("#a14720"),
  white: token("#ffffff"),
  assetPlaceholderShared: token("#7d8aa2"),
  assetPlaceholderTemporary: token("#f2a93b"),
  selectionHighlight: token("#2f6df6"),
  placementGhost: token("#8a94a6"),
  radius: { sm: 6, md: 10, lg: 16 },
  shadowRgb: "15, 23, 42"
} as const;
