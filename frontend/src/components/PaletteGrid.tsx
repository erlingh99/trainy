import { Check, Pipette } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PALETTES, isCustomPalette, parseCustomHue, customSwatchColor } from "@/lib/palettes";
import { cn } from "@/lib/utils";

const HUE_GRADIENT =
  "linear-gradient(to right, hsl(0,75%,55%), hsl(30,75%,55%), hsl(60,75%,55%), hsl(90,75%,55%), hsl(120,75%,55%), hsl(150,75%,55%), hsl(180,75%,55%), hsl(210,75%,55%), hsl(240,75%,55%), hsl(270,75%,55%), hsl(300,75%,55%), hsl(330,75%,55%), hsl(360,75%,55%))";

interface PaletteGridProps {
  value: string | null | undefined;
  onChange: (palette: string | null) => void;
}

export function PaletteGrid({ value, onChange }: PaletteGridProps) {
  const { t } = useTranslation();

  const isCustom = isCustomPalette(value);
  const customHue = isCustom ? parseCustomHue(value) : 200;
  const activePresetId = isCustom ? null : (value ?? "default");

  return (
    <div className="space-y-2">
      {/* ── Preset tiles ── */}
      <div className="grid grid-cols-4 gap-2">
        {PALETTES.map((p) => {
          const isActive = p.id === activePresetId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id === "default" ? null : p.id)}
              className={cn(
                "relative flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-accent",
                isActive && "ring-2 ring-primary ring-offset-1",
              )}
              title={t(`palette.${p.id}` as never, { defaultValue: p.label })}
            >
              <div className="h-10 w-full overflow-hidden rounded-md shadow-sm">
                <div className="h-[40%] w-full" style={{ background: p.swatches[0] }} />
                <div className="h-[35%] w-full" style={{ background: p.swatches[1] }} />
                <div className="h-[25%] w-full" style={{ background: p.swatches[2] }} />
              </div>
              <span className="w-full truncate text-center text-[9px] font-medium leading-none text-muted-foreground">
                {t(`palette.${p.id}` as never, { defaultValue: p.label })}
              </span>
              {isActive && (
                <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2 w-2" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Custom section ── */}
      <div
        className={cn(
          "rounded-lg border transition-colors",
          isCustom ? "border-primary/50 bg-accent/20" : "border-border",
        )}
      >
        {/* Header row — always visible, click to activate custom */}
        <button
          type="button"
          onClick={() => onChange(`custom:${customHue}`)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-accent/40"
        >
          <div
            className="h-6 w-full max-w-[80px] flex-shrink-0 rounded"
            style={{ background: isCustom ? customSwatchColor(value!) : HUE_GRADIENT }}
          />
          <span className="flex-1 text-left text-xs font-medium">{t("palette.custom")}</span>
          {isCustom ? (
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
          ) : (
            <Pipette className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Hue slider — only when custom is active */}
        {isCustom && (
          <div className="px-3 pb-3">
            <input
              type="range"
              min={0}
              max={359}
              value={customHue}
              onChange={(e) => onChange(`custom:${e.target.value}`)}
              className="hue-slider w-full"
              style={{ background: HUE_GRADIENT }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {t("palette.hue")}: {customHue}°
              </span>
              <div className="flex items-center gap-1.5">
                {/* Accent preview */}
                <div
                  className="h-4 w-8 rounded-sm"
                  style={{ background: `oklch(0.90 0.05 ${customHue})` }}
                />
                {/* Primary preview */}
                <div
                  className="h-4 w-8 rounded-sm"
                  style={{ background: `oklch(0.55 0.18 ${customHue})` }}
                />
                {/* Deep preview */}
                <div
                  className="h-4 w-8 rounded-sm"
                  style={{ background: `oklch(0.35 0.16 ${customHue})` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
