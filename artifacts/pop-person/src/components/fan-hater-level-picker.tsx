// @ts-nocheck
import React, { useState, useCallback } from "react";

const DEFAULT_HATER_LEVELS = [
  { key: "hater-1", emoji: "😐", name: "Incomodado", multiplier: 1 },
  { key: "hater-2", emoji: "🙄", name: "Aborrecido", multiplier: 10 },
  { key: "hater-3", emoji: "😒", name: "Irritado", multiplier: 25 },
  { key: "hater-4", emoji: "😠", name: "Contrariado", multiplier: 50 },
  { key: "hater-5", emoji: "😤", name: "Bravo", multiplier: 100 },
  { key: "hater-6", emoji: "😡", name: "Hostil", multiplier: 175 },
  { key: "hater-7", emoji: "🤬", name: "Furioso", multiplier: 275 },
  { key: "hater-8", emoji: "👿", name: "Revoltado", multiplier: 425 },
  { key: "hater-9", emoji: "💥", name: "Possesso", multiplier: 650 },
  { key: "hater-10", emoji: "🖕", name: "Enojado", multiplier: 1000 },
];

const DEFAULT_FAN_LEVELS = [
  { key: "fan-1", emoji: "🤔", name: "Curioso", multiplier: 1 },
  { key: "fan-2", emoji: "👀", name: "Interessado", multiplier: 10 },
  { key: "fan-3", emoji: "🙂", name: "Simpatizante", multiplier: 25 },
  { key: "fan-4", emoji: "👍", name: "Seguidor", multiplier: 50 },
  { key: "fan-5", emoji: "😊", name: "Fiel", multiplier: 100 },
  { key: "fan-6", emoji: "🤩", name: "Entusiasta", multiplier: 175 },
  { key: "fan-7", emoji: "😍", name: "Dedicado", multiplier: 275 },
  { key: "fan-8", emoji: "🔥", name: "Obcecado", multiplier: 425 },
  { key: "fan-9", emoji: "🗿", name: "Admirador", multiplier: 650 },
  { key: "fan-10", emoji: "❤️", name: "Fanático", multiplier: 1000 },
];

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

function resolveLevels(levels, mode) {
  const fallbackLevels = mode === "atacar" ? DEFAULT_HATER_LEVELS : DEFAULT_FAN_LEVELS;
  if (!levels?.length) return fallbackLevels;

  return levels.map((level, index) => {
    const fallback = fallbackLevels[index] ?? fallbackLevels[fallbackLevels.length - 1];
    const multiplier = Number(level.count);
    return {
      ...level,
      emoji: level.emoji || fallback.emoji,
      name: level.label || fallback.name,
      multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : fallback.multiplier,
      powerLabel: level.powerLabel || `${multiplier || fallback.multiplier}x`,
    };
  });
}

export default function FanHaterLevelPicker({
  mode,
  levels,
  value,
  defaultValue,
  onChange,
  basePrice = 0,
}) {
  const resolvedLevels = resolveLevels(levels, mode);
  const levelCount = resolvedLevels.length;
  const defaultIndex = Math.max(
    0,
    resolvedLevels.findIndex((level) => level.key === (defaultValue ?? value)),
  );
  const [internalIndex, setInternalIndex] = useState(defaultIndex);
  const currentIndex = Math.min(
    levelCount - 1,
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
  const title = mode === "atacar" ? "Nível de hate" : "Nível de fã";

  const setLevel = useCallback((nextIndex) => {
    const clampedIndex = Math.min(levelCount - 1, Math.max(0, nextIndex));
    if (value === undefined) setInternalIndex(clampedIndex);
    onChange?.(resolvedLevels[clampedIndex].key);
  }, [levelCount, onChange, resolvedLevels, value]);

  return (
    <div style={{
      width: "100%",
      background: "#1c1f26",
      borderRadius: 14,
      padding: "18px 20px 14px",
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e8eaed" }}>{title}</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: "#7a7f8a" }}>A partir de {formatPrice(basePrice)}</span>
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px 6px 8px",
          borderRadius: 14,
          background: accentBackground(currentIndex, levelCount, mode),
          border: `1px solid ${accentBorder(currentIndex, levelCount, mode)}`,
          boxShadow: glowPx > 0 ? `0 0 ${glowPx}px ${accentBackground(currentIndex, levelCount, mode)}` : "none",
          transition: "background 120ms ease, border-color 120ms ease",
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{currentLevel.emoji}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#e8eaed" }}>{currentLevel.name}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100, marginBottom: 10 }}>
        {resolvedLevels.map((level, index) => {
          const active = index <= currentIndex;
          const isCurrent = index === currentIndex;
          const levelT = easedT(index, levelCount);
          const barHeight = 8 + ((level.multiplier - Math.min(...resolvedLevels.map((item) => item.multiplier))) /
            (Math.max(...resolvedLevels.map((item) => item.multiplier)) - Math.min(...resolvedLevels.map((item) => item.multiplier)) || 1)) * 66;
          return (
            <button
              key={level.key}
              type="button"
              data-testid={`button-level-${level.key}`}
              aria-label={`Definir nível ${index + 1}: ${level.emoji} ${level.name}`}
              aria-pressed={isCurrent}
              onClick={() => setLevel(index)}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
            >
              <span style={{ width: "100%", maxWidth: 22, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                <span aria-hidden="true" style={{ lineHeight: 1, fontSize: 12 + levelT * 11, opacity: isCurrent ? 1 : 0.3 + levelT * 0.45, transition: "font-size 120ms ease, opacity 120ms ease" }}>{level.emoji}</span>
                <span style={{ width: "100%", height: barHeight, borderRadius: 3, background: active ? accent : "#3a3f4a", opacity: active ? 1 : 0.55, boxShadow: active && levelT > 0.6 ? `0 0 ${(levelT - 0.6) * 45}px ${accent}` : "none", transition: "background 120ms ease, opacity 120ms ease, height 120ms ease, box-shadow 120ms ease" }} />
              </span>
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
        <span aria-hidden="true" style={{ position: "absolute", top: 26, left: badgeLeft, transform: "translateX(-50%)", fontSize: 10, fontWeight: 500, color: accent, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {currentLevel.powerLabel || `${currentLevel.multiplier}x`}
        </span>
      </div>
    </div>
  );
}