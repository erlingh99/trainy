import type { CSSProperties } from "react";

export type PaletteId =
  "default" | "forest" | "ocean" | "ember" | "amethyst" | "rose" | "nordic" | "obsidian";

export type Palette = {
  id: PaletteId;
  label: string;
  /** Three preview swatch colors: [primary, accent-bg, highlight] */
  swatches: [string, string, string];
};

export const PALETTES: Palette[] = [
  {
    id: "default",
    label: "Default",
    swatches: ["oklch(0.208 0.042 265.755)", "oklch(0.968 0.007 247.896)", "oklch(0.973 0.009 80)"],
  },
  {
    id: "forest",
    label: "Forest",
    swatches: ["oklch(0.30 0.20 145)", "oklch(0.85 0.12 145)", "oklch(0.962 0.026 145)"],
  },
  {
    id: "ocean",
    label: "Ocean",
    swatches: ["oklch(0.27 0.20 232)", "oklch(0.83 0.13 220)", "oklch(0.962 0.022 222)"],
  },
  {
    id: "ember",
    label: "Ember",
    swatches: ["oklch(0.42 0.26 28)", "oklch(0.86 0.14 58)", "oklch(0.962 0.032 58)"],
  },
  {
    id: "amethyst",
    label: "Amethyst",
    swatches: ["oklch(0.32 0.26 290)", "oklch(0.84 0.14 290)", "oklch(0.962 0.024 290)"],
  },
  {
    id: "rose",
    label: "Rose",
    swatches: ["oklch(0.42 0.26 5)", "oklch(0.85 0.14 5)", "oklch(0.962 0.028 5)"],
  },
  {
    id: "nordic",
    label: "Nordic",
    swatches: ["oklch(0.17 0.10 220)", "oklch(0.82 0.12 210)", "oklch(0.966 0.018 212)"],
  },
  {
    id: "obsidian",
    label: "Obsidian",
    swatches: ["oklch(0.14 0.03 258)", "oklch(0.22 0.05 258)", "oklch(0.78 0.22 170)"],
  },
];

export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

// ── Custom palette helpers ──────────────────────────────────────────

export function isCustomPalette(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("custom:");
}

export function parseCustomHue(value: string): number {
  const n = parseInt(value.slice(7), 10);
  return isNaN(n) ? 200 : Math.max(0, Math.min(359, n));
}

export function buildCustomVars(palette: string): CSSProperties {
  const h = parseCustomHue(palette);
  return {
    "--primary": `oklch(0.35 0.16 ${h})`,
    "--primary-foreground": `oklch(0.98 0.01 ${h})`,
    "--secondary": `oklch(0.93 0.05 ${h})`,
    "--secondary-foreground": `oklch(0.35 0.16 ${h})`,
    "--accent": `oklch(0.90 0.05 ${h})`,
    "--accent-foreground": `oklch(0.28 0.12 ${h})`,
    "--muted": `oklch(0.93 0.05 ${h})`,
    "--muted-foreground": `oklch(0.52 0.08 ${h})`,
    "--ring": `oklch(0.55 0.18 ${h})`,
    "--chart-1": `oklch(0.56 0.18 ${h})`,
    "--chart-2": `oklch(0.62 0.15 ${(h + 40) % 360})`,
    "--chart-3": `oklch(0.48 0.14 ${(h + 330) % 360})`,
    "--chart-4": `oklch(0.72 0.12 ${(h + 80) % 360})`,
    "--chart-5": `oklch(0.60 0.20 ${(h + 160) % 360})`,
  } as CSSProperties;
}

/** A representative swatch color for a custom palette value. */
export function customSwatchColor(palette: string): string {
  return `oklch(0.50 0.18 ${parseCustomHue(palette)})`;
}
