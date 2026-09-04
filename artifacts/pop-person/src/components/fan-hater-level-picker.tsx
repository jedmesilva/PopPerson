// @ts-nocheck
import React, { useState, useCallback } from "react";

function easedT(index, count) {
  const raw = count > 1 ? index / (count - 1) : 0;
  return Math.pow(raw, 1.8);
}

const LEVEL_COLOR_STOPS = {
  atacar: {
    start: { hue: 28, sat: 62, light: 56 },
    end: { hue: 1, sat: 100, light: 69 },
  },
  defender: {
    start: { hue: 210, sat: 60, light: 60 },
    end: { hue: 338, sat: 69, light: 60 },
  },
};

function levelHsl(index, count, mode) {
  const t = easedT(index, count);
  const stops = LEVEL_COLOR_STOPS[mode] ?? LEVEL_COLOR_STOPS.atacar;
  const hue = stops.start.hue + (stops.end.hue - stops.start.hue) * t;
  const sat = stops.start.sat + (stops.end.sat - stops.start.sat) * t;
  const light = stops.start.light + (stops.end.light - stops.start.light) * t;
  return { hue, sat, light };
}

function colorForLevel(index, count, mode) {
  const { hue, sat, light } = levelHsl(index, count, mode);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function accentBackground(index, count, mode) {
  const { hue, sat, light } = levelHsl(index, count, mode);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.22)`;
}

function accentBorder(index, count, mode) {
  const { hue, sat, light } = levelHsl(index, count, mode);
  return `hsla(${hue}, ${sat}%, ${light}%, 0.5)`;
}

function formatPrice(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? `R$ ${numericValue.toFixed(2).replace(".", ",")}`
    : "—";
}

function resolveLevels(levels) {
  return (levels ?? []).map((level) => ({
    ...level,
    name: level.name,
    multiplier: Number(level.multiplier),
  }));
}

export default function FanHaterLevelPicker({
  mode,
  levels,
  value,
  defaultValue,
  onChange,
  basePrice = 0,
}) {
  const resolvedLevels = resolveLevels(levels);
  const levelCount = resolvedLevels.length;
  const defaultIndex = Math.max(
    0,
    resolvedLevels.findIndex((level) => level.key === (defaultValue ?? value)),
  );
  const [internalIndex, setInternalIndex] = useState(Math.max(0, defaultIndex));
  const currentIndex = Math.min(
    Math.max(0, levelCount - 1),
    Math.max(
      0,
      value === undefined
        ? internalIndex
        : Math.max(0, resolvedLevels.findIndex((level) => level.key === value)),
    ),
  );
  const currentLevel = resolvedLevels[currentIndex];
  const accent = colorForLevel(currentIndex, levelCount, mode);
  const t = easedT(currentIndex, levelCount);
  const glowPx = t > 0.6 ? (t - 0.6) * 40 : 0;
  const fillPct = levelCount > 1 ? (currentIndex / (levelCount - 1)) * 100 : 0;
  // Keep the discrete icon centers and the slider thumb on the same track.
  // The inset accounts for the first and last grid cell centers.
  const trackInsetPct = levelCount > 1 ? 50 / levelCount : 50;
  const thumbPct = levelCount > 1
    ? trackInsetPct + ((100 - trackInsetPct * 2) * fillPct) / 100
    : 50;
  const title = mode === "atacar" ? "NÍVEL DE HATE" : "NÍVEL DE FÃ";

  const setLevel = useCallback((nextIndex) => {
    const clampedIndex = Math.min(levelCount - 1, Math.max(0, nextIndex));
    if (value === undefined) setInternalIndex(clampedIndex);
    if (resolvedLevels[clampedIndex]) onChange?.(resolvedLevels[clampedIndex].key);
  }, [levelCount, onChange, resolvedLevels, value]);

  if (levelCount === 0) {
    return (
      <div style={{ width: "100%", padding: "18px", borderRadius: 14, background: "#1c1f26", color: "#a3a3a3", fontSize: 13 }}>
        Nenhum nível disponível para esta ação.
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      background: "transparent",
      borderRadius: 14,
      boxSizing: "border-box",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <style>{`
        .fan-hater-range {
          position: absolute;
          inset: -12px 0;
          z-index: 3;
          opacity: 0;
          cursor: pointer;
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 38px;
          background: transparent;
          outline: none;
          margin: 0;
          padding: 0;
          border: 0;
        }
        .fan-hater-range:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 5px;
          opacity: 0.01;
        }
        .fan-hater-range::-webkit-slider-runnable-track {
          background: transparent;
          border: 0;
        }
        .fan-hater-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border: 0;
          background: transparent;
        }
        .fan-hater-range::-moz-range-track {
          background: transparent;
          border: 0;
        }
        .fan-hater-range::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border: 0;
          background: transparent;
        }
        .fan-hater-range-visual {
          position: absolute;
          top: 50%;
          height: 6px;
          transform: translateY(-50%);
          border-radius: 999px;
          pointer-events: none;
        }
        .fan-hater-range-thumb {
          position: absolute;
          top: 50%;
          width: 20px;
          height: 20px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          box-sizing: border-box;
          border: 3px solid #1c1f26;
          pointer-events: none;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 17 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 25, lineHeight: 1 }}>{currentLevel.emoji}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 24, lineHeight: 1.1, fontWeight: 800, color: "#f4f4f5" }}>{currentLevel.name}</span>
        </div>
        <span data-testid="text-level-multiplier" style={{ flexShrink: 0, color: accent, fontSize: 28, lineHeight: 1, fontWeight: 900, letterSpacing: "-0.04em" }}>{currentLevel.multiplier}x</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${levelCount}, minmax(0, 1fr))`, alignItems: "center", width: "100%", overflow: "visible", padding: "5px 0 11px" }}>
        {resolvedLevels.map((level, index) => {
          const isCurrent = index === currentIndex;
          const levelT = easedT(index, levelCount);
          return (
            <button
              key={level.key}
              type="button"
              data-testid={`button-level-${level.key}`}
              aria-label={`Definir nível ${index + 1}: ${level.emoji} ${level.name}`}
              aria-pressed={isCurrent}
              onClick={() => setLevel(index)}
              style={{
                width: "100%",
                minWidth: 0,
                height: 34,
                padding: 0,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <span aria-hidden="true" style={{ width: 34, height: 34, display: "grid", placeItems: "center", boxSizing: "border-box", borderRadius: "50%", background: isCurrent ? accent : "#25282e", border: isCurrent ? `3px solid ${accent}` : "1px solid #3a3f47", boxShadow: isCurrent ? `0 0 0 4px ${accentBackground(currentIndex, levelCount, mode)}, 0 0 ${glowPx}px ${accent}` : "none", transform: isCurrent ? "scale(1.08)" : "scale(1)", transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease", fontSize: 15 + levelT * 7, lineHeight: 1, filter: isCurrent ? "none" : "grayscale(0.35)", opacity: isCurrent ? 1 : 0.7 }}>{level.emoji}</span>
            </button>
          );
        })}
      </div>

      <div style={{ position: "relative", height: 30, margin: "0 0 7px" }}>
        <span className="fan-hater-range-visual" aria-hidden="true" style={{ left: `${trackInsetPct}%`, right: `${trackInsetPct}%`, background: "#3a3f4a" }} />
        <span className="fan-hater-range-visual" aria-hidden="true" style={{ left: `${trackInsetPct}%`, width: `${thumbPct - trackInsetPct}%`, background: accent }} />
        <span className="fan-hater-range-thumb" aria-hidden="true" style={{ left: `${thumbPct}%`, background: accent, boxShadow: `0 0 0 1px ${accent}, 0 0 ${glowPx}px ${accent}` }} />
        <input
          className="fan-hater-range"
          data-testid="input-intensity"
          type="range"
          min={0}
          max={Math.max(0, levelCount - 1)}
          step={1}
          value={currentIndex}
          onChange={(event) => setLevel(Number(event.target.value))}
          style={{ "--accent": accent }}
          aria-label={title}
        />
      </div>
    </div>
  );
}