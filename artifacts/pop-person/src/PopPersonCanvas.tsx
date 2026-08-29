// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { SlidersHorizontal, ArrowLeft, X, ChevronDown, Locate, Search } from "lucide-react";
import {
  useCreatePopPersonAction,
  useGetAccessLocation,
  useGetPopPerson,
  useGetPopPersonState,
} from "@workspace/api-client-react";

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

function quadBezier(p0, p1, p2, t) {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function quadBezierTangent(p0, p1, p2, t) {
  return 2 * (1 - t) * (p1 - p0) + 2 * t * (p2 - p1);
}

const MODE_LABEL = { atacar: "Ataque", defender: "Defesa" };
const MAX_CONCURRENT_PROJECTILES = 24;
const LAYOUT_PADDING = 2;
const CIRCLE_GAP = 2.5;

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function normalizeLocationValue(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

function formatBRL(value) {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function getActionTotalPrice(element, actionRule) {
  if (!element || !actionRule) return null;

  const itemPrice = Number(element.price);
  const intensityCount = Number(actionRule.count);
  const apiPrice = Number(actionRule.price);

  if (!Number.isFinite(itemPrice) || !Number.isFinite(intensityCount)) return null;

  // `price` is normally the server-calculated total. The fallback keeps the
  // preview correct when an older API response still contains the item's unit
  // price instead of the intensity total. Explicit price overrides remain
  // authoritative because they differ from the unit-price x count calculation.
  const calculatedTotal = itemPrice * intensityCount;
  if (!Number.isFinite(apiPrice) || (apiPrice === itemPrice && calculatedTotal !== itemPrice)) {
    return calculatedTotal;
  }

  return apiPrice;
}

function tryPackCircles(ordered, baseRadii, scale) {
  const placed = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const r = baseRadii[index] * scale;
    const candidates = [{ x: 50, y: 50 }];

    // Candidate points tangent to already placed circles are much more reliable
    // than increasing one spiral radius until it happens to find a gap.
    placed.forEach((other, otherIndex) => {
      for (let step = 0; step < 32; step += 1) {
        const angle = otherIndex * 0.73 + (step / 32) * Math.PI * 2;
        const distance = other.r + r + CIRCLE_GAP;
        candidates.push({
          x: other.x + Math.cos(angle) * distance,
          y: other.y + Math.sin(angle) * distance,
        });
      }
    });

    // Include a dense center-out search so the pack can use corners and edges
    // when the tangent candidates for a greedy step are all blocked.
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const angle = attempt * 2.3999632297;
      const distance = Math.sqrt(attempt) * 2.4;
      candidates.push({
        x: 50 + Math.cos(angle) * distance,
        y: 50 + Math.sin(angle) * distance,
      });
    }

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const inside =
        candidate.x - r >= LAYOUT_PADDING &&
        candidate.x + r <= 100 - LAYOUT_PADDING &&
        candidate.y - r >= LAYOUT_PADDING &&
        candidate.y + r <= 100 - LAYOUT_PADDING;
      const clear =
        inside &&
        placed.every(
          (other) =>
            Math.hypot(candidate.x - other.x, candidate.y - other.y) >=
            r + other.r + CIRCLE_GAP,
        );
      if (!clear) continue;

      const score = Math.hypot(candidate.x - 50, candidate.y - 50);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    // Never clamp an invalid candidate into the board: that is what caused
    // cells to land on top of their neighbors in the previous layout.
    if (!best) return null;
    placed.push({
      ...ordered[index],
      x: best.x,
      y: best.y,
      r,
      color: ordered[index].color,
    });
  }
  return placed;
}

// A small local circle pack keeps the original self-contained behavior without an API
// or runtime dependency. Circles remain proportional and are normalized to the canvas world.
function computeLeaves(data) {
  if (data.length === 0) return [];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const ordered = [...data].sort((a, b) => b.value - a.value);
  const baseRadii = ordered.map((item) => Math.max(7.2, Math.sqrt(item.value / total) * 47));

  // A layout can become temporarily impossible after a value grows or a filter
  // changes. Reduce all radii together until there is a valid, separated pack.
  for (let scale = 1; scale >= 0.5; scale -= 0.025) {
    const packed = tryPackCircles(ordered, baseRadii, scale);
    if (packed) return packed;
  }

  // This is only a last-resort safety net for unusually large datasets. It still
  // preserves the non-overlap invariant by using a conservative minimum radius.
  return tryPackCircles(ordered, baseRadii, 0.5) || [];
}

function keepCirclesSeparated(circles) {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let moved = false;

    circles.forEach((circle) => {
      circle.x = Math.min(100 - LAYOUT_PADDING - circle.r, Math.max(LAYOUT_PADDING + circle.r, circle.x));
      circle.y = Math.min(100 - LAYOUT_PADDING - circle.r, Math.max(LAYOUT_PADDING + circle.r, circle.y));
    });

    for (let first = 0; first < circles.length; first += 1) {
      for (let second = first + 1; second < circles.length; second += 1) {
        const a = circles[first];
        const b = circles[second];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minimumDistance = a.r + b.r + CIRCLE_GAP;
        if (distance >= minimumDistance) continue;

        if (distance < 0.001) {
          const angle = (first + 1) * 2.3999632297;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const push = (minimumDistance - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function FilterSection({ label, options, selected, onSelect, disabled, disabledHint }) {
  const isActive = selected !== "Todos";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
      <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <select
          data-testid={`select-filter-${label.toLowerCase()}`}
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          style={{
            width: "100%", appearance: "none", WebkitAppearance: "none", padding: "10px 30px 10px 10px",
            borderRadius: "10px", border: isActive ? "1px solid #6366f1" : "1px solid #333",
            backgroundColor: disabled ? "#1a1a1a" : isActive ? "rgba(99, 102, 241, 0.12)" : "#262626",
            color: disabled ? "#525252" : isActive ? "#c7d2fe" : "#f5f5f5", fontSize: "12px",
            fontWeight: isActive ? 700 : 500, cursor: disabled ? "not-allowed" : "pointer",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {options.map((opt) => {
            const value = typeof opt === "string" ? opt : opt.value;
            const label = typeof opt === "string" ? opt : opt.label;
            return <option key={value} value={value} style={{ backgroundColor: "#171717", color: "#f5f5f5" }}>{label}</option>;
          })}
        </select>
        <ChevronDown size={14} style={{ position: "absolute", right: "9px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: disabled ? "#404040" : isActive ? "#c7d2fe" : "#737373" }} />
      </div>
      {disabled && disabledHint && <span style={{ color: "#525252", fontSize: "10px" }}>{disabledHint}</span>}
    </div>
  );
}

function ItemVisual({ element, size = 22 }) {
  if (element?.imageUrl) {
    return <img src={element.imageUrl} alt="" style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain", flexShrink: 0 }} />;
  }
  return <span style={{ fontSize: `${size}px`, lineHeight: 1, flexShrink: 0 }}>{element?.emoji}</span>;
}

function PersonVisual({ person, alt = "", style = {} }) {
  if (!person) return null;
  return (
    <div style={{ position: "relative", overflow: "hidden", backgroundColor: person.color, ...style }}>
      {person.imageUrl && (
        <img
          src={person.imageUrl}
          alt={alt}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </div>
  );
}

export default function PopPersonCanvas() {
  const accessLocationQuery = useGetAccessLocation();
  const bootstrapQuery = useGetPopPerson({
    query: {
      // Resolve location first so the first page request and the location
      // event share the same anonymous session cookie.
      enabled: accessLocationQuery.isFetched,
    },
  });
  const stateQuery = useGetPopPersonState({
    query: {
      enabled: Boolean(bootstrapQuery.data),
      refetchInterval: 1000,
    },
  });
  const createActionMutation = useCreatePopPersonAction();
  const canvasRef = useRef(null);
  const boardWrapRef = useRef(null);
  const [dataset, setDataset] = useState([]);
  const [filters, setFilters] = useState({ pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" });
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [pendingMode, setPendingMode] = useState(null);
  const [modalStep, setModalStep] = useState("elemento");
  const [modalElement, setModalElement] = useState(null);
  const [modalLevel, setModalLevel] = useState("");
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [queue, setQueue] = useState([]);
  const [activeActions, setActiveActions] = useState([]);
  const [showRecenter, setShowRecenter] = useState(false);
  const [, forceTick] = useState(0);
  const locationDefaultsAppliedRef = useRef(false);
  const config = bootstrapQuery.data?.config;
  const elements = config?.elements ?? { atacar: [], defender: [] };
  const levels = config?.levels ?? [];
  const levelByKey = useMemo(() => Object.fromEntries(levels.map((level) => [level.key, level])), [levels]);
  const levelKeys = useMemo(() => levels.map((level) => level.key), [levels]);
  const actionRuleByKey = useMemo(
    () => Object.fromEntries((config?.actionRules ?? []).map((rule) => [`${rule.elementId}:${rule.level}`, rule])),
    [config?.actionRules],
  );
  const selectedActionRule = modalElement
    ? actionRuleByKey[`${modalElement.id}:${modalLevel}`]
    : null;
  const selectedActionPrice = getActionTotalPrice(modalElement, selectedActionRule);

  const paisOptions = useMemo(() => {
    const options = new Map(
      dataset
        .filter((person) => person.pais)
        .map((person) => [person.pais, { value: person.pais, label: person.pais }]),
    );
    return [
      { value: "Todos", label: "Todos" },
      ...Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    ];
  }, [dataset]);
  const estadoOptions = useMemo(() => {
    const scoped = filters.pais === "Todos" ? dataset : dataset.filter((d) => d.pais === filters.pais);
    const options = new Map(
      scoped
        .filter((person) => person.estado)
        .map((person) => [
          person.estado,
          {
            value: person.estado,
            label: person.estadoCodigo && person.estadoCodigo !== person.estado
              ? `${person.estado} (${person.estadoCodigo})`
              : person.estado,
          },
        ]),
    );
    return [
      { value: "Todos", label: "Todos" },
      ...Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    ];
  }, [dataset, filters.pais]);
  const cidadeOptions = useMemo(() => {
    const scoped = dataset.filter((d) => (filters.pais === "Todos" || d.pais === filters.pais) && (filters.estado === "Todos" || d.estado === filters.estado));
    const options = new Map(
      scoped
        .filter((person) => person.cidade)
        .map((person) => [person.cidade, { value: person.cidade, label: person.cidade }]),
    );
    return [
      { value: "Todos", label: "Todos" },
      ...Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    ];
  }, [dataset, filters.pais, filters.estado]);
  const categoriaOptions = useMemo(() => {
    const categories = new Map();
    dataset.forEach((person) => {
      person.categoryPath.forEach((category) => {
        if (!categories.has(category.id)) {
          categories.set(category.id, {
            value: category.id,
            label: person.categoryPath.map((item) => item.name).slice(
              0,
              person.categoryPath.findIndex((item) => item.id === category.id) + 1,
            ).join(" / "),
          });
        }
      });
    });
    return [{ value: "Todos", label: "Todos" }, ...Array.from(categories.values()).sort((a, b) => a.label.localeCompare(b.label))];
  }, [dataset]);
  const setFilterLevel = useCallback((level, value) => {
    setFilters((prev) => level === "pais"
      ? { pais: value, estado: "Todos", cidade: "Todos", categoria: prev.categoria }
      : level === "estado"
        ? { ...prev, estado: value, cidade: "Todos" }
        : level === "cidade"
          ? { ...prev, cidade: value }
          : { ...prev, categoria: value });
  }, []);
  const clearFilters = useCallback(() => setFilters({ pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" }), []);
  const activeFilterCount = (filters.pais !== "Todos" ? 1 : 0) + (filters.estado !== "Todos" ? 1 : 0) + (filters.cidade !== "Todos" ? 1 : 0) + (filters.categoria !== "Todos" ? 1 : 0);
  const filteredDataset = useMemo(() => dataset.filter((d) => (filters.pais === "Todos" || d.pais === filters.pais) && (filters.estado === "Todos" || d.estado === filters.estado) && (filters.cidade === "Todos" || d.cidade === filters.cidade) && (filters.categoria === "Todos" || d.categoryPath.some((category) => category.id === filters.categoria))), [dataset, filters]);
  const leaves = useMemo(() => computeLeaves(filteredDataset), [filteredDataset]);

  useEffect(() => {
    const location = accessLocationQuery.data;
    if (locationDefaultsAppliedRef.current || !location || dataset.length === 0) return;
    locationDefaultsAppliedRef.current = true;
    if (location.source !== "ip") return;

    const countryMatch = dataset.find(
      (person) => normalizeLocationValue(person.paisCodigo) === normalizeLocationValue(location.countryCode),
    );
    const selectedCountry = countryMatch?.pais ?? "Todos";
    const countryDataset = countryMatch
      ? dataset.filter((person) => person.pais === selectedCountry)
      : [];
    const stateMatch = countryMatch && location.regionCode !== "—"
      ? countryDataset.find(
          (person) => normalizeLocationValue(person.estadoCodigo) === normalizeLocationValue(location.regionCode),
        )
      : null;
    const selectedState = stateMatch?.estado ?? "Todos";
    const stateDataset = stateMatch
      ? countryDataset.filter((person) => person.estado === selectedState)
      : [];
    const cityMatch = stateMatch && location.city !== "—"
      ? stateDataset.find(
          (person) => normalizeLocationValue(person.cidade) === normalizeLocationValue(location.city),
        )
      : null;

    setFilters({
      pais: selectedCountry,
      estado: selectedState,
      cidade: cityMatch?.cidade ?? "Todos",
      categoria: "Todos",
    });
  }, [accessLocationQuery.data, dataset]);

  const leavesRef = useRef([]);
  const selectedCellRef = useRef(null);
  const animatedCirclesRef = useRef(new Map());
  const emittersRef = useRef([]);
  const projectilesRef = useRef([]);
  const impactsRef = useRef([]);
  const personImagesRef = useRef(new Map());
  const shakeActionIdsRef = useRef(new Set());
  const activeActionIdsRef = useRef([]);
  const seenServerActionIdsRef = useRef(new Set());
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const fitTransformRef = useRef({ x: 0, y: 0, scale: 1 });
  const recenterAnimRef = useRef(null);
  const showRecenterRef = useRef(false);
  useEffect(() => { leavesRef.current = leaves; }, [leaves]);
  useEffect(() => { selectedCellRef.current = selectedCell; }, [selectedCell]);
  useEffect(() => { activeActionIdsRef.current = activeActions.map((a) => a.id); }, [activeActions]);
  useEffect(() => {
    const currentNames = new Set(dataset.map((person) => person.name));
    for (const name of personImagesRef.current.keys()) {
      if (!currentNames.has(name)) personImagesRef.current.delete(name);
    }
    dataset.forEach((person) => {
      const existing = personImagesRef.current.get(person.name);
      if (!person.imageUrl || existing?.src === person.imageUrl || existing === null) return;
      const image = new Image();
      image.onload = () => {
        // The canvas animation loop continuously redraws, so the loaded image
        // becomes visible without triggering a React render.
      };
      image.onerror = () => {
        personImagesRef.current.set(person.name, null);
      };
      image.src = person.imageUrl;
      personImagesRef.current.set(person.name, image);
    });
  }, [dataset]);

  const executeAction = useCallback((serverAction) => {
    const direction = serverAction.mode === "defender" ? 1 : -1;
    const actionElement = serverAction.element;
    const firingId = Date.now() + Math.random();
    emittersRef.current.push({
      id: firingId,
      targetName: serverAction.targetName,
      remaining: serverAction.count,
      staggerMs: serverAction.staggerMs,
      duration: serverAction.duration,
      growthPerHit: serverAction.growthPerHit,
      impactMultiplier: serverAction.impactMultiplier,
      direction,
      emoji: actionElement.emoji,
      level: serverAction.level,
      nextSpawnTime: performance.now(),
    });
    setActiveActions((prev) => [
      ...prev,
      {
        id: firingId,
        mode: serverAction.mode,
        level: serverAction.level,
        element: actionElement,
        targetName: serverAction.targetName,
        count: serverAction.count,
        firedAt: performance.now(),
      },
    ]);
    if (serverAction.shake) shakeActionIdsRef.current.add(firingId);
  }, []);
  const executeActionRef = useRef(executeAction);
  useEffect(() => { executeActionRef.current = executeAction; }, [executeAction]);
  const queueAction = useCallback((serverAction) => {
    const localExecuteAt = performance.now() + Math.max(0, serverAction.executeAt - Date.now());
    setQueue((prev) => [...prev, { ...serverAction, executeAt: localExecuteAt }]);
  }, []);
  const reconcileServerState = useCallback((serverState) => {
    if (serverState?.dataset) setDataset(serverState.dataset);
    if (!Array.isArray(serverState?.actions)) return;

    serverState.actions.forEach((serverAction) => {
      if (seenServerActionIdsRef.current.has(serverAction.id)) return;
      if (serverAction.status === "completed") return;
      seenServerActionIdsRef.current.add(serverAction.id);
      queueAction(serverAction);
    });
  }, [queueAction]);
  useEffect(() => {
    if (bootstrapQuery.data?.state) {
      reconcileServerState(bootstrapQuery.data.state);
    }
  }, [bootstrapQuery.data, reconcileServerState]);
  useEffect(() => {
    if (stateQuery.data) {
      reconcileServerState(stateQuery.data);
    }
  }, [stateQuery.data, reconcileServerState]);

  useEffect(() => {
    if (!config) return undefined;

    let socket;
    let retryTimer;
    let stopped = false;

    function connect() {
      socket = new WebSocket(getWebSocketUrl());

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (!message?.state?.dataset || !Array.isArray(message.state.actions)) return;

           reconcileServerState(message.state);
        } catch {
          // Ignore malformed messages and let the polling fallback reconcile state.
        }
      };

      socket.onclose = () => {
        if (!stopped) retryTimer = window.setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [config, reconcileServerState]);
  const getRemainingUnits = useCallback((item) => {
    const emitter = emittersRef.current.find((e) => e.id === item.id);
    return (emitter ? emitter.remaining : 0) + projectilesRef.current.filter((p) => p.firingId === item.id).length;
  }, []);
  const getActionTiming = useCallback((item, now) => {
    if (item.kind === "queued") {
      const secondsLeft = Math.max(0, (item.executeAt - now) / 1000);
      const delayMs = Math.max(0, item.startDelayMs);
      return { timeLabel: secondsLeft > 0 ? `Inicia em ${secondsLeft.toFixed(1)}s` : "Iniciando", progress: delayMs > 0 ? 1 - (secondsLeft * 1000) / delayMs : 1 };
    }
    const totalCount = item.count;
    if (!totalCount) return { timeLabel: "—", progress: 0 };
    const emitter = emittersRef.current.find((e) => e.id === item.id);
    const inFlight = projectilesRef.current.filter((p) => p.firingId === item.id).length;
    const landed = Math.max(0, totalCount - (emitter ? emitter.remaining : 0) - inFlight);
    return { timeLabel: `${Math.round(Math.min(1, landed / totalCount) * 100)}%`, progress: Math.min(1, landed / totalCount) };
  }, []);

  useEffect(() => {
    if (queue.length === 0 && activeActions.length === 0) return undefined;
    let hudRaf;
    function hudTick() {
      const now = performance.now();
      setQueue((prev) => {
        const stillPending = prev.filter((a) => a.executeAt > now);
        if (stillPending.length !== prev.length) {
          prev.filter((a) => a.executeAt <= now).forEach((a) => executeActionRef.current(a));
        }
        return stillPending;
      });
      forceTick((t) => t + 1);
      hudRaf = requestAnimationFrame(hudTick);
    }
    hudRaf = requestAnimationFrame(hudTick);
    return () => cancelAnimationFrame(hudRaf);
  }, [queue.length > 0, activeActions.length > 0]);
  useEffect(() => { if (queue.length === 0 && activeActions.length === 0) setShowQueueModal(false); }, [queue.length, activeActions.length]);

  const selectCell = useCallback((name) => setSelectedCell((prev) => prev === name ? null : name), []);
  const openModal = useCallback((mode) => {
    setPendingMode(mode);
    setModalStep("elemento");
    setModalElement(null);
    setModalLevel(levels[0]?.key ?? "");
  }, [levels]);
  const closeModal = useCallback(() => setPendingMode(null), []);
  const pickElement = useCallback((element) => { setModalElement(element); setModalStep("intensidade"); }, []);
  const confirmAction = useCallback(() => {
    if (!pendingMode || !modalElement || !selectedCell) return;
    createActionMutation.mutate(
      {
        data: {
          mode: pendingMode,
          elementId: modalElement.id,
          level: modalLevel,
          targetName: selectedCell,
          idempotencyKey: crypto.randomUUID(),
        },
      },
      {
        onSuccess: (action) => {
          const alreadySeen = seenServerActionIdsRef.current.has(action.id);
          seenServerActionIdsRef.current.add(action.id);
          if (!alreadySeen) queueAction(action);
          closeModal();
          setSelectedCell(null);
        },
      },
    );
  }, [pendingMode, modalElement, modalLevel, selectedCell, queueAction, closeModal, createActionMutation]);
  const selectedCellData = useMemo(() => leaves.find((l) => l.name === selectedCell) || null, [leaves, selectedCell]);

  function cssSize() {
    const r = boardWrapRef.current.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  const fitToView = useCallback(() => {
    if (!boardWrapRef.current) return;
    const { w: cw, h: ch } = cssSize();
    const scale = Math.min((cw - 32) / 100, (ch - 32) / 100);
    const fit = { scale, x: (cw - 100 * scale) / 2, y: (ch - 100 * scale) / 2 };
    fitTransformRef.current = fit;
    transformRef.current = fit;
  }, []);
  const recenterView = useCallback(() => {
    recenterAnimRef.current = { from: { ...transformRef.current }, to: { ...fitTransformRef.current }, startTime: performance.now(), duration: 380 };
  }, []);
  const clampScale = (s) => Math.min(Math.max(s, 0.6), 40);
  const seedMissingRects = useCallback(() => {
    const names = new Set();
    leavesRef.current.forEach((l) => {
      names.add(l.name);
      if (!animatedCirclesRef.current.has(l.name)) animatedCirclesRef.current.set(l.name, { x: l.x, y: l.y, r: l.r });
    });
    for (const key of animatedCirclesRef.current.keys()) if (!names.has(key)) animatedCirclesRef.current.delete(key);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !boardWrapRef.current) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const { w: cw, h: ch } = cssSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const t = transformRef.current;
    const shaking = shakeActionIdsRef.current.size > 0;
    ctx.save();
    ctx.translate(t.x + (shaking ? (Math.random() - 0.5) * 1.4 : 0), t.y + (shaking ? (Math.random() - 0.5) * 1.4 : 0));
    ctx.scale(t.scale, t.scale);
    const selName = selectedCellRef.current;
    leavesRef.current.forEach((node) => {
      const c = animatedCirclesRef.current.get(node.name);
      if (!c) return;
      const screenR = c.r * t.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      const personImage = personImagesRef.current.get(node.name);
      if (personImage?.complete && personImage.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(personImage, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
        ctx.restore();
      }
      if (selName === node.name) {
        ctx.lineWidth = 2.4 / t.scale;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      const fontSizeScreen = Math.max(9, Math.min(15, screenR * 0.42));
      if (screenR > 13) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.font = `600 ${fontSizeScreen / t.scale}px -apple-system, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const pad = 3 / t.scale;
        let label = node.name;
        const maxW = c.r * 1.7 - pad * 2;
        if (ctx.measureText(label).width > maxW) {
          while (label.length > 1 && ctx.measureText(label + "…").width > maxW) label = label.slice(0, -1);
          label = label.length > 1 ? label + "…" : "";
        }
        if (label) ctx.fillText(label, c.x, c.y);
        ctx.restore();
      }
    });
    const now = performance.now();
    impactsRef.current.forEach((imp) => {
      const p = Math.min(1, (now - imp.startTime) / imp.duration);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, imp.r * (0.9 + p * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = imp.color;
      ctx.fill();
      ctx.restore();
    });
    projectilesRef.current.forEach((p) => {
      const progress = Math.min(Math.max((now - p.startTime) / p.duration, 0), 1);
      const eased = easeOutQuad(progress);
      const x = quadBezier(p.startX, p.controlX, p.endX, eased);
      const y = quadBezier(p.startY, p.controlY, p.endY, eased);
      const fontSize = 4.6;
      [0.09, 0.18, 0.27].forEach((offset, i) => {
        const tt = eased - offset;
        if (tt <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.38 - i * 0.11);
        ctx.font = `${fontSize * (1 - i * 0.14)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.emoji, quadBezier(p.startX, p.controlX, p.endX, tt), quadBezier(p.startY, p.controlY, p.endY, tt));
        ctx.restore();
      });
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(quadBezierTangent(p.startY, p.controlY, p.endY, eased), quadBezierTangent(p.startX, p.controlX, p.endX, eased)));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.emoji, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }, []);

  useEffect(() => {
    let raf;
    let lastTime = performance.now();
    function tick(now) {
      const dt = now - lastTime;
      lastTime = now;
      if (recenterAnimRef.current) {
        const anim = recenterAnimRef.current;
        const p = Math.min(1, (now - anim.startTime) / anim.duration);
        const eased = easeOutQuad(p);
        transformRef.current = {
          scale: anim.from.scale + (anim.to.scale - anim.from.scale) * eased,
          x: anim.from.x + (anim.to.x - anim.from.x) * eased,
          y: anim.from.y + (anim.to.y - anim.from.y) * eased,
        };
        if (p >= 1) recenterAnimRef.current = null;
      }
      const curT = transformRef.current;
      const fitT = fitTransformRef.current;
      const deviated = Math.abs(curT.scale - fitT.scale) > 0.01 || Math.abs(curT.x - fitT.x) > 0.6 || Math.abs(curT.y - fitT.y) > 0.6;
      if (deviated !== showRecenterRef.current) {
        showRecenterRef.current = deviated;
        setShowRecenter(deviated);
      }
      for (const emitter of emittersRef.current) {
        if (emitter.remaining <= 0 || now < emitter.nextSpawnTime || projectilesRef.current.length >= MAX_CONCURRENT_PROJECTILES) continue;
        const currentLeaves = leavesRef.current;
        const target = currentLeaves.find((l) => l.name === emitter.targetName) || currentLeaves[Math.floor(Math.random() * currentLeaves.length)];
        if (!target) continue;
        const spreadX = Math.min(96, Math.max(4, target.x + (Math.random() - 0.5) * 46));
        const spreadY = -4 - Math.random() * 10;
        const dx = target.x - spreadX;
        const dy = target.y - spreadY;
        const dist = Math.hypot(dx, dy) || 1;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const arcMag = (0.18 + Math.random() * 0.22) * dist * (Math.random() < 0.5 ? -1 : 1);
        projectilesRef.current.push({
          id: Math.random(), firingId: emitter.id, targetName: target.name, startX: spreadX, startY: spreadY,
          endX: target.x, endY: target.y, controlX: (spreadX + target.x) / 2 + perpX * arcMag,
          controlY: (spreadY + target.y) / 2 + perpY * arcMag, startTime: now, duration: emitter.duration,
          growthPerHit: emitter.growthPerHit, direction: emitter.direction, emoji: emitter.emoji, level: emitter.level,
        });
        emitter.remaining -= 1;
        emitter.nextSpawnTime = now + emitter.staggerMs;
      }
      emittersRef.current = emittersRef.current.filter((e) => e.remaining > 0);
      const finished = [];
      projectilesRef.current = projectilesRef.current.filter((p) => {
        const complete = now - p.startTime >= p.duration;
        if (complete) finished.push(p);
        return !complete;
      });
      finished.forEach((f) => {
        const target = leavesRef.current.find((l) => l.name === f.targetName);
        if (target) impactsRef.current.push({ x: target.x, y: target.y, r: target.r, color: f.direction === 1 ? "#22c55e" : "#ef4444", startTime: now, duration: 350 });
      });
      impactsRef.current = impactsRef.current.filter((i) => now - i.startTime < i.duration);
      if (activeActionIdsRef.current.length > 0) {
        const stillRunningIds = activeActionIdsRef.current.filter((id) => emittersRef.current.some((e) => e.id === id) || projectilesRef.current.some((p) => p.firingId === id));
        if (stillRunningIds.length !== activeActionIdsRef.current.length) {
          const alive = new Set(stillRunningIds);
          setActiveActions((prev) => prev.filter((a) => alive.has(a.id)));
        }
      }
      shakeActionIdsRef.current.forEach((id) => {
        if (!emittersRef.current.some((e) => e.id === id) && !projectilesRef.current.some((p) => p.firingId === id)) shakeActionIdsRef.current.delete(id);
      });
      seedMissingRects();
      const lerpFactor = 1 - Math.pow(0.001, dt / 1000);
      leavesRef.current.forEach((target) => {
        const a = animatedCirclesRef.current.get(target.name);
        if (a) {
          a.x += (target.x - a.x) * lerpFactor;
          a.y += (target.y - a.y) * lerpFactor;
          a.r += (target.r - a.r) * lerpFactor;
        }
      });
      keepCirclesSeparated(
        leavesRef.current
          .map((target) => animatedCirclesRef.current.get(target.name))
          .filter(Boolean),
      );
      draw();
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, seedMissingRects]);

  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas || !boardWrapRef.current) return;
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      const { w, h } = cssSize();
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      fitToView();
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [fitToView, Boolean(config)]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    const activePointers = new Map();
    let pinchStartDist = null;
    let pinchStartScale = 1;
    let pinchStartWorld = null;
    function getMid(rect) {
      const pts = [...activePointers.values()];
      return { x: (pts[0].x + pts[1].x) / 2 - rect.left, y: (pts[0].y + pts[1].y) / 2 - rect.top };
    }
    function getDist() {
      const pts = [...activePointers.values()];
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    function onWheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = transformRef.current;
      const newScale = clampScale(t.scale * Math.exp(-e.deltaY * 0.0015));
      const worldX = (mx - t.x) / t.scale;
      const worldY = (my - t.y) / t.scale;
      transformRef.current = { scale: newScale, x: mx - worldX * newScale, y: my - worldY * newScale };
    }
    function onPointerDown(e) {
      recenterAnimRef.current = null;
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        dragging = false;
        const rect = canvas.getBoundingClientRect();
        pinchStartDist = getDist();
        pinchStartScale = transformRef.current.scale;
        const mid = getMid(rect);
        pinchStartWorld = { x: (mid.x - transformRef.current.x) / transformRef.current.scale, y: (mid.y - transformRef.current.y) / transformRef.current.scale };
      } else {
        dragging = true;
        moved = false;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
    function onPointerMove(e) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2 && pinchStartDist && pinchStartWorld) {
        const rect = canvas.getBoundingClientRect();
        const newScale = clampScale(pinchStartScale * getDist() / pinchStartDist);
        const mid = getMid(rect);
        transformRef.current = { scale: newScale, x: mid.x - pinchStartWorld.x * newScale, y: mid.y - pinchStartWorld.y * newScale };
      } else if (dragging && activePointers.size === 1) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        transformRef.current = { ...transformRef.current, x: transformRef.current.x + dx, y: transformRef.current.y + dy };
        lastX = e.clientX;
        lastY = e.clientY;
      }
    }
    function onPointerUp(e) {
      const rect = canvas.getBoundingClientRect();
      const wasClick = activePointers.size === 1 && dragging && !moved;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchStartDist = null;
      if (activePointers.size === 1) {
        const [rem] = activePointers.values();
        dragging = true;
        lastX = rem.x;
        lastY = rem.y;
      } else if (activePointers.size === 0) {
        dragging = false;
        if (wasClick) {
          const t = transformRef.current;
          const worldX = (px - t.x) / t.scale;
          const worldY = (py - t.y) / t.scale;
          const hit = leavesRef.current.find((l) => Math.hypot(worldX - l.x, worldY - l.y) <= l.r);
          if (hit) selectCell(hit.name);
        }
      }
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [selectCell, Boolean(config)]);

  if (bootstrapQuery.isError) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", backgroundColor: "#0a0a0a", color: "#fca5a5", fontSize: "13px", padding: "24px", textAlign: "center" }}>
        Não foi possível carregar o servidor do PopPerson. Tente atualizar a página.
      </div>
    );
  }

  if (bootstrapQuery.isLoading || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", backgroundColor: "#0a0a0a", color: "#a3a3a3", fontSize: "13px" }}>
        Carregando PopPerson…
      </div>
    );
  }

  const closeButtonStyle = { width: "26px", height: "26px", borderRadius: "9999px", backgroundColor: "#262626", color: "#a3a3a3", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  const selectedInitials = selectedCellData ? selectedCellData.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase() : "";
  const actionWasRateLimited = createActionMutation.error?.status === 429;

  return (
    <div style={{ width: "100%", minHeight: "100vh", backgroundColor: "#0a0a0a", position: "relative" }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 60, display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", minHeight: "76px", boxSizing: "border-box" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", padding: "6px 12px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.55)", backdropFilter: "blur(6px)" }}>
          <span data-testid="text-brand" style={{ color: "#f5f5f5", fontWeight: 800, fontSize: "15px", letterSpacing: "-0.01em" }}>PopPerson</span>
        </div>
        <div className="action-pill-container" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "center", containerType: "inline-size" }}>
          {(queue.length > 0 || activeActions.length > 0) && (() => {
            const now = performance.now();
            const entry = activeActions.length > 0
              ? { kind: "firing", ...[...activeActions].sort((a, b) => getRemainingUnits(a) - getRemainingUnits(b))[0] }
              : { kind: "queued", ...[...queue].sort((a, b) => a.executeAt - b.executeAt)[0] };
            const actionColor = entry.mode === "defender" ? "#22c55e" : "#ef4444";
            const { timeLabel, progress } = getActionTiming(entry, now);
            return (
              <button data-testid="button-open-queue" onClick={() => setShowQueueModal(true)} style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: "7px", padding: "7px 14px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.55)", backdropFilter: "blur(6px)", border: `1px solid ${actionColor}55`, cursor: "pointer", maxWidth: "100%", minWidth: 0 }}>
                {entry.kind === "firing" && <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, backgroundColor: `${actionColor}33` }} />}
                <span className="action-pill-target" style={{ position: "relative", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "1 1 auto", textAlign: "left" }}>{MODE_LABEL[entry.mode]} a {entry.targetName}</span>
                <span style={{ position: "relative", color: actionColor, fontFamily: "monospace", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{timeLabel}</span>
                {(queue.length + activeActions.length - 1) > 0 && <span className="action-pill-count" style={{ position: "relative", color: "#a3a3a3", fontSize: "11px", fontFamily: "monospace", flexShrink: 0 }}>+{queue.length + activeActions.length - 1}</span>}
              </button>
            );
          })()}
        </div>
        <button data-testid="button-open-filters" onClick={() => setShowFiltersModal(true)} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.55)", backdropFilter: "blur(6px)", border: activeFilterCount > 0 ? "1px solid rgba(99, 102, 241, 0.6)" : "1px solid rgba(255, 255, 255, 0.08)", color: "#f5f5f5", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
          <SlidersHorizontal size={13} /> Filtros
          {activeFilterCount > 0 && <span data-testid="text-filter-count" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", borderRadius: "9999px", backgroundColor: "#6366f1", color: "#fff", fontSize: "10px", fontWeight: 700, padding: "0 4px" }}>{activeFilterCount}</span>}
        </button>
      </div>

      <div ref={boardWrapRef} style={{ position: "fixed", top: 0, bottom: 0, left: 0, right: 0, zIndex: 1, overflow: "hidden" }}>
        <canvas data-testid="canvas-politicians" ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" }} />
        {leaves.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "24px", textAlign: "center" }}>
            <Search size={28} strokeWidth={1.8} aria-hidden="true" style={{ color: "#737373" }} />
            <span data-testid="text-empty-state" style={{ color: "#f5f5f5", fontSize: "14px", fontWeight: 700 }}>Nenhum político encontrado</span>
            <span style={{ color: "#737373", fontSize: "12px" }}>Tente ajustar ou limpar os filtros aplicados</span>
            <button data-testid="button-adjust-filters" onClick={() => setShowFiltersModal(true)} style={{ marginTop: "6px", padding: "8px 16px", borderRadius: "9999px", backgroundColor: "#262626", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, border: "1px solid #333", cursor: "pointer" }}>Ajustar filtros</button>
          </div>
        )}
      </div>
      {showRecenter && <button data-testid="button-recenter" onClick={recenterView} aria-label="Centralizar visualização" style={{ position: "fixed", zIndex: 55, bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)", right: "calc(env(safe-area-inset-right, 0px) + 16px)", width: "42px", height: "42px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.75)", backdropFilter: "blur(6px)", border: "1px solid rgba(255, 255, 255, 0.12)", color: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}><Locate size={18} /></button>}

      {showFiltersModal && (
        <div onClick={() => setShowFiltersModal(false)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", maxHeight: "80vh", backgroundColor: "#171717", border: "1px solid #333", borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "18px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: "18px", letterSpacing: "-0.01em" }}>Filtros</span>
              <button data-testid="button-close-filters" onClick={() => setShowFiltersModal(false)} style={closeButtonStyle}><X size={13} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
              <FilterSection label="País" options={paisOptions} selected={filters.pais} onSelect={(v) => setFilterLevel("pais", v)} />
              <FilterSection label="Estado" options={estadoOptions} selected={filters.estado} onSelect={(v) => setFilterLevel("estado", v)} disabled={filters.pais === "Todos"} disabledHint="Escolha um país" />
              <FilterSection label="Cidade" options={cidadeOptions} selected={filters.cidade} onSelect={(v) => setFilterLevel("cidade", v)} disabled={filters.estado === "Todos"} disabledHint="Escolha um estado" />
              <FilterSection label="Categoria" options={categoriaOptions} selected={filters.categoria} onSelect={(v) => setFilterLevel("categoria", v)} />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button data-testid="button-clear-filters" onClick={clearFilters} disabled={activeFilterCount === 0} style={{ flex: 1, padding: "10px", borderRadius: "9999px", backgroundColor: "#262626", color: activeFilterCount === 0 ? "#525252" : "#f5f5f5", fontWeight: 700, fontSize: "13px", border: "1px solid #333", cursor: activeFilterCount === 0 ? "default" : "pointer" }}>Limpar filtros</button>
              <button data-testid="button-apply-filters" onClick={() => setShowFiltersModal(false)} style={{ flex: 1, padding: "10px", borderRadius: "9999px", backgroundColor: "#f5f5f5", color: "#0a0a0a", fontWeight: 700, fontSize: "13px", border: "none", cursor: "pointer" }}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {showQueueModal && (
        <div onClick={() => setShowQueueModal(false)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", maxHeight: "70vh", backgroundColor: "#171717", border: "1px solid #333", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: "18px", letterSpacing: "-0.01em" }}>Ações</span>
              <button data-testid="button-close-queue" onClick={() => setShowQueueModal(false)} style={closeButtonStyle}><X size={13} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" }}>
              {[...activeActions].sort((a, b) => getRemainingUnits(a) - getRemainingUnits(b)).map((a) => ({ kind: "firing", ...a })).concat([...queue].sort((a, b) => a.executeAt - b.executeAt).map((a) => ({ kind: "queued", ...a }))).map((item) => {
                const color = item.mode === "defender" ? "#22c55e" : "#ef4444";
                const levelLabel = levelByKey[item.level]?.label ?? item.level;
                const elementIntensityLabel = `${item.element.label} ${levelLabel}`;
                const { timeLabel, progress } = getActionTiming(item, performance.now());
                return (
                  <div key={item.id} data-testid={`queue-item-${item.id}`} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", borderRadius: "10px", backgroundColor: "#262626" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ color: "#f5f5f5", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{MODE_LABEL[item.mode]} a {item.targetName}</span>
                      <span style={{ color, fontFamily: "monospace", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{timeLabel}</span>
                    </div>
                    <div style={{ position: "relative", overflow: "hidden", borderRadius: "8px", backgroundColor: "rgba(255,255,255,0.04)" }}>
                      {item.kind === "firing" && <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, backgroundColor: `${color}33` }} />}
                      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "6px", padding: "5px 8px" }}>
                         <ItemVisual element={item.element} size={14} />
                        <span style={{ color: "#a3a3a3", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{elementIntensityLabel}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedCell && (
        <div onClick={() => setSelectedCell(null)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="selected-cell-title" onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 360px)", maxHeight: "85vh", padding: "14px 16px", borderRadius: "16px", backgroundColor: "#171717", border: "1px solid #333", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
              <span id="selected-cell-title" style={{ color: "#fff", fontSize: "18px", fontWeight: 800, lineHeight: 1.25, letterSpacing: "-0.01em" }}>Você quer atacar ou defender <strong>{selectedCell}</strong>?</span>
              <button data-testid="button-close-selection" onClick={() => setSelectedCell(null)} style={{ ...closeButtonStyle, flexShrink: 0 }}><X size={13} /></button>
            </div>
            {selectedCellData && (
                 <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: "10px", overflow: "hidden", backgroundColor: selectedCellData.color }}>
                 <PersonVisual person={selectedCellData} alt={`Imagem de ${selectedCellData.name}`} style={{ position: "absolute", inset: 0 }} />
                <span style={{ position: "absolute", top: "10px", left: "10px", fontSize: "10px", fontWeight: 700, padding: "3px 9px", borderRadius: "9999px", color: selectedCellData.status === "titular" ? "#93c5fd" : "#fde68a", backgroundColor: selectedCellData.status === "titular" ? "rgba(30,58,95,0.9)" : "rgba(77,58,18,0.9)", backdropFilter: "blur(4px)" }}>{selectedCellData.status === "titular" ? "Em exercício" : "Candidato(a)"}</span>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 12px 12px", background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.5) 65%, transparent)", display: "flex", flexDirection: "column", gap: "6px" }}>
                   <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}><span style={{ color: "rgba(255,255,255,0.65)", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedCellData.categoryPath.map((category) => category.name).join(" / ")}</span><span style={{ color: "#fff", fontSize: "16px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedCellData.name}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}><span style={{ color: "rgba(255,255,255,0.55)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Localização</span><span style={{ color: "#fff", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedCellData.cidade}, {selectedCellData.estado} - {selectedCellData.pais}</span></div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <button data-testid="button-attack" onClick={() => openModal("atacar")} style={{ flex: 1, padding: "12px", borderRadius: "9999px", backgroundColor: "#450a0a", color: "#fecaca", fontWeight: 700, fontSize: "15px", border: "none", cursor: "pointer" }}>⚔️ Atacar</button>
              <button data-testid="button-defend" onClick={() => openModal("defender")} style={{ flex: 1, padding: "12px", borderRadius: "9999px", backgroundColor: "#14532d", color: "#bbf7d0", fontWeight: 700, fontSize: "15px", border: "none", cursor: "pointer" }}>🛡️ Defender</button>
            </div>
          </div>
        </div>
      )}

      {pendingMode && (
        <div onClick={closeModal} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", maxHeight: "85vh", backgroundColor: "#171717", border: "1px solid #333", borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", minWidth: 0 }}>
                {modalStep === "intensidade" && <button data-testid="button-back-element" onClick={() => setModalStep("elemento")} style={{ ...closeButtonStyle, color: "#f5f5f5", flexShrink: 0 }}><ArrowLeft size={14} /></button>}
                <span style={{ color: "#fff", fontWeight: 800, fontSize: "18px", letterSpacing: "-0.01em", lineHeight: 1.25 }}>{modalStep === "elemento" ? pendingMode === "defender" ? `Que defesa quer enviar a ${selectedCell}?` : `Que ataque quer enviar a ${selectedCell}?` : pendingMode === "defender" ? `Qual a intensidade da defesa a ${selectedCell}?` : `Qual a intensidade do ataque a ${selectedCell}?`}</span>
              </div>
              <button data-testid="button-close-action" onClick={closeModal} style={{ ...closeButtonStyle, flexShrink: 0 }}><X size={13} /></button>
            </div>
             {selectedCellData && (
               <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", backgroundColor: "#262626", border: "1px solid #333" }}>
                 <PersonVisual person={selectedCellData} alt={`Imagem de ${selectedCellData.name}`} style={{ width: "46px", height: "46px", borderRadius: "8px", flexShrink: 0 }} />
                 <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                   <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Pessoa selecionada</span>
                   <span style={{ color: "#fff", fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedCellData.name}</span>
                 </div>
               </div>
             )}
            {modalStep === "elemento" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: "8px" }}>
                 {elements[pendingMode].map((el) => <button data-testid={`button-element-${el.id}`} key={el.id} onClick={() => pickElement(el)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "10px 6px", borderRadius: "10px", border: modalElement?.id === el.id ? "2px solid #f5f5f5" : "2px solid transparent", backgroundColor: "#262626", cursor: "pointer" }}><ItemVisual element={el} size={22} /><span style={{ fontSize: "11px", color: "#a3a3a3" }}>{el.label}</span><span style={{ fontSize: "10px", color: "#525252", fontFamily: "monospace" }}>{pendingMode === "atacar" ? "ATK" : "DEF"} {el.force}</span><span style={{ fontSize: "11px", color: "#4ade80", fontWeight: 700, fontFamily: "monospace" }}>{formatBRL(el.price)}</span></button>)}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderRadius: "10px", backgroundColor: "#262626", border: "1px solid #333", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "10px", padding: "10px 12px" }}>
                     <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}><span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Elemento</span><div style={{ display: "flex", alignItems: "center", gap: "6px" }}><ItemVisual element={modalElement} size={16} /><span style={{ color: "#f5f5f5", fontSize: "13px", fontWeight: 600 }}>{modalElement.label}</span><span style={{ fontSize: "10px", color: "#737373", fontFamily: "monospace" }}>{pendingMode === "atacar" ? "ATK" : "DEF"} {modalElement.force}</span></div>{modalElement.description && <span style={{ color: "#737373", fontSize: "11px", lineHeight: 1.35 }}>{modalElement.description}</span>}</div>
                    <span data-testid="text-selected-action-price" aria-label="Preço da intensidade selecionada" style={{ fontSize: "12px", color: "#4ade80", fontWeight: 700, fontFamily: "monospace", flexShrink: 0 }}>{selectedActionPrice === null ? "—" : formatBRL(selectedActionPrice)}</span>
                  </div>
                  <div style={{ height: "1px", backgroundColor: "#333" }} />
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Intensidade</span><span style={{ color: "#f5f5f5", fontSize: "13px", fontWeight: 700 }}>{levelByKey[modalLevel]?.emoji} {levelByKey[modalLevel]?.label ?? modalLevel}</span></div>
                    <div>
                      <input data-testid="input-intensity" type="range" min={0} max={levelKeys.length - 1} step={1} value={levelKeys.indexOf(modalLevel)} onChange={(e) => setModalLevel(levelKeys[Number(e.target.value)])} style={{ width: "100%", height: "6px", accentColor: pendingMode === "defender" ? "#22c55e" : "#ef4444", cursor: "pointer" }} />
                      <div style={{ position: "relative", height: "14px", marginTop: "4px" }}>{levelKeys.map((key, i) => { const isSelected = modalLevel === key; const percent = levelKeys.length > 1 ? (i / (levelKeys.length - 1)) * 100 : 0; return <button data-testid={`button-level-${key}`} key={key} type="button" onClick={() => setModalLevel(key)} aria-label={levelByKey[key]?.label ?? key} style={{ position: "absolute", left: `${percent}%`, transform: i === 0 ? "translateX(0)" : i === levelKeys.length - 1 ? "translateX(-100%)" : "translateX(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", whiteSpace: "nowrap", fontSize: "9px", fontFamily: "monospace", fontWeight: isSelected ? 700 : 400, color: isSelected ? pendingMode === "defender" ? "#4ade80" : "#f87171" : "#525252" }}>{levelByKey[key]?.powerLabel}</button>; })}</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "10px", backgroundColor: "#262626", border: "1px solid #333" }}><div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}><span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Custo total da ação</span><span style={{ color: "#f5f5f5", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{modalElement.label} {levelByKey[modalLevel]?.label ?? modalLevel}</span></div><span data-testid="text-action-total-price" style={{ color: "#4ade80", fontSize: "17px", fontWeight: 700, fontFamily: "monospace", flexShrink: 0 }}>{selectedActionPrice === null ? "—" : formatBRL(selectedActionPrice)}</span></div>
                {createActionMutation.error && <span style={{ color: "#fca5a5", fontSize: "11px" }}>{actionWasRateLimited ? "Muitas ações em pouco tempo. Aguarde um instante e tente novamente." : "Não foi possível enviar esta ação. Tente novamente."}</span>}
                 <button data-testid="button-send-action" onClick={confirmAction} disabled={createActionMutation.isPending || !selectedActionRule} style={{ padding: "10px", borderRadius: "9999px", backgroundColor: createActionMutation.isPending || !selectedActionRule ? "#525252" : "#f5f5f5", color: "#0a0a0a", fontWeight: 700, border: "none", cursor: createActionMutation.isPending ? "wait" : "pointer" }}>{createActionMutation.isPending ? "Enviando…" : selectedActionRule?.startDelayMs > 0 ? `Enviar (inicia em ${Math.ceil(selectedActionRule.startDelayMs / 1000)}s)` : "Enviar agora"}</button>
              </>
            )}
          </div>
        </div>
      )}
      <style>{`@container (max-width: 130px) { .action-pill-count { display: none; } }`}</style>
    </div>
  );
}