// @ts-nocheck
import React, { useState, useCallback } from "react";

function easedT(index, count) {
  const raw = count > 1 ? index / (count - 1) : 0;
  return Math.pow(raw, 1.8);
}

function levelHsl(index, count, mode) {
  const t = easedT(index, count);
  const hue = mode === "atacar" ? 28 - t * 28 : 210 + t * 70;
  const sat = mode === "atacar" ? 62 + t * 30 : 60 + t * 32;
  const light = mode === "atacar" ? 56 - t * 16 : 60 - t * 12;
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
  const thumbSize = 20;
  const badgeLeft = `calc(${fillPct}% + ${(0.5 - fillPct / 100) * thumbSize}px)`;
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
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 20px;
          background: transparent;
          outline: none;
          margin: 0;
          padding: 0;
          border: 0;
        }
        .fan-hater-range::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          border-radius: 2px;
          border: 0;
          margin: 0;
          background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--fill-pct), #3a3f4a var(--fill-pct), #3a3f4a 100%);
        }
        .fan-hater-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          box-sizing: border-box;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent);
          border: 3px solid #1c1f26;
          box-shadow: 0 0 0 1px var(--accent), 0 0 var(--thumb-glow, 0px) var(--accent);
          cursor: pointer;
          margin-top: -8px;
        }
        .fan-hater-range::-moz-range-track {
          width: 100%;
          height: 4px;
          border-radius: 2px;
          border: 0;
          margin: 0;
          background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--fill-pct), #3a3f4a var(--fill-pct), #3a3f4a 100%);
        }
        .fan-hater-range::-moz-range-thumb {
          box-sizing: border-box;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent);
          border: 3px solid #1c1f26;
          box-shadow: 0 0 0 1px var(--accent), 0 0 var(--thumb-glow, 0px) var(--accent);
          cursor: pointer;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 17 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 25, lineHeight: 1 }}>{currentLevel.emoji}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 24, lineHeight: 1.1, fontWeight: 800, color: "#f4f4f5" }}>{currentLevel.name}</span>
        </div>
        <span data-testid="text-level-multiplier" style={{ flexShrink: 0, color: accent, fontSize: 28, lineHeight: 1, fontWeight: 900, letterSpacing: "-0.04em" }}>{currentLevel.multiplier}x</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", overflowX: "auto", padding: "3px 2px 8px", scrollbarWidth: "none" }}>
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
                flex: "0 0 34px",
                width: 34,
                height: 34,
                padding: 0,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background: isCurrent ? accent : "#25282e",
                border: isCurrent ? `3px solid ${accent}` : "1px solid #3a3f47",
                boxShadow: isCurrent ? `0 0 0 4px ${accentBackground(currentIndex, levelCount, mode)}, 0 0 ${glowPx}px ${accent}` : "none",
                cursor: "pointer",
                transform: isCurrent ? "scale(1.08)" : "scale(1)",
                transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 15 + levelT * 7, lineHeight: 1, filter: isCurrent ? "none" : "grayscale(0.35)", opacity: isCurrent ? 1 : 0.7 }}>{level.emoji}</span>
            </button>
          );
        })}
      </div>

      <div style={{ position: "relative", paddingBottom: 28 }}>
        <input
          className="fan-hater-range"
          data-testid="input-intensity"
          type="range"
          min={0}
          max={Math.max(0, levelCount - 1)}
          step={1}
          value={currentIndex}
          onChange={(event) => setLevel(Number(event.target.value))}
          style={{ "--accent": accent, "--fill-pct": `${fillPct}%`, "--thumb-glow": `${glowPx}px` }}
          aria-label={title}
        />
      </div>
    </div>
  );
}