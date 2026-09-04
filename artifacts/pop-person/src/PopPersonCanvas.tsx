// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { SlidersHorizontal, ArrowLeftRight, ArrowRight, X, ChevronDown, ChevronRight, Locate, Search, ScanFace, Plus, CircleUserRound, Pencil, CalendarDays, LogOut, Mail, MapPin } from "lucide-react";
import { FaXTwitter } from "react-icons/fa6";
import FanHaterLevelPicker from "./components/fan-hater-level-picker";
import EmojiEffectsWebGL from "./components/emoji-effects-webgl";
import {
  useCreatePopPersonAction,
  useGetAccessLocation,
  useGetPopPerson,
  useGetPopPersonState,
  useLogoutAuthenticatedUser,
  searchCountries,
  searchCities,
} from "@workspace/api-client-react";

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

const MODE_LABEL = { atacar: "Hater", defender: "Fã" };
const DEFAULT_ACTION_EMOJI = { atacar: "💢", defender: "❤️" };
const ACTION_MODE_COLORS = { atacar: "#ff625f", defender: "#df5184" };

function getActionDisplay(item, levelByKey = {}) {
  const mode = item?.mode === "defender" ? "defender" : "atacar";
  const level = item?.level ? levelByKey[item.level] : null;
  return {
    emoji: item?.levelEmoji ?? item?.element?.emoji ?? level?.emoji ?? DEFAULT_ACTION_EMOJI[mode],
    label: item?.levelName ?? item?.element?.label ?? level?.name ?? item?.level ?? MODE_LABEL[mode],
  };
}
const MIN_CELL_VALUE = 2;
const CIRCLE_GAP = 2.5;
// Keep zoom effectively unbounded for users while avoiding browser floating-
// point and canvas precision problems at the extreme ends of the scale.
const MIN_ZOOM = 0.0001;
const MAX_ZOOM = 100000;
const CELL_TEXT_MIN_SCREEN_SIZE = 9;
const CELL_TEXT_MAX_SCREEN_SIZE = 15;
const CELL_TEXT_RADIUS_RATIO = 0.42;
const ADD_PLAYER_CELL_NAME = "__instapop_add_player__";
const ADD_PLAYER_CELL_SCREEN_RADIUS = 30;
const PLAYER_AUTO_FOCUS_DELAY_MS = 1500;
const EMPTY_PLAYER_LOCATION = { city: "", region: "", country: "" };
const PENDING_PLAYER_JOIN_STORAGE_KEY = "instapop:pending-player-join";
const PENDING_PLAYER_JOIN_MAX_AGE_MS = 15 * 60 * 1000;

function getSuggestedPlayerLocation(accessLocation) {
  if (accessLocation?.source !== "ip") return { ...EMPTY_PLAYER_LOCATION };
  const cleanValue = (value) => value && value !== "—" ? value : "";
  return {
    city: cleanValue(accessLocation.city),
    region: cleanValue(accessLocation.region),
    country: cleanValue(accessLocation.country),
  };
}

function getAddPlayerCellWorldRadius(scale) {
  return ADD_PLAYER_CELL_SCREEN_RADIUS / Math.max(Number(scale) || 1, MIN_ZOOM);
}

function getWebSocketUrl() {
  const configuredUrl = import.meta.env.DEV
    ? ""
    : import.meta.env.VITE_WS_URL?.trim() || import.meta.env.VITE_API_URL?.trim();
  if (configuredUrl) {
    let url;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new Error("VITE_WS_URL or VITE_API_URL must be a valid absolute URL.");
    }
    url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function getApiEndpoint(path) {
  const configuredApiUrl = import.meta.env.DEV
    ? ""
    : import.meta.env.VITE_API_URL?.trim() || "";
  return `${configuredApiUrl.replace(/\/+$/, "")}${path}`;
}

function realtimeDebug(event, details = {}) {
  if (import.meta.env.DEV) {
    console.debug(`[InstaPop realtime] ${event}`, {
      timestamp: Date.now(),
      ...details,
    });
  }
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

function formatAccountDate(value) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function getStableCellTextSize(screenRadius) {
  const safeRadius = Number.isFinite(screenRadius) && screenRadius > 0 ? screenRadius : CELL_TEXT_MIN_SCREEN_SIZE;
  return Math.max(
    CELL_TEXT_MIN_SCREEN_SIZE,
    Math.min(CELL_TEXT_MAX_SCREEN_SIZE, safeRadius * CELL_TEXT_RADIUS_RATIO),
  );
}

function getActionTotalPrice(basePrice, level) {
  if (!level) return null;
  const currentPrice = Number(basePrice);
  const multiplier = Number(level.multiplier);
  if (!Number.isFinite(currentPrice) || !Number.isFinite(multiplier)) {
    return null;
  }
  return currentPrice * multiplier;
}

function tryPackCircles(ordered, baseRadii, scale) {
  const placed = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const r = baseRadii[index] * scale;
    const candidates = [{ x: 0, y: 0 }];

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
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      });
    }

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const clear = placed.every(
        (other) =>
          Math.hypot(candidate.x - other.x, candidate.y - other.y) >=
          r + other.r + CIRCLE_GAP,
      );
      if (!clear) continue;

      const score = Math.hypot(candidate.x, candidate.y);
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

// The layout uses an unbounded world. Radius is based on the cell's absolute
// value, so a cell continues to grow instead of being normalized against the
// sum of all values or clipped to a 100x100 board.
function computeLeaves(data) {
  if (data.length === 0) return [];
  const ordered = [...data].sort((a, b) => b.value - a.value);
  const baseRadii = ordered.map((item) => Math.sqrt(Math.max(0, item.value)) * 3.2);
  return tryPackCircles(ordered, baseRadii, 1) || [];
}

function keepCirclesSeparated(circles) {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let moved = false;

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

function FilterSearchPicker({
  label,
  selectedLabel,
  options,
  selected,
  onSelect,
  disabled = false,
  open,
  onToggle,
  search,
  onSearch,
  inputTestId,
  buttonTestId,
  allOptionTestId,
  listboxLabel,
  placeholder,
  allLabel,
  loading = false,
  emptyMessage = "Nenhum resultado encontrado.",
  showDivider = true,
  clientFilter = true,
}) {
  const query = normalizeLocationValue(search);
  const visibleOptions = options.filter((option) =>
    option.value !== "Todos" &&
    (!clientFilter || !query || normalizeLocationValue(option.label).includes(query)),
  );

  return (
    <div style={{ borderBottom: showDivider ? "1px solid #2d2d2d" : "none" }}>
      <button
        data-testid={buttonTestId}
        type="button"
        onClick={() => onToggle()}
        disabled={disabled}
        aria-label={selected === "Todos" ? `Buscar ${label.toLocaleLowerCase("pt-BR")}` : `Editar ${label.toLocaleLowerCase("pt-BR")}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ width: "100%", minHeight: "54px", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", border: "none", backgroundColor: "transparent", color: "#f5f5f5", textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.58 : 1 }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
          <span style={{ color: disabled ? "#737373" : "#d4d4d4", fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", lineHeight: 1.2, textTransform: "uppercase" }}>{label}</span>
          <span style={{ color: selected !== "Todos" ? "#c7d2fe" : "#a3a3a3", fontSize: "12px", fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedLabel}</span>
        </span>
        {open ? <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0, color: "#c7d2fe" }} /> : <ChevronRight size={16} aria-hidden="true" style={{ flexShrink: 0, color: disabled ? "#525252" : "#737373" }} />}
      </button>

      {open && !disabled && (
        <div role="listbox" aria-label={listboxLabel} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px 12px", backgroundColor: "#202020", borderTop: "1px solid #2d2d2d" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} aria-hidden="true" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#737373", pointerEvents: "none" }} />
            <input
              data-testid={inputTestId}
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onToggle(false);
              }}
              placeholder={placeholder}
              aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`}
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 30px", borderRadius: "8px", backgroundColor: "#2a2a2a", color: "#f5f5f5", border: "1px solid #454545", fontSize: "12px", outline: "none" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "190px", overflowY: "auto" }}>
            <button
              data-testid={allOptionTestId}
              type="button"
              role="option"
              aria-selected={selected === "Todos"}
              onClick={() => onSelect("Todos")}
              style={{ width: "100%", padding: "9px 10px", border: "none", borderRadius: "7px", backgroundColor: selected === "Todos" ? "#363636" : "transparent", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, textAlign: "left", cursor: "pointer" }}
            >
              {allLabel}
            </button>
            {loading ? (
              <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>Buscando...</span>
            ) : visibleOptions.length === 0 ? (
              <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>{emptyMessage}</span>
            ) : (
              visibleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === selected}
                  onClick={() => onSelect(option.value)}
                  style={{ width: "100%", padding: "9px 10px", border: "none", borderRadius: "7px", backgroundColor: option.value === selected ? "#363636" : "transparent", color: option.value === selected ? "#fff" : "#d4d4d4", fontSize: "12px", fontWeight: option.value === selected ? 700 : 600, textAlign: "left", cursor: "pointer" }}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
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

function LegalLinks() {
  return (
    <nav
      aria-label="Documentos legais"
      style={{
        color: "#737373",
        fontSize: "11px",
        lineHeight: 1.5,
        textAlign: "center",
      }}
    >
      Consulte a{" "}
      <a href="/privacidade" style={{ color: "#a5b4fc", fontWeight: 700 }}>
        Política de Privacidade
      </a>{" "}
      e os{" "}
      <a href="/termos-de-servico" style={{ color: "#a5b4fc", fontWeight: 700 }}>
        Termos de Serviço
      </a>
      .
    </nav>
  );
}

function AccountModal({ user, onClose, onLogout, isLoggingOut, logoutError, closeButtonRef }) {
  const initials = (user.name || user.username || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      data-testid="account-modal-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.74)", backdropFilter: "blur(3px)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        aria-describedby="account-description"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: "390px", maxHeight: "min(620px, 90vh)", overflowY: "auto", backgroundColor: "rgba(23,23,23,0.98)", border: "1px solid #333", borderRadius: "16px", padding: "18px", boxSizing: "border-box", boxShadow: "0 14px 44px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <span id="account-title" style={{ display: "block", color: "#fff", fontWeight: 800, fontSize: "18px", lineHeight: 1.2, letterSpacing: "-0.02em" }}>Sua conta</span>
            <span id="account-description" style={{ display: "block", marginTop: "4px", color: "#8f8f8f", fontSize: "12px", lineHeight: 1.4 }}>Informações do seu perfil no InstaPop.</span>
          </div>
          <button
            ref={closeButtonRef}
            data-testid="button-close-account"
            type="button"
            onClick={onClose}
            aria-label="Fechar conta"
            style={{ width: "26px", height: "26px", borderRadius: "9999px", backgroundColor: "#262626", color: "#a3a3a3", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px", backgroundColor: "#202020", border: "1px solid #2d2d2d" }}>
          <div data-testid="avatar-account" style={{ position: "relative", width: "54px", height: "54px", flexShrink: 0, overflow: "hidden", borderRadius: "9999px", display: "grid", placeItems: "center", backgroundColor: "#373737", color: "#c7d2fe", border: "1px solid rgba(199,210,254,0.32)", fontSize: "16px", fontWeight: 800, letterSpacing: "-0.03em" }}>
            <span aria-hidden="true">{initials}</span>
            {user.avatarUrl && (
              <img
                data-testid="image-account-avatar"
                src={user.avatarUrl}
                alt={`Imagem de ${user.name || "usuário"}`}
                onError={(event) => { event.currentTarget.style.display = "none"; }}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </div>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            <strong data-testid="text-account-name" style={{ color: "#f5f5f5", fontSize: "15px", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name || "Nome não informado"}</strong>
            <span data-testid="text-account-x-username" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#c7d2fe", fontSize: "12px", fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "5px", backgroundColor: "#2d2d2d", color: "#f5f5f5" }}><FaXTwitter size={11} /></span>
              {user.username ? `@${String(user.username).replace(/^@/, "")}` : "Perfil X não informado"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px", borderTop: "1px solid #2d2d2d", borderBottom: "1px solid #2d2d2d" }}>
          <div data-testid="row-account-locality" style={{ display: "flex", alignItems: "flex-start", gap: "11px", padding: "12px 2px" }}>
            <MapPin size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px", color: "#8b93d6" }} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Localidade</span>
              <span data-testid="text-account-locality" style={{ color: "#e5e5e5", fontSize: "12px", fontWeight: 600, lineHeight: 1.35 }}>{user.xLocation?.trim() || "Localidade não informada"}</span>
            </div>
          </div>
          <div data-testid="row-account-email" style={{ display: "flex", alignItems: "flex-start", gap: "11px", padding: "12px 2px" }}>
            <Mail size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px", color: "#8b93d6" }} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>E-mail</span>
              <span data-testid="text-account-email" style={{ color: "#e5e5e5", fontSize: "12px", fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>{user.email?.trim() || "E-mail não informado"}</span>
            </div>
          </div>
          <div data-testid="row-account-registration-date" style={{ display: "flex", alignItems: "flex-start", gap: "11px", padding: "12px 2px" }}>
            <CalendarDays size={15} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px", color: "#8b93d6" }} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Membro desde</span>
              <span data-testid="text-account-registration-date" style={{ color: "#e5e5e5", fontSize: "12px", fontWeight: 600, lineHeight: 1.35 }}>{formatAccountDate(user.createdAt)}</span>
            </div>
          </div>
        </div>

        {logoutError && (
          <span data-testid="status-account-logout-error" role="alert" style={{ color: "#fca5a5", fontSize: "11px", lineHeight: 1.4 }}>
            Não foi possível sair agora. Tente novamente.
          </span>
        )}
        <button
          data-testid="button-logout"
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "40px", padding: "10px 14px", borderRadius: "9999px", backgroundColor: isLoggingOut ? "#383838" : "#262626", color: isLoggingOut ? "#8a8a8a" : "#f5f5f5", border: "1px solid #3b3b3b", fontSize: "12px", fontWeight: 800, cursor: isLoggingOut ? "wait" : "pointer" }}
        >
          <LogOut size={15} aria-hidden="true" />
          {isLoggingOut ? "Saindo…" : "Sair da conta"}
        </button>
        <LegalLinks />
      </div>
    </div>
  );
}

function ConnectXModal({ onClose, onConnect, closeButtonRef, purpose = "player" }) {
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const isActionPurpose = purpose === "action";

  return (
    <div
      data-testid="connect-modal-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.74)", backdropFilter: "blur(3px)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        aria-describedby="connect-description"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "100%", maxWidth: "390px", backgroundColor: "rgba(23,23,23,0.98)", border: "1px solid #333", borderRadius: "16px", padding: "20px", boxSizing: "border-box", boxShadow: "0 14px 44px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <span id="connect-title" style={{ display: "block", color: "#fff", fontWeight: 800, fontSize: "18px", lineHeight: 1.2, letterSpacing: "-0.02em" }}>{isActionPurpose ? "Conectar para enviar" : "Conectar e entrar na disputa"}</span>
            <span id="connect-description" style={{ display: "block", marginTop: "5px", color: "#8f8f8f", fontSize: "12px", lineHeight: 1.45 }}>{isActionPurpose ? "Apoio, fã e hate só podem ser enviados por contas conectadas ao X." : "Conecte seu perfil X para criar sua participação no InstaPop."}</span>
          </div>
          <button
            ref={closeButtonRef}
            data-testid="button-close-connect"
            type="button"
            onClick={onClose}
            aria-label="Fechar conexão com X"
            style={{ width: "26px", height: "26px", borderRadius: "9999px", backgroundColor: "#262626", color: "#a3a3a3", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "18px", minHeight: "132px", padding: "20px 12px", borderRadius: "13px", backgroundColor: "#202020", border: "1px solid #2d2d2d" }}>
          <div style={{ width: "72px", height: "72px", display: "grid", placeItems: "center", padding: "12px", boxSizing: "border-box", borderRadius: "18px", backgroundColor: "#171717", border: "1px solid #3a3a3a" }}>
            <img src="/instapop-mark-192.svg" alt="InstaPop" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <ArrowLeftRight size={21} aria-hidden="true" style={{ color: "#8b93d6", flexShrink: 0 }} />
          <div style={{ width: "72px", height: "72px", display: "grid", placeItems: "center", borderRadius: "18px", backgroundColor: "#171717", border: "1px solid #3a3a3a", color: "#f5f5f5" }}>
            <FaXTwitter size={31} aria-hidden="true" />
          </div>
        </div>

        <p style={{ margin: 0, color: "#a3a3a3", fontSize: "12px", lineHeight: 1.5 }}>
          Você será redirecionado para <strong style={{ color: "#e5e5e5" }}>x.com</strong> para autorizar a conexão com sua conta. {isActionPurpose ? "Depois, volte ao perfil para enviar sua ação." : "Ao concluir, seu perfil será incluído na disputa de popularidade."}
        </p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "9px", color: "#a3a3a3", fontSize: "11px", lineHeight: 1.5, cursor: "pointer" }}>
          <input
            data-testid="checkbox-connect-player-terms"
            type="checkbox"
            checked={hasAcceptedTerms}
            onChange={(event) => setHasAcceptedTerms(event.target.checked)}
            style={{ width: "15px", height: "15px", margin: "1px 0 0", flexShrink: 0, accentColor: "#f5f5f5", cursor: "pointer" }}
          />
          <span>
            Li e concordo com os{" "}
            <a href="/termos-de-servico" style={{ color: "#c7d2fe", fontWeight: 700 }}>Termos de Serviço</a>{" "}
            e a{" "}
            <a href="/privacidade" style={{ color: "#c7d2fe", fontWeight: 700 }}>Política de Privacidade</a>.
          </span>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            data-testid="button-connect-x"
            type="button"
            onClick={onConnect}
            disabled={!hasAcceptedTerms}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "42px", padding: "10px 14px", borderRadius: "9999px", backgroundColor: hasAcceptedTerms ? "#f5f5f5" : "#383838", color: hasAcceptedTerms ? "#0a0a0a" : "#8a8a8a", border: "none", fontSize: "12px", fontWeight: 800, cursor: hasAcceptedTerms ? "pointer" : "default", opacity: hasAcceptedTerms ? 1 : 0.72 }}
          >
            <FaXTwitter size={15} aria-hidden="true" />
            {isActionPurpose ? "Conectar com X para continuar" : "Conectar com X e entrar na disputa"}
          </button>
          <button
            data-testid="button-cancel-connect"
            type="button"
            onClick={onClose}
            style={{ minHeight: "34px", padding: "8px 14px", borderRadius: "9999px", backgroundColor: "transparent", color: "#a3a3a3", border: "1px solid #333", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PopPersonCanvas() {
  const bootstrapQuery = useGetPopPerson();
  const accessLocationQuery = useGetAccessLocation({
    query: {
      // Location is optional. Start it only after bootstrap has established the
      // anonymous session, so a third-party lookup cannot delay the app shell.
      enabled: Boolean(bootstrapQuery.data),
      retry: false,
    },
  });
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const stateQuery = useGetPopPersonState({
    query: {
      enabled: Boolean(bootstrapQuery.data),
      // WebSocket is the primary transport. Poll only while it is unavailable
      // so a stale REST response cannot race a realtime snapshot.
      refetchInterval: isRealtimeConnected ? false : 1000,
    },
  });
  const createActionMutation = useCreatePopPersonAction();
  const canvasRef = useRef(null);
  const boardWrapRef = useRef(null);
  const [dataset, setDataset] = useState([]);
  const [filters, setFilters] = useState({ pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" });
  const [draftFilters, setDraftFilters] = useState({ pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" });
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectPurpose, setConnectPurpose] = useState("player");
  const [isFilterCountryPickerOpen, setIsFilterCountryPickerOpen] = useState(false);
  const [filterCountrySearch, setFilterCountrySearch] = useState("");
  const [isFilterStatePickerOpen, setIsFilterStatePickerOpen] = useState(false);
  const [filterStateSearch, setFilterStateSearch] = useState("");
  const [isFilterCityPickerOpen, setIsFilterCityPickerOpen] = useState(false);
  const [filterCitySearch, setFilterCitySearch] = useState("");
  const [filterLocationSearchResults, setFilterLocationSearchResults] = useState([]);
  const [isSearchingFilterLocation, setIsSearchingFilterLocation] = useState(false);
  const [filterLocationSearchError, setFilterLocationSearchError] = useState(null);
  const [isFilterCategoryPickerOpen, setIsFilterCategoryPickerOpen] = useState(false);
  const [filterCategorySearch, setFilterCategorySearch] = useState("");
  const [expandedFilterCategoryIds, setExpandedFilterCategoryIds] = useState(new Set());
  const [selectedCell, setSelectedCell] = useState(null);
  const [pendingMode, setPendingMode] = useState(null);
  const [modalLevel, setModalLevel] = useState("");
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [queue, setQueue] = useState([]);
  const [activeActions, setActiveActions] = useState([]);
  const [showRecenter, setShowRecenter] = useState(false);
  const [isJoiningPlayer, setIsJoiningPlayer] = useState(false);
  const [joinPlayerError, setJoinPlayerError] = useState(null);
  const [showPlayerSignup, setShowPlayerSignup] = useState(false);
  const [playerRegistration, setPlayerRegistration] = useState(null);
  const [isLoadingPlayerRegistration, setIsLoadingPlayerRegistration] = useState(false);
  const [hasAcceptedPlayerTerms, setHasAcceptedPlayerTerms] = useState(false);
  const [playerCategoryId, setPlayerCategoryId] = useState("");
  const [isPlayerCategoryPickerOpen, setIsPlayerCategoryPickerOpen] = useState(false);
  const [playerCategorySearch, setPlayerCategorySearch] = useState("");
  const [expandedPlayerCategoryIds, setExpandedPlayerCategoryIds] = useState(new Set());
  const [playerLocation, setPlayerLocation] = useState(EMPTY_PLAYER_LOCATION);
  const [isEditingPlayerLocation, setIsEditingPlayerLocation] = useState(false);
  const [isPlayerLocationPickerOpen, setIsPlayerLocationPickerOpen] = useState(false);
  const [playerLocationSearch, setPlayerLocationSearch] = useState("");
  const [playerLocationResults, setPlayerLocationResults] = useState([]);
  const [isSearchingPlayerLocation, setIsSearchingPlayerLocation] = useState(false);
  const [playerLocationSearchError, setPlayerLocationSearchError] = useState(null);
  const [, forceTick] = useState(0);
  const logoutMutation = useLogoutAuthenticatedUser({
    request: { credentials: "include" },
  });
  const accountCloseButtonRef = useRef(null);
  const connectCloseButtonRef = useRef(null);
  const submittingActionRef = useRef(false);
  const idempotencyKeyRef = useRef(null);
  const idempotencyPayloadRef = useRef("");
  const playerLocationEditedRef = useRef(false);
  const pendingAutoJoinRef = useRef(false);
  const autoJoinSubmittedRef = useRef(false);
  const config = bootstrapQuery.data?.config;
  const authenticatedUser = bootstrapQuery.data?.user ?? null;
  const canJoinAsPlayer = Boolean(
    authenticatedUser && !bootstrapQuery.data?.player?.isPlayer,
  );
  const playerName = bootstrapQuery.data?.player?.isPlayer
    ? bootstrapQuery.data.player.name?.trim() || bootstrapQuery.data.user?.name?.trim() || null
    : null;
  const actionTypes = config?.actionTypes ?? { hate: null, fan: null };
  const levels = config?.levels ?? [];
  const levelByKey = useMemo(() => Object.fromEntries(levels.map((level) => [level.key, level])), [levels]);
  const actionTypeByMode = { atacar: "hate", defender: "fan" };
  const levelsByActionType = useMemo(
    () => ({
      hate: levels.filter((level) => level.actionType === "hate"),
      fan: levels.filter((level) => level.actionType === "fan"),
    }),
    [levels],
  );
  const playerCategoryOptions = useMemo(() => {
    const categories = playerRegistration?.categories ?? [];
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const childrenByParent = new Map();

    categories.forEach((category) => {
      if (!category.parentId) return;
      const children = childrenByParent.get(category.parentId) ?? [];
      children.push(category);
      childrenByParent.set(category.parentId, children);
    });

    const ordered = [];
    const visited = new Set();
    const visit = (category, depth, parentPath) => {
      if (!category || visited.has(category.id)) return;
      visited.add(category.id);
      const path = [...parentPath, category.name];
      ordered.push({
        ...category,
        depth,
        hasChildren: (childrenByParent.get(category.id)?.length ?? 0) > 0,
        pathLabel: path.join(" / "),
      });
      (childrenByParent.get(category.id) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .forEach((child) => visit(child, depth + 1, path));
    };

    categories
      .filter((category) => !category.parentId || !categoryById.has(category.parentId))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .forEach((category) => visit(category, 0, []));
    categories.forEach((category) => visit(category, 0, []));
    return ordered;
  }, [playerRegistration?.categories]);
  const filteredPlayerCategoryOptions = useMemo(() => {
    const query = normalizeLocationValue(playerCategorySearch);
    if (!query) return playerCategoryOptions;
    return playerCategoryOptions.filter((category) =>
      normalizeLocationValue(`${category.name} ${category.pathLabel}`).includes(query),
    );
  }, [playerCategoryOptions, playerCategorySearch]);
  const visiblePlayerCategoryOptions = useMemo(() => {
    if (normalizeLocationValue(playerCategorySearch)) return filteredPlayerCategoryOptions;
    return filteredPlayerCategoryOptions.filter((category) => {
      if (category.depth === 0) return true;
      let parentId = category.parentId;
      while (parentId) {
        if (!expandedPlayerCategoryIds.has(parentId)) return false;
        const parent = playerCategoryOptions.find((option) => option.id === parentId);
        parentId = parent?.parentId;
      }
      return true;
    });
  }, [expandedPlayerCategoryIds, filteredPlayerCategoryOptions, playerCategoryOptions, playerCategorySearch]);
  const selectedPlayerCategory = useMemo(
    () => playerCategoryOptions.find((category) => category.id === playerCategoryId),
    [playerCategoryId, playerCategoryOptions],
  );
  const selectedActionType = pendingMode ? actionTypes[actionTypeByMode[pendingMode]] : null;
  const selectedLevel = levelByKey[modalLevel] ?? null;
  const activeFilterLocationSearch = useMemo(() => {
    if (isFilterCountryPickerOpen) return { level: "pais", query: filterCountrySearch };
    if (isFilterStatePickerOpen) return { level: "estado", query: filterStateSearch };
    if (isFilterCityPickerOpen) return { level: "cidade", query: filterCitySearch };
    return null;
  }, [
    filterCitySearch,
    filterCountrySearch,
    filterStateSearch,
    isFilterCityPickerOpen,
    isFilterCountryPickerOpen,
    isFilterStatePickerOpen,
  ]);

  const remoteFilterLocationOptions = useMemo(() => {
    if (!activeFilterLocationSearch) return [];
    const options = new Map();
    filterLocationSearchResults.forEach((result) => {
      if (activeFilterLocationSearch.level === "pais") {
        if (result.country) options.set(result.country, { value: result.country, label: result.country });
        return;
      }
      if (activeFilterLocationSearch.level === "estado") {
        if (result.region && result.region !== result.country) {
          options.set(result.region, { value: result.region, label: result.region });
        }
        return;
      }
      if (result.city) {
        const label = result.region && result.region !== result.country
          ? `${result.city} (${result.region})`
          : result.city;
        options.set(result.city, { value: result.city, label });
      }
    });
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [activeFilterLocationSearch, filterLocationSearchResults]);
  const filterLocationEmptyMessage = activeFilterLocationSearch?.query.trim().length < 2
    ? "Digite pelo menos 2 caracteres."
    : filterLocationSearchError || "Nenhum resultado encontrado.";
  const filterCategoryOptions = useMemo(() => {
    const categories = new Map();
    dataset.forEach((person) => {
      (person.categoryPath ?? []).forEach((category, index, path) => {
        if (!categories.has(category.id)) {
          categories.set(category.id, {
            ...category,
            depth: index,
            pathLabel: path.slice(0, index + 1).map((item) => item.name).join(" / "),
          });
        }
      });
    });
    const categoryIdsWithChildren = new Set(
      Array.from(categories.values())
        .map((category) => category.parentId)
        .filter(Boolean),
    );
    return Array.from(categories.values())
      .map((category) => ({ ...category, hasChildren: categoryIdsWithChildren.has(category.id) }))
      .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, "pt-BR"));
  }, [dataset]);
  const filteredFilterCategoryOptions = useMemo(() => {
    const query = normalizeLocationValue(filterCategorySearch);
    if (!query) return filterCategoryOptions;
    return filterCategoryOptions.filter((category) =>
      normalizeLocationValue(`${category.name} ${category.pathLabel}`).includes(query),
    );
  }, [filterCategoryOptions, filterCategorySearch]);
  const visibleFilterCategoryOptions = useMemo(() => {
    if (normalizeLocationValue(filterCategorySearch)) return filteredFilterCategoryOptions;
    return filteredFilterCategoryOptions.filter((category) => {
      if (category.depth === 0) return true;
      let parentId = category.parentId;
      while (parentId) {
        if (!expandedFilterCategoryIds.has(parentId)) return false;
        const parent = filterCategoryOptions.find((option) => option.id === parentId);
        parentId = parent?.parentId;
      }
      return true;
    });
  }, [expandedFilterCategoryIds, filteredFilterCategoryOptions, filterCategoryOptions, filterCategorySearch]);
  const selectedFilterCategory = useMemo(
    () => filterCategoryOptions.find((category) => category.id === draftFilters.categoria),
    [draftFilters.categoria, filterCategoryOptions],
  );
  const setFilterLevel = useCallback((level, value) => {
    setDraftFilters((prev) => level === "pais"
      ? { pais: value, estado: "Todos", cidade: "Todos", categoria: prev.categoria }
      : level === "estado"
        ? { ...prev, estado: value, cidade: "Todos" }
        : level === "cidade"
          ? { ...prev, cidade: value }
          : { ...prev, categoria: value });
  }, []);
  const selectFilterLevel = useCallback((level, value) => {
    setFilterLevel(level, value);
    setFilterCountrySearch("");
    setFilterStateSearch("");
    setFilterCitySearch("");
    setFilterCategorySearch("");
    setIsFilterCountryPickerOpen(false);
    setIsFilterStatePickerOpen(false);
    setIsFilterCityPickerOpen(false);
    setIsFilterCategoryPickerOpen(false);
  }, [setFilterLevel]);
  const resetFilterPickerState = useCallback(() => {
    setFilterCountrySearch("");
    setFilterStateSearch("");
    setFilterCitySearch("");
    setFilterCategorySearch("");
    setIsFilterCountryPickerOpen(false);
    setIsFilterStatePickerOpen(false);
    setIsFilterCityPickerOpen(false);
    setIsFilterCategoryPickerOpen(false);
  }, []);
  const openFilters = useCallback(() => {
    setDraftFilters(filters);
    resetFilterPickerState();
    setShowFiltersModal(true);
  }, [filters, resetFilterPickerState]);
  const applyFilters = useCallback(() => {
    setFilters(draftFilters);
    resetFilterPickerState();
    setShowFiltersModal(false);
  }, [draftFilters, resetFilterPickerState]);
  const clearFilters = useCallback(() => {
    const emptyFilters = { pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" };
    setFilters(emptyFilters);
    setDraftFilters(emptyFilters);
    resetFilterPickerState();
  }, [resetFilterPickerState]);
  const clearDraftFilters = useCallback(() => {
    setDraftFilters({ pais: "Todos", estado: "Todos", cidade: "Todos", categoria: "Todos" });
    resetFilterPickerState();
  }, [resetFilterPickerState]);
  const activeFilterCount = (filters.pais !== "Todos" ? 1 : 0) + (filters.estado !== "Todos" ? 1 : 0) + (filters.cidade !== "Todos" ? 1 : 0) + (filters.categoria !== "Todos" ? 1 : 0);
  const draftFilterCount = (draftFilters.pais !== "Todos" ? 1 : 0) + (draftFilters.estado !== "Todos" ? 1 : 0) + (draftFilters.cidade !== "Todos" ? 1 : 0) + (draftFilters.categoria !== "Todos" ? 1 : 0);
  const filteredDataset = useMemo(() => dataset.filter((d) => (filters.pais === "Todos" || d.pais === filters.pais) && (filters.estado === "Todos" || d.estado === filters.estado) && (filters.cidade === "Todos" || d.cidade === filters.cidade) && (filters.categoria === "Todos" || d.categoryPath.some((category) => category.id === filters.categoria))), [dataset, filters]);
  useEffect(() => {
    const activeModal = showAccountModal ? "account" : showConnectModal ? "connect" : null;
    if (!activeModal) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setShowAccountModal(false);
      setShowConnectModal(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      const closeButtonRef = activeModal === "account" ? accountCloseButtonRef : connectCloseButtonRef;
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [showAccountModal, showConnectModal]);

  const leaves = useMemo(() => {
    if (!canJoinAsPlayer) return computeLeaves(filteredDataset);
    return computeLeaves([
      ...filteredDataset,
      {
        name: ADD_PLAYER_CELL_NAME,
        value: 16,
        color: "#262626",
        imageUrl: null,
        isAddCell: true,
      },
    ]);
  }, [filteredDataset, canJoinAsPlayer]);

  const leavesRef = useRef([]);
  const selectedCellRef = useRef(null);
  const cellSelectionTimerRef = useRef(null);
  const animatedCirclesRef = useRef(new Map());
  const visualValuesRef = useRef(new Map());
  const serverDatasetRef = useRef([]);
  const serverClockRef = useRef({
    serverTime: Date.now(),
    clientPerfAt: performance.now(),
  });
  const emojiEffectsRef = useRef(null);
  const emojiTargetsRef = useRef(new Map());
  const spawnedEmojiActionIdsRef = useRef(new Set());
  const pendingPlayerFocusRef = useRef(false);
  const playerFocusTimeoutRef = useRef(null);
  const personImagesRef = useRef(new Map());
  const activeActionIdsRef = useRef([]);
  const latestServerActionsRef = useRef(new Map());
  const visualActionTimelinesRef = useRef(new Map());
  const processedRealtimeEventIdsRef = useRef(new Set());
  const locallyCreatedActionIdsRef = useRef(new Set());
  const latestServerStateVersionRef = useRef(-1);
  const serverStateHydratedRef = useRef(false);
  const lastHitSequenceByActionRef = useRef(new Map());
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const fitTransformRef = useRef({ x: 0, y: 0, scale: 1 });
  const recenterAnimRef = useRef(null);
  const showRecenterRef = useRef(false);
  useEffect(() => { leavesRef.current = leaves; }, [leaves]);
  useEffect(() => () => {
    if (cellSelectionTimerRef.current !== null) {
      window.clearTimeout(cellSelectionTimerRef.current);
    }
  }, []);
  useEffect(() => {
    dataset.forEach((person) => {
      if (Number.isFinite(Number(person.value))) {
        visualValuesRef.current.set(person.name, Number(person.value));
      }
    });
  }, [dataset]);
  useEffect(() => { selectedCellRef.current = selectedCell; }, [selectedCell]);
  useEffect(() => { activeActionIdsRef.current = activeActions.map((a) => a.id); }, [activeActions]);
  const syncServerClock = useCallback((serverTime, clientPerfAt = performance.now()) => {
    if (!Number.isFinite(Number(serverTime))) return;
    serverClockRef.current = {
      serverTime: Number(serverTime),
      clientPerfAt,
    };
  }, []);
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
    if (!serverAction?.id) return;
    if (!activeActionIdsRef.current.includes(serverAction.id)) {
      activeActionIdsRef.current = [...activeActionIdsRef.current, serverAction.id];
    }
    const totalCount = Math.max(1, Number(serverAction.count) || 1);
    const hasVisualTimeline = visualActionTimelinesRef.current.has(serverAction.id);
    setActiveActions((prev) => {
      if (prev.some((action) => action.id === serverAction.id)) return prev;
      return [...prev, {
        id: serverAction.id,
        mode: serverAction.mode,
        level: serverAction.level,
        levelEmoji: serverAction.levelEmoji ?? null,
        levelName: serverAction.levelName ?? null,
        targetName: serverAction.targetName,
        count: totalCount,
        hitCount: hasVisualTimeline
          ? 0
          : Math.min(totalCount, Math.max(0, Number(serverAction.hitCount) || 0)),
        lastHitAt: serverAction.lastHitAt ?? null,
        firedAt: performance.now(),
      }];
    });
  }, []);
  const executeActionRef = useRef(executeAction);
  useEffect(() => { executeActionRef.current = executeAction; }, [executeAction]);
  const spawnActionEmojis = useCallback((serverAction) => {
    const actionId = String(serverAction?.id ?? "");
    const targetName = String(serverAction?.targetName ?? "");
    if (!actionId || !targetName) return;

    const spawnedActions = spawnedEmojiActionIdsRef.current;
    if (spawnedActions.has(actionId)) return;
    spawnedActions.add(actionId);
    if (spawnedActions.size > 2000) {
      const oldestActionId = spawnedActions.values().next().value;
      if (oldestActionId) spawnedActions.delete(oldestActionId);
    }

    const count = Math.min(50_000, Math.max(1, Math.floor(Number(serverAction.count) || 1)));
    const serverNow = serverClockRef.current.serverTime
      + (performance.now() - serverClockRef.current.clientPerfAt);
    const startedAt = Number(serverAction.startedAt);
    const visualStartAt = Number.isFinite(startedAt)
      ? Math.max(startedAt, serverNow)
      : serverNow;
    const actionType = String(serverAction.actionType || "hate");
    const configuredDurationMs = Number(serverAction.duration);
    const durationMs = Math.max(
      240,
      Number.isFinite(configuredDurationMs) && configuredDurationMs > 0
        ? configuredDurationMs
        : actionType === "fan" ? 1500 : 1650,
    );
    const staggerMs = Math.min(
      2_000,
      Math.max(4, Number(serverAction.staggerMs) || 0),
    );
    visualActionTimelinesRef.current.set(actionId, {
      startAt: visualStartAt,
      count,
      durationMs,
      staggerMs,
    });
    const startDelayMs = Number.isFinite(startedAt)
      ? Math.max(0, startedAt - serverNow)
      : 0;
    emojiEffectsRef.current?.spawn({
      targetName,
      emoji: String(
        serverAction.levelEmoji
          || (serverAction.actionType === "fan" ? "❤️" : "💢"),
      ),
      count,
      actionType,
      staggerMs,
      durationMs,
      startDelayMs,
    });
    realtimeDebug("action:emoji-burst", {
      actionId,
      targetName,
      count,
      actionType: serverAction.actionType,
      staggerMs: serverAction.staggerMs,
      durationMs: serverAction.duration,
    });
  }, []);
  const handleActionHit = useCallback((hit) => {
    const actionId = hit?.actionId;
    const hitIndex = Number(hit?.hitIndex);
    const eventId = String(hit?.eventId ?? `${actionId}:${hitIndex}`);
    if (!actionId || !Number.isFinite(hitIndex) || processedRealtimeEventIdsRef.current.has(eventId)) return;
    processedRealtimeEventIdsRef.current.add(eventId);
    if (processedRealtimeEventIdsRef.current.size > 2000) {
      const oldestEventId = processedRealtimeEventIdsRef.current.values().next().value;
      processedRealtimeEventIdsRef.current.delete(oldestEventId);
    }
    const previousSequence = Number(lastHitSequenceByActionRef.current.get(actionId) || 0);
    const sequence = Number(hit?.sequence) || hitIndex;
    if (sequence <= previousSequence) return;
    lastHitSequenceByActionRef.current.set(actionId, sequence);

    const targetName = String(hit?.targetName ?? "");
    const hitValue = Number(hit?.finalValue ?? hit?.value);
    if (targetName && Number.isFinite(hitValue)) {
      serverDatasetRef.current = serverDatasetRef.current.map((person) => (
        person.name === targetName ? { ...person, value: hitValue } : person
      ));
      visualValuesRef.current.set(targetName, hitValue);
      setDataset((prev) => prev.map((person) => (
        person.name === targetName ? { ...person, value: hitValue } : person
      )));
    }

    setActiveActions((prev) => prev.map((action) => action.id === actionId
      ? {
          ...action,
          hitCount: Math.min(
            Number(action.count) || 0,
            Math.max(Number(action.hitCount) || 0, hitIndex),
          ),
          lastHitAt: Number(hit?.hitAt) || action.lastHitAt,
        }
      : action));

  }, []);
  const startResolvedAction = useCallback((serverAction, resolvedEvent) => {
    const actionId = serverAction?.id || resolvedEvent?.actionId;
    const eventId = resolvedEvent?.eventId || actionId;
    if (!actionId || !eventId || processedRealtimeEventIdsRef.current.has(eventId)) return;
    processedRealtimeEventIdsRef.current.add(eventId);
    if (processedRealtimeEventIdsRef.current.size > 1000) {
      const oldestEventId = processedRealtimeEventIdsRef.current.values().next().value;
      processedRealtimeEventIdsRef.current.delete(oldestEventId);
    }
    const targetName = resolvedEvent?.targetName || serverAction.targetName;
    const eventFinalValue = Number(resolvedEvent?.finalValue);
    if (targetName && Number.isFinite(eventFinalValue)) {
      serverDatasetRef.current = serverDatasetRef.current.map((person) => (
        person.name === targetName ? { ...person, value: eventFinalValue } : person
      ));
      visualValuesRef.current.set(targetName, eventFinalValue);
      setDataset((prev) => prev.map((person) => (
        person.name === targetName ? { ...person, value: eventFinalValue } : person
      )));
    }
    latestServerActionsRef.current.delete(actionId);
    locallyCreatedActionIdsRef.current.delete(actionId);
    spawnedEmojiActionIdsRef.current.delete(actionId);
    visualActionTimelinesRef.current.delete(actionId);
    lastHitSequenceByActionRef.current.delete(actionId);
    setQueue((prev) => prev.filter((action) => action.id !== actionId));
    setActiveActions((prev) => prev.filter((action) => action.id !== actionId));
    activeActionIdsRef.current = activeActionIdsRef.current.filter((id) => id !== actionId);
    realtimeDebug("action:resolved", {
      eventId,
      actionId,
      targetName,
      finalValue: Number.isFinite(eventFinalValue) ? eventFinalValue : null,
    });
  }, []);
  const startResolvedActionRef = useRef(startResolvedAction);
  useEffect(() => { startResolvedActionRef.current = startResolvedAction; }, [startResolvedAction]);
  const queueAction = useCallback((serverAction) => {
    if (!serverAction?.id) return;
    if (serverAction.status !== "queued" && serverAction.status !== "running") {
      latestServerActionsRef.current.delete(serverAction.id);
      setQueue((prev) => prev.filter((action) => action.id !== serverAction.id));
      setActiveActions((prev) => prev.filter((action) => action.id !== serverAction.id));
      realtimeDebug("action:removed-from-live-state", {
        actionId: serverAction.id,
        status: serverAction.status,
      });
      return;
    }
    latestServerActionsRef.current.set(serverAction.id, serverAction);
    if (activeActionIdsRef.current.includes(serverAction.id)) {
      setActiveActions((prev) => prev.map((action) => action.id === serverAction.id
        ? (() => {
            const count = Math.max(
              Number(action.count) || 0,
              Number(serverAction.count) || 0,
            );
            const hitCount = Math.min(
              count,
              Math.max(
                Number(action.hitCount) || 0,
                Number(serverAction.hitCount) || 0,
              ),
            );
            const lastHitAt = Math.max(
              Number(action.lastHitAt) || 0,
              Number(serverAction.lastHitAt) || 0,
            );
            return {
              ...action,
              count,
              hitCount,
              levelEmoji: serverAction.levelEmoji ?? action.levelEmoji ?? null,
              levelName: serverAction.levelName ?? action.levelName ?? null,
              lastHitAt: lastHitAt > 0 ? lastHitAt : null,
            };
          })()
        : action));
      return;
    }

    if (serverAction.status === "running") {
      setQueue((prev) => prev.filter((action) => action.id !== serverAction.id));
      executeActionRef.current(serverAction);
      return;
    }

    const serverNow = serverClockRef.current.serverTime
      + (performance.now() - serverClockRef.current.clientPerfAt);
    const localExecuteAt = performance.now() + Math.max(0, serverAction.executeAt - serverNow);
    setQueue((prev) => {
      if (prev.some((queuedAction) => queuedAction.id === serverAction.id)) return prev;
      return [...prev, { ...serverAction, localExecuteAt }];
    });
    realtimeDebug("action:queued", {
      actionId: serverAction.id,
      executeAt: serverAction.executeAt,
    });
  }, []);
  const removeRealtimeAction = useCallback((actionId, options = {}) => {
    if (!actionId) return;
    latestServerActionsRef.current.delete(actionId);
    locallyCreatedActionIdsRef.current.delete(actionId);
    spawnedEmojiActionIdsRef.current.delete(actionId);
    visualActionTimelinesRef.current.delete(actionId);
    setQueue((prev) => prev.filter((action) => action.id !== actionId));
    setActiveActions((prev) => {
      const next = prev.filter((action) => action.id !== actionId);
      activeActionIdsRef.current = next.map((action) => action.id);
      return next;
    });
    realtimeDebug("action:removed", { actionId, preserveImpacts: Boolean(options.preserveImpacts) });
  }, []);
  const reconcileServerState = useCallback((serverState, options = {}) => {
    const incomingStateVersion = Number(serverState?.stateVersion);
    if (!Number.isFinite(incomingStateVersion)) return;
    const resetVisuals = options.resetVisuals === true;
    if (!resetVisuals && incomingStateVersion < latestServerStateVersionRef.current) return;
    latestServerStateVersionRef.current = incomingStateVersion;

    if (resetVisuals) {
      // A snapshot is the present, not a replay buffer. It updates the board
      // and never replays old emoji events.
      emojiEffectsRef.current?.clear();
      spawnedEmojiActionIdsRef.current.clear();
      visualActionTimelinesRef.current.clear();
      latestServerActionsRef.current.clear();
      lastHitSequenceByActionRef.current.clear();
      activeActionIdsRef.current = [];
      setQueue([]);
      setActiveActions([]);
    }
    if (Array.isArray(serverState?.dataset)) {
      serverDatasetRef.current = serverState.dataset;
    }
    serverStateHydratedRef.current = true;

    const incomingActions = (Array.isArray(serverState?.actions) ? serverState.actions : [])
      .map((serverAction) => {
        const previousAction = latestServerActionsRef.current.get(serverAction.id);
        if (!previousAction) return serverAction;

        const count = Math.max(
          1,
          Number(serverAction.count) || Number(previousAction.count) || 1,
        );
        const previousHitCount = Math.max(0, Number(previousAction.hitCount) || 0);
        const nextHitCount = Math.max(0, Number(serverAction.hitCount) || 0);
        const lastHitAt = Math.max(
          Number(previousAction.lastHitAt) || 0,
          Number(serverAction.lastHitAt) || 0,
        );

        return {
          ...serverAction,
          // A queued snapshot arriving after a running snapshot is stale.
          status: previousAction.status === "running" && serverAction.status === "queued"
            ? "running"
            : serverAction.status,
          hitCount: Math.min(count, Math.max(previousHitCount, nextHitCount)),
          startedAt: serverAction.startedAt ?? previousAction.startedAt ?? null,
          lastHitAt: lastHitAt > 0 ? lastHitAt : null,
        };
      });
    incomingActions.forEach((serverAction) => {
      locallyCreatedActionIdsRef.current.delete(serverAction.id);
    });
    const incomingActionIds = new Set(incomingActions.map((action) => action.id));
    locallyCreatedActionIdsRef.current.forEach((id) => incomingActionIds.add(id));
    if (Array.isArray(serverState?.dataset)) {
      serverDatasetRef.current = serverState.dataset;
      incomingActions.forEach((serverAction) => {
        latestServerActionsRef.current.set(serverAction.id, serverAction);
        queueAction(serverAction);
      });
      setDataset(serverState.dataset);
    }

    if (serverStateHydratedRef.current && !resetVisuals) {
      setQueue((prev) => prev.filter((action) => incomingActionIds.has(action.id)));
      setActiveActions((prev) => {
        const next = prev.filter((action) => incomingActionIds.has(action.id));
        activeActionIdsRef.current = next.map((action) => action.id);
        return next;
      });
      for (const id of latestServerActionsRef.current.keys()) {
        if (!incomingActionIds.has(id)) {
          latestServerActionsRef.current.delete(id);
          visualActionTimelinesRef.current.delete(id);
        }
      }
    }
    serverStateHydratedRef.current = true;
    realtimeDebug("snapshot:applied", {
      stateVersion: incomingStateVersion,
      actionCount: incomingActions.length,
      resetVisuals,
    });
  }, [queueAction, spawnActionEmojis]);
  useEffect(() => {
    if (bootstrapQuery.data?.state) {
      reconcileServerState(bootstrapQuery.data.state, { resetVisuals: true });
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
    let clockTimer;
    let stopped = false;

    function connect() {
      const nextSocket = new WebSocket(getWebSocketUrl());
      socket = nextSocket;

      nextSocket.onopen = () => {
        setIsRealtimeConnected(true);
        const clientTime = performance.now();
        nextSocket.send(JSON.stringify({ type: "clock:ping", clientTime }));
        clockTimer = window.setInterval(() => {
          if (nextSocket.readyState !== WebSocket.OPEN) return;
          const pingTime = performance.now();
          nextSocket.send(JSON.stringify({ type: "clock:ping", clientTime: pingTime }));
        }, 5000);
      };

      nextSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === "clock:pong") {
            const receivedAt = performance.now();
            const sentAt = Number(message.clientTime);
            const roundTripMs = Number.isFinite(sentAt)
              ? Math.max(0, receivedAt - sentAt)
              : 0;
            syncServerClock(
              Number(message.serverTime) + roundTripMs / 2,
              receivedAt,
            );
            return;
          }
          if (Number.isFinite(Number(message?.serverTime))) {
            syncServerClock(message.serverTime);
          }
          if (
            message?.type === "action:started"
            && message.action
          ) {
            spawnActionEmojis(message.action);
            queueAction(message.action);
            realtimeDebug("action:server-authorized", {
              actionId: message.action.id,
              executeAt: message.action.executeAt,
              completesAt: message.action.completesAt,
            });
            return;
          }
          if (
            message?.type === "action:hit"
            && message.hit
          ) {
            handleActionHit(message.hit);
            return;
          }
          if (
            message?.type === "action:resolved"
            && message.action
            && message.event
          ) {
            startResolvedActionRef.current(message.action, message.event);
            return;
          }
          if (message?.type === "action:cancelled" && message.actionId) {
            removeRealtimeAction(message.actionId, { preserveImpacts: true });
            realtimeDebug("action:cancelled", { actionId: message.actionId });
            return;
          }
          if (message?.type === "snapshot") {
            if (!message?.state?.dataset || !Array.isArray(message.state.actions)) return;
            reconcileServerState(message.state, {
              resetVisuals: !serverStateHydratedRef.current,
            });
            return;
          }
          if (!message?.state?.dataset || !Array.isArray(message.state.actions)) return;

          reconcileServerState(message.state);
        } catch {
          // Ignore malformed messages and let the polling fallback reconcile state.
        }
      };

      nextSocket.onclose = () => {
        setIsRealtimeConnected(false);
        window.clearInterval(clockTimer);
        if (!stopped) retryTimer = window.setTimeout(connect, 2000);
      };
      nextSocket.onerror = () => nextSocket.close();
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(clockTimer);
      setIsRealtimeConnected(false);
      socket?.close();
    };
  }, [
    config,
    handleActionHit,
    removeRealtimeAction,
    reconcileServerState,
    spawnActionEmojis,
    syncServerClock,
  ]);
  const getRemainingUnits = useCallback((item) => {
    return Math.max(
      0,
      (Number(item.count) || 0) - (Number(item.hitCount) || 0),
    );
  }, []);
  const getActionTiming = useCallback((item, now) => {
    if (item.kind === "queued") {
      const secondsLeft = Math.max(0, (item.localExecuteAt - now) / 1000);
      return { timeLabel: secondsLeft > 0 ? `Inicia em ${secondsLeft.toFixed(1)}s` : "0%", progress: 0 };
    }
    const totalCount = item.count;
    if (!totalCount) return { timeLabel: "—", progress: 0 };
    const timeline = visualActionTimelinesRef.current.get(item.id);
    let landed = Math.max(0, Number(item.hitCount) || 0);
    if (timeline) {
      const serverNow = serverClockRef.current.serverTime
        + (now - serverClockRef.current.clientPerfAt);
      const firstImpactAt = timeline.startAt + timeline.durationMs;
      const scheduledImpacts = serverNow < firstImpactAt
        ? 0
        : Math.floor((serverNow - firstImpactAt) / timeline.staggerMs) + 1;
      // This is the same schedule used by the WebGL projectiles. Confirmed
      // server hits remain a fallback for actions restored without animation.
      landed = Math.min(
        timeline.count,
        Math.max(0, scheduledImpacts),
      );
    }
    landed = Math.min(totalCount, landed);
    const percentage = Math.round((landed / totalCount) * 100);
    return { timeLabel: `${percentage}%`, progress: landed / totalCount };
  }, []);

  useEffect(() => {
    if (queue.length === 0 && activeActions.length === 0) return undefined;
    const hudTimer = window.setInterval(() => {
      // The local clock only updates the queue countdown. The server must
      // promote the action to `running` before its emoji burst is spawned.
      // Otherwise the canvas could show feedback before the action exists in
      // the realtime ledger.
      forceTick((t) => t + 1);
    }, 100);
    return () => window.clearInterval(hudTimer);
  }, [queue.length > 0, activeActions.length > 0]);
  useEffect(() => { if (queue.length === 0 && activeActions.length === 0) setShowQueueModal(false); }, [queue.length, activeActions.length]);
  const liveActionEntries = useMemo(() => [
    ...[...activeActions]
      .sort((a, b) => getRemainingUnits(a) - getRemainingUnits(b))
      .map((action) => ({ kind: "firing", ...action })),
    ...[...queue]
      .sort((a, b) => a.localExecuteAt - b.localExecuteAt)
      .map((action) => ({ kind: "queued", ...action })),
  ], [activeActions, getRemainingUnits, queue]);

  const openPlayerSignup = useCallback(async ({ autoJoin = false } = {}) => {
    if (!canJoinAsPlayer || isJoiningPlayer || isLoadingPlayerRegistration) return;
    setShowPlayerSignup(true);
    setIsLoadingPlayerRegistration(true);
    setJoinPlayerError(null);
    setHasAcceptedPlayerTerms(autoJoin);
    setIsPlayerCategoryPickerOpen(false);
    setPlayerCategorySearch("");
    setExpandedPlayerCategoryIds(new Set());
    try {
      const response = await fetch(getApiEndpoint("/api/pop-person/player/registration"), {
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível carregar seu cadastro.");
      }
      const data = await response.json();
      setPlayerRegistration(data);
      setPlayerCategoryId(data.defaultCategoryId || data.categories?.[0]?.id || "");
      playerLocationEditedRef.current = false;
      setPlayerLocation(getSuggestedPlayerLocation(accessLocationQuery.data));
      setIsEditingPlayerLocation(false);
    } catch (error) {
      setShowPlayerSignup(false);
      setJoinPlayerError(error instanceof Error ? error.message : "Não foi possível carregar seu cadastro.");
    } finally {
      setIsLoadingPlayerRegistration(false);
    }
  }, [accessLocationQuery.data, canJoinAsPlayer, isJoiningPlayer, isLoadingPlayerRegistration]);
  const playerLocationComplete = Boolean(
    playerLocation.city.trim() &&
    playerLocation.region.trim() &&
    playerLocation.country.trim(),
  );
  useEffect(() => {
    if (!isEditingPlayerLocation || !isPlayerLocationPickerOpen) return undefined;
    const query = playerLocationSearch.trim();
    if (query.length < 2) {
      setPlayerLocationResults([]);
      setIsSearchingPlayerLocation(false);
      setPlayerLocationSearchError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingPlayerLocation(true);
      setPlayerLocationSearchError(null);
      try {
        const data = await searchCities({ q: query }, { signal: controller.signal });
        setPlayerLocationResults(data.results ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPlayerLocationResults([]);
        setPlayerLocationSearchError("Não foi possível buscar cidades agora.");
      } finally {
        if (!controller.signal.aborted) setIsSearchingPlayerLocation(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isEditingPlayerLocation, isPlayerLocationPickerOpen, playerLocationSearch]);
  useEffect(() => {
    if (!activeFilterLocationSearch) {
      setFilterLocationSearchResults([]);
      setIsSearchingFilterLocation(false);
      setFilterLocationSearchError(null);
      return undefined;
    }

    const query = activeFilterLocationSearch.query.trim();
    if (query.length < 2) {
      setFilterLocationSearchResults([]);
      setIsSearchingFilterLocation(false);
      setFilterLocationSearchError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingFilterLocation(true);
      setFilterLocationSearchError(null);
      try {
        if (activeFilterLocationSearch.level === "pais") {
          const data = await searchCountries({ q: query }, { signal: controller.signal });
          setFilterLocationSearchResults((data.results ?? []).map((result) => ({
            id: result.code2,
            city: result.name,
            region: result.name,
            country: result.name,
            countryCode: result.code2,
            latitude: 0,
            longitude: 0,
          })));
          return;
        }

        const data = await searchCities({ q: query }, { signal: controller.signal });
        const results = (data.results ?? []).filter((result) => {
          if (draftFilters.pais !== "Todos" && result.country !== draftFilters.pais) return false;
          if (activeFilterLocationSearch.level === "estado") {
            return result.region && result.region !== result.country;
          }
          return draftFilters.estado === "Todos" || result.region === draftFilters.estado;
        });
        setFilterLocationSearchResults(results);
      } catch (error) {
        if (controller.signal.aborted) return;
        setFilterLocationSearchResults([]);
        setFilterLocationSearchError("Não foi possível buscar locais agora.");
      } finally {
        if (!controller.signal.aborted) setIsSearchingFilterLocation(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    activeFilterLocationSearch,
    draftFilters.estado,
    draftFilters.pais,
  ]);
  useEffect(() => {
    if (!showPlayerSignup || playerLocationEditedRef.current) return;
    const suggestedLocation = getSuggestedPlayerLocation(accessLocationQuery.data);
    if (suggestedLocation.city && suggestedLocation.region && suggestedLocation.country) {
      setPlayerLocation(suggestedLocation);
    }
  }, [accessLocationQuery.data, showPlayerSignup]);
  const joinPlayer = useCallback(async () => {
    if (!canJoinAsPlayer || isJoiningPlayer || !playerCategoryId || !playerLocationComplete || !hasAcceptedPlayerTerms) return;
    setIsJoiningPlayer(true);
    setJoinPlayerError(null);
    pendingPlayerFocusRef.current = true;
    try {
      const response = await fetch(getApiEndpoint("/api/pop-person/player"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: playerCategoryId,
          termsAccepted: hasAcceptedPlayerTerms,
          location: {
            city: playerLocation.city,
            region: playerLocation.region,
            country: playerLocation.country,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível entrar na disputa. Tente novamente.");
      }
      await Promise.all([bootstrapQuery.refetch(), stateQuery.refetch()]);
      pendingAutoJoinRef.current = false;
      setShowPlayerSignup(false);
    } catch (error) {
      pendingPlayerFocusRef.current = false;
      setJoinPlayerError(error instanceof Error ? error.message : "Não foi possível entrar na disputa. Tente novamente.");
    } finally {
      setIsJoiningPlayer(false);
    }
  }, [bootstrapQuery.refetch, canJoinAsPlayer, hasAcceptedPlayerTerms, isJoiningPlayer, playerCategoryId, playerLocation, playerLocationComplete, stateQuery.refetch]);
  useEffect(() => {
    if (!authenticatedUser || pendingAutoJoinRef.current) return;
    if (!canJoinAsPlayer) {
      try {
        window.sessionStorage.removeItem(PENDING_PLAYER_JOIN_STORAGE_KEY);
      } catch {
        // Ignore storage restrictions; the authenticated state is authoritative.
      }
      return;
    }
    let shouldAutoJoin = false;
    try {
      const storedIntent = window.sessionStorage.getItem(PENDING_PLAYER_JOIN_STORAGE_KEY);
      if (storedIntent) {
        window.sessionStorage.removeItem(PENDING_PLAYER_JOIN_STORAGE_KEY);
        if (storedIntent === "1") {
          shouldAutoJoin = true;
        } else {
          const createdAt = Number(JSON.parse(storedIntent)?.createdAt);
          shouldAutoJoin = Number.isFinite(createdAt)
            && Date.now() - createdAt >= 0
            && Date.now() - createdAt <= PENDING_PLAYER_JOIN_MAX_AGE_MS;
        }
      }
    } catch {
      shouldAutoJoin = false;
    }
    if (!shouldAutoJoin) return;

    pendingAutoJoinRef.current = true;
    autoJoinSubmittedRef.current = false;
    void openPlayerSignup({ autoJoin: true });
  }, [authenticatedUser, canJoinAsPlayer, openPlayerSignup]);
  useEffect(() => {
    if (
      !pendingAutoJoinRef.current
      || autoJoinSubmittedRef.current
      || !showPlayerSignup
      || isLoadingPlayerRegistration
      || !playerRegistration
      || !playerCategoryId
      || !playerLocationComplete
      || !hasAcceptedPlayerTerms
      || isJoiningPlayer
    ) return;

    autoJoinSubmittedRef.current = true;
    void joinPlayer();
  }, [
    hasAcceptedPlayerTerms,
    isJoiningPlayer,
    isLoadingPlayerRegistration,
    joinPlayer,
    playerCategoryId,
    playerLocationComplete,
    playerRegistration,
    showPlayerSignup,
  ]);
  const openModal = useCallback((mode) => {
    const actionType = actionTypeByMode[mode];
    setPendingMode(mode);
    setModalLevel(levelsByActionType[actionType]?.[0]?.key ?? "");
  }, [actionTypeByMode, levelsByActionType]);
  const selectCell = useCallback((name) => {
    if (cellSelectionTimerRef.current !== null) {
      window.clearTimeout(cellSelectionTimerRef.current);
    }
    // Wait until the browser finishes the originating pointer sequence
    // before mounting the modal. Otherwise its newly rendered buttons can
    // receive that same click.
    cellSelectionTimerRef.current = window.setTimeout(() => {
      cellSelectionTimerRef.current = null;
      if (name === ADD_PLAYER_CELL_NAME) {
        void openPlayerSignup();
        return;
      }
      setSelectedCell((prev) => prev === name ? null : name);
      openModal("defender");
    }, 60);
  }, [openModal, openPlayerSignup]);
  const closeModal = useCallback(() => {
    setPendingMode(null);
    setSelectedCell(null);
  }, []);
  const confirmAction = useCallback(() => {
    if (!authenticatedUser) {
      closeModal();
      setConnectPurpose("action");
      setShowConnectModal(true);
      return;
    }
    if (!pendingMode || !selectedActionType || !selectedLevel || !selectedCell || submittingActionRef.current) return;
    const requestFingerprint = [selectedActionType.key, modalLevel, selectedCell].join("|");
    if (idempotencyPayloadRef.current !== requestFingerprint) {
      idempotencyPayloadRef.current = requestFingerprint;
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    submittingActionRef.current = true;
    createActionMutation.mutate(
      {
        data: {
          actionType: selectedActionType.key,
          level: modalLevel,
          targetName: selectedCell,
          idempotencyKey: idempotencyKeyRef.current,
        },
      },
      {
        onSuccess: (action) => {
          submittingActionRef.current = false;
          idempotencyKeyRef.current = null;
          idempotencyPayloadRef.current = "";
           // The POST only confirms that the action was queued. Animation may
           // start only after the server publishes action:started.
           queueAction(action);
          closeModal();
          setSelectedCell(null);
        },
        onError: (error) => {
          // Keep the same key for a retry of the same request. This protects
          // against a response lost after the server committed the action.
          submittingActionRef.current = false;
          if (error?.status === 401) {
            closeModal();
            setConnectPurpose("action");
            setShowConnectModal(true);
          }
        },
      },
    );
  }, [authenticatedUser, pendingMode, selectedActionType, selectedLevel, modalLevel, selectedCell, closeModal, createActionMutation, queueAction]);
  const selectedCellData = useMemo(() => leaves.find((l) => l.name === selectedCell) || null, [leaves, selectedCell]);
  const selectedActionPrice = useMemo(
    () => getActionTotalPrice(selectedCellData?.basePrice, selectedLevel),
    [selectedCellData?.basePrice, selectedLevel],
  );
  const selectedPopularityRank = useMemo(() => {
    if (!selectedCellData) return null;
    const ranked = [...leaves].sort((a, b) => Number(b.value) - Number(a.value));
    const index = ranked.findIndex((person) => person.name === selectedCellData.name);
    return index >= 0 ? index + 1 : null;
  }, [leaves, selectedCellData]);
  function cssSize() {
    const r = boardWrapRef.current.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  const getFitTransform = useCallback(() => {
    const { w: cw, h: ch } = cssSize();
    const nodes = leavesRef.current;
    if (nodes.length === 0) {
      const scale = Math.min((cw - 32) / 100, (ch - 32) / 100);
      return { scale, x: (cw - 100 * scale) / 2, y: (ch - 100 * scale) / 2 };
    }

    const minX = Math.min(...nodes.map((node) => node.x - node.r));
    const maxX = Math.max(...nodes.map((node) => node.x + node.r));
    const minY = Math.min(...nodes.map((node) => node.y - node.r));
    const maxY = Math.max(...nodes.map((node) => node.y + node.r));
    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const scale = Math.min((cw - 32) / worldWidth, (ch - 32) / worldHeight);
    return {
      scale,
      x: (cw - worldWidth * scale) / 2 - minX * scale,
      y: (ch - worldHeight * scale) / 2 - minY * scale,
    };
  }, []);
  const fitToView = useCallback(() => {
    if (!boardWrapRef.current) return;
    const fit = getFitTransform();
    fitTransformRef.current = fit;
    transformRef.current = fit;
  }, [getFitTransform]);
  const recenterView = useCallback(() => {
    const fit = getFitTransform();
    fitTransformRef.current = fit;
    recenterAnimRef.current = { from: { ...transformRef.current }, to: fit, startTime: performance.now(), duration: 380 };
  }, [getFitTransform]);
  const initialFitAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialFitAppliedRef.current && dataset.length > 0 && leaves.length > 0) {
      initialFitAppliedRef.current = true;
      fitToView();
    }
  }, [dataset.length, leaves.length, fitToView]);
  const clampScale = (s) => Math.min(Math.max(s, MIN_ZOOM), MAX_ZOOM);
  const focusPlayer = useCallback(() => {
    if (!playerName || !boardWrapRef.current) return false;

    const player = leavesRef.current.find((leaf) => leaf.name === playerName);
    if (!player) {
      // A location/category filter can hide the player. Clearing it makes
      // "Eu" reliable instead of silently doing nothing.
      if (activeFilterCount > 0) {
        pendingPlayerFocusRef.current = true;
        clearFilters();
      }
      return false;
    }

    const circle = animatedCirclesRef.current.get(playerName);
    const centerX = circle?.x ?? player.x;
    const centerY = circle?.y ?? player.y;
    const radius = Math.max(1, circle?.r ?? player.r);
    const { w, h } = cssSize();
    const targetScreenRadius = Math.min(92, Math.max(56, Math.min(w, h) * 0.16));
    const targetScale = clampScale(targetScreenRadius / radius);
    const targetTransform = {
      scale: targetScale,
      x: w / 2 - centerX * targetScale,
      y: h / 2 - centerY * targetScale,
    };

    pendingPlayerFocusRef.current = false;
    recenterAnimRef.current = {
      from: { ...transformRef.current },
      to: targetTransform,
      startTime: performance.now(),
      duration: 480,
    };
    return true;
  }, [activeFilterCount, clearFilters, playerName]);

  useEffect(() => {
    if (!pendingPlayerFocusRef.current || !playerName) return;
    const player = leavesRef.current.find((leaf) => leaf.name === playerName);
    if (!player) {
      if (activeFilterCount > 0) {
        pendingPlayerFocusRef.current = true;
        clearFilters();
      }
      return;
    }
    if (playerFocusTimeoutRef.current !== null) return;

    playerFocusTimeoutRef.current = window.setTimeout(() => {
      playerFocusTimeoutRef.current = null;
      if (pendingPlayerFocusRef.current) {
        focusPlayer();
      }
    }, PLAYER_AUTO_FOCUS_DELAY_MS);
  }, [focusPlayer, leaves, playerName]);

  useEffect(() => {
    return () => {
      if (playerFocusTimeoutRef.current !== null) {
        window.clearTimeout(playerFocusTimeoutRef.current);
        playerFocusTimeoutRef.current = null;
      }
    };
  }, []);

  const seedMissingRects = useCallback(() => {
    const names = new Set();
    leavesRef.current.forEach((l) => {
      names.add(l.name);
      const visualValue = Number(visualValuesRef.current.get(l.name));
      const radius = l.isAddCell
        ? getAddPlayerCellWorldRadius(transformRef.current.scale)
        : Number.isFinite(visualValue)
          ? Math.sqrt(Math.max(0, visualValue)) * 3.2
          : l.r;
      const current = animatedCirclesRef.current.get(l.name);
      if (!current) {
        animatedCirclesRef.current.set(l.name, {
          x: l.x,
          y: l.y,
          r: radius,
        });
        return;
      }

      // Cell size follows the authoritative value immediately. Action feedback
      // is rendered exclusively by the WebGL emoji layer.
      current.r = radius;
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
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);
    const selName = selectedCellRef.current;
    leavesRef.current.forEach((node) => {
      const c = animatedCirclesRef.current.get(node.name);
      if (!c) return;
      const renderRadius = node.isAddCell
        ? getAddPlayerCellWorldRadius(t.scale)
        : c.r;
      const screenR = renderRadius * t.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, renderRadius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (node.isAddCell) {
        ctx.save();
        ctx.lineWidth = 1.5 / t.scale;
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.setLineDash([5 / t.scale, 5 / t.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        const plusSize = Math.min(renderRadius * 0.72, 24 / t.scale);
        ctx.lineWidth = 2.2 / t.scale;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.moveTo(c.x - plusSize, c.y);
        ctx.lineTo(c.x + plusSize, c.y);
        ctx.moveTo(c.x, c.y - plusSize);
        ctx.lineTo(c.x, c.y + plusSize);
        ctx.stroke();
        ctx.restore();
        return;
      }
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
      const fontSizeScreen = getStableCellTextSize(screenR);
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
      seedMissingRects();
      const lerpFactor = 1 - Math.pow(0.001, dt / 1000);
      leavesRef.current.forEach((target) => {
        const a = animatedCirclesRef.current.get(target.name);
        if (a) {
          a.x += (target.x - a.x) * lerpFactor;
          a.y += (target.y - a.y) * lerpFactor;
        }
      });
      keepCirclesSeparated(
        leavesRef.current
          .map((target) => animatedCirclesRef.current.get(target.name))
          .filter(Boolean),
      );
      emojiTargetsRef.current.clear();
      animatedCirclesRef.current.forEach((circle, name) => {
        emojiTargetsRef.current.set(name, { x: circle.x, y: circle.y });
      });
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
    let multiPointerGesture = false;
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
      // Cell selection is handled explicitly on pointerup below. Prevent the
      // compatibility click from being retargeted to a modal button that may
      // be mounted before the browser finishes this same pointer sequence.
      e.preventDefault();
      recenterAnimRef.current = null;
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        // Once a second pointer joins, this interaction can only be a gesture.
        // Do not let releasing the last finger fall through to cell selection.
        multiPointerGesture = true;
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
      const wasClick = activePointers.size === 1 && dragging && !moved && !multiPointerGesture;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        pinchStartDist = null;
        pinchStartWorld = null;
      }
      if (activePointers.size === 1) {
        const [rem] = activePointers.values();
        dragging = true;
        lastX = rem.x;
        lastY = rem.y;
      } else if (activePointers.size === 0) {
        dragging = false;
        multiPointerGesture = false;
        if (wasClick) {
           const t = transformRef.current;
            const worldX = (px - t.x) / t.scale;
            const worldY = (py - t.y) / t.scale;
           const hit = leavesRef.current.find((l) => {
             const circle = animatedCirclesRef.current.get(l.name);
             if (!circle) return false;
             const renderRadius = l.isAddCell
               ? getAddPlayerCellWorldRadius(t.scale)
               : circle.r;
             return Math.hypot(worldX - circle.x, worldY - circle.y) <= renderRadius;
           });
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
        Não foi possível carregar o servidor do InstaPop. Tente atualizar a página.
      </div>
    );
  }

  if (bootstrapQuery.isLoading || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", backgroundColor: "#0a0a0a", color: "#a3a3a3", fontSize: "13px" }}>
        Carregando InstaPop…
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
          <img data-testid="image-brand" src="/instapop-logo.svg" alt="InstaPop" style={{ display: "block", width: "92px", height: "auto" }} />
        </div>
        {authenticatedUser ? (
          <button
            type="button"
            data-testid="button-account"
            aria-label="Abrir conta"
            title="Abrir conta"
            onClick={() => {
              logoutMutation.reset();
              setShowAccountModal(true);
            }}
            style={{ flexShrink: 0, width: "36px", height: "36px", padding: 0, overflow: "hidden", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.72)", backdropFilter: "blur(6px)", border: "1px solid rgba(255, 255, 255, 0.12)", color: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}
          >
            {authenticatedUser.avatarUrl ? (
              <img src={authenticatedUser.avatarUrl} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <CircleUserRound size={20} strokeWidth={1.8} aria-hidden="true" />
            )}
          </button>
        ) : (
          <button
            type="button"
            data-testid="button-auth"
            aria-label="Fazer autenticação"
            title="Fazer autenticação"
             onClick={() => {
               setConnectPurpose("player");
               setShowConnectModal(true);
             }}
            style={{ flexShrink: 0, width: "36px", height: "36px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.72)", backdropFilter: "blur(6px)", border: "1px solid rgba(255, 255, 255, 0.12)", color: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}
          >
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        )}
        <div className="action-pill-container" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", justifyContent: "center", containerType: "inline-size" }}>
          {liveActionEntries.length > 0 && (() => {
            const primaryEntry = liveActionEntries[0];
            const additionalEntryCount = Math.max(0, liveActionEntries.length - 1);
            const actionColor = primaryEntry.mode === "defender" ? "#22c55e" : "#ef4444";
            const actionDisplay = getActionDisplay(primaryEntry, levelByKey);
            const { timeLabel, progress } = getActionTiming(primaryEntry, performance.now());
            return (
              <button
                type="button"
                data-testid={`button-open-queue-${primaryEntry.id}`}
                onClick={() => setShowQueueModal(true)}
                style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: "7px", flex: "0 1 auto", minWidth: 0, maxWidth: "min(280px, 58vw)", padding: "7px 12px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.55)", backdropFilter: "blur(6px)", border: `1px solid ${actionColor}55`, cursor: "pointer" }}
              >
                {primaryEntry.kind === "firing" && <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, backgroundColor: `${actionColor}33` }} />}
                <span aria-hidden="true" style={{ position: "relative", flexShrink: 0, fontSize: "14px", lineHeight: 1 }}>{actionDisplay.emoji}</span>
                <span className="action-pill-target" style={{ position: "relative", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "1 1 auto", textAlign: "left" }}>{MODE_LABEL[primaryEntry.mode]} a {primaryEntry.targetName}</span>
                <span style={{ position: "relative", color: actionColor, fontFamily: "monospace", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{timeLabel}</span>
                {additionalEntryCount > 0 && (
                  <span style={{ position: "relative", flexShrink: 0, color: "#d4d4d4", fontSize: "11px", fontWeight: 800 }}>
                    +{additionalEntryCount}
                  </span>
                )}
              </button>
            );
          })()}
        </div>
        <button data-testid="button-open-filters" onClick={openFilters} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "5px", padding: "7px 12px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.55)", backdropFilter: "blur(6px)", border: activeFilterCount > 0 ? "1px solid rgba(99, 102, 241, 0.6)" : "1px solid rgba(255, 255, 255, 0.08)", color: "#f5f5f5", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
          <SlidersHorizontal size={13} /> Filtros
          {activeFilterCount > 0 && <span data-testid="text-filter-count" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", borderRadius: "9999px", backgroundColor: "#6366f1", color: "#fff", fontSize: "10px", fontWeight: 700, padding: "0 4px" }}>{activeFilterCount}</span>}
        </button>
      </div>

      <div ref={boardWrapRef} style={{ position: "fixed", top: 0, bottom: 0, left: 0, right: 0, zIndex: 1, overflow: "hidden" }}>
        <canvas data-testid="canvas-people" ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" }} />
        <EmojiEffectsWebGL
          ref={emojiEffectsRef}
          targetsRef={emojiTargetsRef}
          transformRef={transformRef}
          maxInstances={50000}
        />
        {joinPlayerError && (
          <div role="alert" style={{ position: "absolute", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 5, display: "flex", alignItems: "center", gap: "10px", maxWidth: "calc(100% - 32px)", padding: "10px 12px", borderRadius: "12px", backgroundColor: "rgba(69, 10, 10, 0.94)", border: "1px solid rgba(248, 113, 113, 0.45)", color: "#fecaca", fontSize: "12px", fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
            <span>{joinPlayerError}</span>
            <button type="button" onClick={() => setJoinPlayerError(null)} aria-label="Fechar aviso" style={{ border: "none", background: "transparent", color: "#fecaca", cursor: "pointer", padding: "2px" }}><X size={14} /></button>
          </div>
        )}
        {leaves.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "24px", textAlign: "center" }}>
            <Search size={28} strokeWidth={1.8} aria-hidden="true" style={{ color: "#737373" }} />
            <span data-testid="text-empty-state" style={{ color: "#f5f5f5", fontSize: "14px", fontWeight: 700 }}>Nenhuma pessoa encontrada</span>
            <span style={{ color: "#737373", fontSize: "12px" }}>Tente ajustar ou limpar os filtros aplicados</span>
            <button data-testid="button-adjust-filters" onClick={openFilters} style={{ marginTop: "6px", padding: "8px 16px", borderRadius: "9999px", backgroundColor: "#262626", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, border: "1px solid #333", cursor: "pointer" }}>Ajustar filtros</button>
          </div>
        )}
      </div>
      {showAccountModal && authenticatedUser && (
        <AccountModal
          user={authenticatedUser}
          onClose={() => setShowAccountModal(false)}
          onLogout={() => {
            if (logoutMutation.isPending) return;
            logoutMutation.mutate(undefined, {
              onSuccess: () => {
                setShowAccountModal(false);
                window.location.reload();
              },
            });
          }}
          isLoggingOut={logoutMutation.isPending}
          logoutError={logoutMutation.error}
          closeButtonRef={accountCloseButtonRef}
        />
      )}
      {showConnectModal && !authenticatedUser && (
        <ConnectXModal
          onClose={() => setShowConnectModal(false)}
          onConnect={() => {
            if (connectPurpose === "player") {
              try {
                window.sessionStorage.setItem(
                  PENDING_PLAYER_JOIN_STORAGE_KEY,
                  JSON.stringify({ createdAt: Date.now() }),
                );
              } catch {
                // The OAuth callback can still authenticate even if storage is unavailable.
              }
            }
            window.location.assign(getApiEndpoint("/api/auth/x/start?returnTo=/"));
          }}
          purpose={connectPurpose}
          closeButtonRef={connectCloseButtonRef}
        />
      )}
      {(playerName || showRecenter) && (
        <div style={{ position: "fixed", zIndex: 55, bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)", right: "calc(env(safe-area-inset-right, 0px) + 16px)", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
          {playerName && (
            <button
              data-testid="button-focus-player"
              type="button"
              onClick={focusPlayer}
              aria-label="Encontrar meu perfil"
              title="Encontrar meu perfil"
              style={{ width: "42px", height: "42px", padding: 0, borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(129, 140, 248, 0.65)", color: "#c7d2fe", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}
            >
              <ScanFace size={19} strokeWidth={2.1} aria-hidden="true" />
            </button>
          )}
          {showRecenter && (
            <button
              data-testid="button-recenter"
              type="button"
              onClick={recenterView}
              aria-label="Centralizar visualização"
              title="Centralizar visualização"
              style={{ width: "42px", height: "42px", borderRadius: "9999px", backgroundColor: "rgba(23, 23, 23, 0.75)", backdropFilter: "blur(6px)", border: "1px solid rgba(255, 255, 255, 0.12)", color: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }}
            >
              <Locate size={18} />
            </button>
          )}
        </div>
      )}

      {showFiltersModal && (
        <div onClick={() => setShowFiltersModal(false)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="filters-title" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "360px", maxHeight: "88vh", backgroundColor: "#171717", border: "1px solid #292929", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto", boxShadow: "0 8px 28px rgba(0,0,0,0.42)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ minWidth: 0 }}>
                <span id="filters-title" style={{ display: "block", color: "#fff", fontWeight: 800, fontSize: "18px", lineHeight: 1.2, letterSpacing: "-0.02em" }}>Filtros</span>
                <span style={{ display: "block", marginTop: "4px", color: "#a3a3a3", fontSize: "12px", lineHeight: 1.4 }}>Refine a visualização de popularidade.</span>
              </div>
              <button data-testid="button-close-filters" type="button" onClick={() => setShowFiltersModal(false)} aria-label="Fechar" title="Fechar" style={{ ...closeButtonStyle, flexShrink: 0 }}><X size={13} aria-hidden="true" /></button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Localidade</span>
                <div style={{ overflow: "hidden", borderRadius: "12px", backgroundColor: "#202020", border: "1px solid #2d2d2d" }}>
                  <FilterSearchPicker
                    label="País"
                    selectedLabel={draftFilters.pais === "Todos" ? "Todos os países" : draftFilters.pais}
                    options={activeFilterLocationSearch?.level === "pais" ? remoteFilterLocationOptions : []}
                    selected={draftFilters.pais}
                    onSelect={(value) => selectFilterLevel("pais", value)}
                    open={isFilterCountryPickerOpen}
                    onToggle={(next) => {
                      setIsFilterCountryPickerOpen((isOpen) => typeof next === "boolean" ? next : !isOpen);
                      setFilterCountrySearch("");
                      setIsFilterStatePickerOpen(false);
                      setIsFilterCityPickerOpen(false);
                      setIsFilterCategoryPickerOpen(false);
                    }}
                    search={filterCountrySearch}
                    onSearch={setFilterCountrySearch}
                    loading={isSearchingFilterLocation && activeFilterLocationSearch?.level === "pais"}
                    emptyMessage={filterLocationEmptyMessage}
                    clientFilter={false}
                    inputTestId="input-search-filter-country"
                    buttonTestId="button-open-filter-country"
                    allOptionTestId="option-filter-country-all"
                    listboxLabel="Resultados de países"
                    placeholder="Digite o nome do país"
                    allLabel="Todos os países"
                  />
                  <FilterSearchPicker
                    label="Estado / região"
                    selectedLabel={draftFilters.estado === "Todos" ? "Todos os estados / regiões" : draftFilters.estado}
                    options={activeFilterLocationSearch?.level === "estado" ? remoteFilterLocationOptions : []}
                    selected={draftFilters.estado}
                    onSelect={(value) => selectFilterLevel("estado", value)}
                    disabled={draftFilters.pais === "Todos"}
                    open={isFilterStatePickerOpen}
                    onToggle={(next) => {
                      setIsFilterStatePickerOpen((isOpen) => typeof next === "boolean" ? next : !isOpen);
                      setFilterStateSearch("");
                      setIsFilterCountryPickerOpen(false);
                      setIsFilterCityPickerOpen(false);
                      setIsFilterCategoryPickerOpen(false);
                    }}
                    search={filterStateSearch}
                    onSearch={setFilterStateSearch}
                    loading={isSearchingFilterLocation && activeFilterLocationSearch?.level === "estado"}
                    emptyMessage={filterLocationEmptyMessage}
                    inputTestId="input-search-filter-state"
                    buttonTestId="button-open-filter-state"
                    allOptionTestId="option-filter-state-all"
                    listboxLabel="Resultados de estados e regiões"
                    placeholder="Digite o nome do estado ou região"
                    allLabel="Todos os estados / regiões"
                  />
                  <FilterSearchPicker
                    label="Cidade"
                    selectedLabel={draftFilters.cidade === "Todos" ? "Todas as cidades" : draftFilters.cidade}
                    options={activeFilterLocationSearch?.level === "cidade" ? remoteFilterLocationOptions : []}
                    selected={draftFilters.cidade}
                    onSelect={(value) => selectFilterLevel("cidade", value)}
                    open={isFilterCityPickerOpen}
                    onToggle={(next) => {
                      setIsFilterCityPickerOpen((isOpen) => typeof next === "boolean" ? next : !isOpen);
                      setFilterCitySearch("");
                      setIsFilterCountryPickerOpen(false);
                      setIsFilterStatePickerOpen(false);
                      setIsFilterCategoryPickerOpen(false);
                    }}
                    search={filterCitySearch}
                    onSearch={setFilterCitySearch}
                    loading={isSearchingFilterLocation && activeFilterLocationSearch?.level === "cidade"}
                    emptyMessage={filterLocationEmptyMessage}
                    inputTestId="input-search-filter-city"
                    buttonTestId="button-open-filter-city"
                    allOptionTestId="option-filter-city-all"
                    listboxLabel="Resultados de cidades"
                    placeholder="Digite o nome da cidade"
                    allLabel="Todas as cidades"
                    showDivider={false}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                <span style={{ color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Categoria</span>
                <div style={{ overflow: "hidden", borderRadius: "12px", backgroundColor: "#202020", border: "1px solid #2d2d2d" }}>
                  <button
                    data-testid="button-open-filter-category"
                    type="button"
                    onClick={() => {
                      setIsFilterCategoryPickerOpen((isOpen) => !isOpen);
                      setFilterCategorySearch("");
                      setIsFilterCountryPickerOpen(false);
                      setIsFilterStatePickerOpen(false);
                      setIsFilterCityPickerOpen(false);
                    }}
                    aria-label={draftFilters.categoria === "Todos" ? "Buscar categoria" : "Editar categoria"}
                    aria-haspopup="listbox"
                    aria-expanded={isFilterCategoryPickerOpen}
                    style={{ width: "100%", minHeight: "54px", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", border: "none", backgroundColor: "transparent", color: "#f5f5f5", textAlign: "left", cursor: "pointer" }}
                  >
                    <span data-testid="text-filter-category" style={{ minWidth: 0, color: draftFilters.categoria !== "Todos" ? "#c7d2fe" : "#a3a3a3", fontSize: "13px", fontWeight: 700, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {selectedFilterCategory?.pathLabel ?? "Todas as categorias"}
                    </span>
                    {isFilterCategoryPickerOpen ? <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0, color: "#c7d2fe" }} /> : <ChevronRight size={16} aria-hidden="true" style={{ flexShrink: 0, color: "#737373" }} />}
                  </button>

                  {isFilterCategoryPickerOpen && (
                     <div role="listbox" aria-label="Categorias de popularidade" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px 12px", backgroundColor: "#202020", borderTop: "1px solid #2d2d2d" }}>
                      <div style={{ position: "relative" }}>
                        <Search size={14} aria-hidden="true" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#737373", pointerEvents: "none" }} />
                        <input
                          data-testid="input-search-filter-category"
                          type="search"
                          value={filterCategorySearch}
                          onChange={(event) => setFilterCategorySearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setIsFilterCategoryPickerOpen(false);
                              setFilterCategorySearch("");
                            }
                          }}
                          placeholder="Buscar categoria"
                          aria-label="Buscar categoria"
                          autoFocus
                          style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 30px", borderRadius: "8px", backgroundColor: "#2a2a2a", color: "#f5f5f5", border: "1px solid #454545", fontSize: "12px", outline: "none" }}
                        />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "190px", overflowY: "auto" }}>
                        <button
                          data-testid="option-filter-category-all"
                          type="button"
                          role="option"
                          aria-selected={draftFilters.categoria === "Todos"}
                          onClick={() => selectFilterLevel("categoria", "Todos")}
                          style={{ width: "100%", padding: "9px 10px", border: "none", borderRadius: "7px", backgroundColor: draftFilters.categoria === "Todos" ? "#363636" : "transparent", color: "#f5f5f5", fontSize: "12px", fontWeight: 700, textAlign: "left", cursor: "pointer" }}
                        >
                          Todas as categorias
                        </button>
                        {visibleFilterCategoryOptions.length === 0 ? (
                          <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>Nenhuma categoria encontrada.</span>
                        ) : (
                          visibleFilterCategoryOptions.map((category) => (
                            <div key={category.id} style={{ display: "flex", alignItems: "stretch", gap: "2px", paddingLeft: `${category.depth * 18}px` }}>
                              {category.hasChildren ? (
                                <button
                                  type="button"
                                  aria-label={`${expandedFilterCategoryIds.has(category.id) ? "Recolher" : "Expandir"} ${category.name}`}
                                  aria-expanded={expandedFilterCategoryIds.has(category.id)}
                                  onClick={() => setExpandedFilterCategoryIds((expanded) => {
                                    const next = new Set(expanded);
                                    if (next.has(category.id)) next.delete(category.id);
                                    else next.add(category.id);
                                    return next;
                                  })}
                                  style={{ width: "26px", flexShrink: 0, display: "grid", placeItems: "center", padding: 0, border: "none", borderRadius: "7px", backgroundColor: "transparent", color: "#737373", cursor: "pointer" }}
                                >
                                  {expandedFilterCategoryIds.has(category.id) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                                </button>
                              ) : (
                                <span aria-hidden="true" style={{ width: "26px", flexShrink: 0 }} />
                              )}
                              <button
                                type="button"
                                role="option"
                                aria-selected={category.id === draftFilters.categoria}
                                onClick={() => selectFilterLevel("categoria", category.id)}
                                style={{ flex: 1, minWidth: 0, padding: "9px 10px", display: "block", border: "none", borderRadius: "7px", backgroundColor: category.id === draftFilters.categoria ? "#363636" : "transparent", color: category.id === draftFilters.categoria ? "#fff" : category.depth === 0 ? "#f5f5f5" : "#d4d4d4", fontSize: "12px", fontWeight: category.depth === 0 ? 700 : 600, textAlign: "left", cursor: "pointer" }}
                              >
                                <span style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{category.name}</span>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", borderTop: "1px solid #292929", paddingTop: "16px" }}>
              <button data-testid="button-clear-filters" type="button" onClick={clearDraftFilters} disabled={draftFilterCount === 0} style={{ padding: "10px 8px", borderRadius: "8px", backgroundColor: "transparent", color: draftFilterCount === 0 ? "#525252" : "#a3a3a3", fontWeight: 700, fontSize: "12px", border: "none", cursor: draftFilterCount === 0 ? "default" : "pointer", opacity: draftFilterCount === 0 ? 0.7 : 1 }}>Limpar filtros</button>
              <button data-testid="button-apply-filters" type="button" onClick={applyFilters} style={{ minWidth: "108px", padding: "11px 16px", borderRadius: "9999px", backgroundColor: "#f5f5f5", color: "#0a0a0a", fontWeight: 700, fontSize: "13px", border: "none", cursor: "pointer" }}>Aplicar filtros</button>
            </div>
          </div>
        </div>
      )}

      {showQueueModal && (
        <div onClick={() => setShowQueueModal(false)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))", boxSizing: "border-box" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="queue-modal-title" onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 420px)", maxWidth: "100%", maxHeight: "min(78dvh, 620px)", minHeight: 0, backgroundColor: "#171717", border: "1px solid #333", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span id="queue-modal-title" style={{ color: "#fff", fontWeight: 800, fontSize: "18px", letterSpacing: "-0.01em" }}>Ações</span>
              <button type="button" data-testid="button-close-queue" onClick={() => setShowQueueModal(false)} aria-label="Fechar lista de ações" style={closeButtonStyle}><X size={13} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              {liveActionEntries.map((item) => {
                const color = item.mode === "defender" ? "#22c55e" : "#ef4444";
                const actionDisplay = getActionDisplay(item, levelByKey);
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
                        <span aria-hidden="true" style={{ fontSize: "16px", lineHeight: 1, flexShrink: 0 }}>{actionDisplay.emoji}</span>
                        <span style={{ color: "#a3a3a3", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actionDisplay.label}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showPlayerSignup && (
        <div onClick={() => !isJoiningPlayer && setShowPlayerSignup(false)} style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="player-signup-title" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "360px", maxHeight: "88vh", backgroundColor: "#171717", border: "1px solid #292929", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto", boxShadow: "0 8px 28px rgba(0,0,0,0.42)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ minWidth: 0 }}>
                <span id="player-signup-title" style={{ display: "block", color: "#fff", fontWeight: 800, fontSize: "18px", lineHeight: 1.2, letterSpacing: "-0.02em" }}>Entrar na disputa popular</span>
                 <span style={{ display: "block", marginTop: "4px", color: "#a3a3a3", fontSize: "12px", lineHeight: 1.4 }}>Coloque sua popularidade à prova e dispute seu lugar entre os mais populares.</span>
              </div>
              <button data-testid="button-close-player-signup" type="button" onClick={() => setShowPlayerSignup(false)} disabled={isJoiningPlayer} aria-label="Fechar" style={{ ...closeButtonStyle, width: "26px", height: "26px", flexShrink: 0, opacity: isJoiningPlayer ? 0.45 : 1 }}><X size={13} /></button>
            </div>

            {isLoadingPlayerRegistration ? (
              <div style={{ padding: "28px 8px", textAlign: "center", color: "#a3a3a3", fontSize: "13px" }}>Carregando sua inscrição…</div>
            ) : playerRegistration ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 12px", borderRadius: "12px", backgroundColor: "#202020", border: "1px solid #2d2d2d" }}>
                  {playerRegistration.user.avatarUrl ? (
                    <img src={playerRegistration.user.avatarUrl} alt="" style={{ width: "40px", height: "40px", borderRadius: "9999px", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                     <div style={{ width: "40px", height: "40px", borderRadius: "9999px", backgroundColor: "#333", color: "#f5f5f5", display: "grid", placeItems: "center", flexShrink: 0, fontSize: "15px", fontWeight: 800 }}>{playerRegistration.user.name.trim().charAt(0).toUpperCase()}</div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span style={{ display: "block", marginBottom: "3px", color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", lineHeight: 1.2, textTransform: "uppercase" }}>Você está entrando como</span>
                    <span style={{ display: "block", color: "#fff", fontSize: "14px", fontWeight: 800, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playerRegistration.user.name}</span>
                    <span style={{ display: "block", marginTop: "3px", color: "#a3a3a3", fontSize: "11px", lineHeight: 1.2 }}>@{playerRegistration.user.username}</span>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #292929", paddingTop: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Localidade</span>
                      {!isEditingPlayerLocation && (
                        <span data-testid="text-player-location" style={{ display: "block", marginTop: "6px", color: playerLocationComplete ? "#f5f5f5" : "#a3a3a3", fontSize: "13px", fontWeight: 700, lineHeight: 1.4 }}>
                          {playerLocationComplete ? `${playerLocation.city}, ${playerLocation.region} — ${playerLocation.country}` : "Informe sua cidade para continuar"}
                        </span>
                      )}
                    </div>
                    <button
                      data-testid="button-edit-player-location"
                      type="button"
                      onClick={() => {
                        const nextIsEditing = !isEditingPlayerLocation;
                        setIsEditingPlayerLocation(nextIsEditing);
                        setIsPlayerLocationPickerOpen(nextIsEditing);
                        setPlayerLocationSearch(nextIsEditing ? playerLocation.city : "");
                        setPlayerLocationResults([]);
                        setPlayerLocationSearchError(null);
                      }}
                      disabled={isJoiningPlayer}
                      aria-label={playerLocationComplete ? "Editar localidade" : "Informar localidade"}
                      title={playerLocationComplete ? "Editar localidade" : "Informar localidade"}
                      style={{ width: "28px", height: "28px", padding: 0, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "8px", backgroundColor: "transparent", border: "1px solid #3b3b3b", color: "#a3a3a3", cursor: isJoiningPlayer ? "default" : "pointer", opacity: isJoiningPlayer ? 0.5 : 1 }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  </div>

                  {isEditingPlayerLocation && (
                    <>
                      <label style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "10px" }}>
                        <span style={{ color: "#d4d4d4", fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Buscar cidade</span>
                        <div style={{ position: "relative" }}>
                          <Search size={14} aria-hidden="true" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#737373", pointerEvents: "none" }} />
                          <input
                            data-testid="input-player-city-search"
                            type="search"
                            value={playerLocationSearch}
                            onChange={(event) => {
                              setPlayerLocationSearch(event.target.value);
                              setIsPlayerLocationPickerOpen(true);
                            }}
                            onFocus={() => setIsPlayerLocationPickerOpen(true)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setIsPlayerLocationPickerOpen(false);
                                setPlayerLocationSearch("");
                                setPlayerLocationResults([]);
                              }
                            }}
                            placeholder="Digite o nome da cidade"
                            autoComplete="address-level2"
                            aria-label="Buscar cidade"
                            style={{ width: "100%", boxSizing: "border-box", padding: "10px 10px 10px 30px", borderRadius: "9px", backgroundColor: "#292929", color: "#f5f5f5", border: "1px solid #484848", fontSize: "13px", outline: "none" }}
                          />
                        </div>
                      </label>

                      {isPlayerLocationPickerOpen && (
                        <div role="listbox" aria-label="Resultados de cidades" style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "190px", overflowY: "auto", marginTop: "7px", padding: "6px", borderRadius: "10px", backgroundColor: "#202020", border: "1px solid #3a3a3a", boxShadow: "0 8px 22px rgba(0,0,0,0.28)" }}>
                          {isSearchingPlayerLocation ? (
                            <span style={{ padding: "12px 10px", color: "#a3a3a3", fontSize: "12px", textAlign: "center" }}>Buscando cidades…</span>
                          ) : playerLocationSearchError ? (
                            <span style={{ padding: "12px 10px", color: "#fca5a5", fontSize: "12px", textAlign: "center" }}>{playerLocationSearchError}</span>
                          ) : playerLocationSearch.trim().length < 2 ? (
                            <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>Digite pelo menos 2 caracteres.</span>
                          ) : playerLocationResults.length === 0 ? (
                            <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>Nenhuma cidade encontrada.</span>
                          ) : (
                            playerLocationResults.map((result) => (
                              <button
                                key={result.id}
                                type="button"
                                role="option"
                                aria-selected={result.city === playerLocation.city && result.region === playerLocation.region && result.country === playerLocation.country}
                                onClick={() => {
                                  playerLocationEditedRef.current = true;
                                  setPlayerLocation({
                                    city: result.city,
                                    region: result.region,
                                    country: result.country,
                                  });
                                  setPlayerLocationSearch(result.city);
                                  setIsEditingPlayerLocation(false);
                                  setIsPlayerLocationPickerOpen(false);
                                  setPlayerLocationResults([]);
                                  setPlayerLocationSearchError(null);
                                }}
                                style={{ width: "100%", padding: "9px 10px", display: "flex", flexDirection: "column", gap: "3px", border: "none", borderRadius: "7px", backgroundColor: result.city === playerLocation.city && result.region === playerLocation.region && result.country === playerLocation.country ? "#363636" : "transparent", color: "#f5f5f5", textAlign: "left", cursor: "pointer" }}
                              >
                                <span style={{ fontSize: "12px", fontWeight: 700, lineHeight: 1.25 }}>{result.city}</span>
                                <span style={{ color: "#a3a3a3", fontSize: "11px", lineHeight: 1.25 }}>{result.region} — {result.country}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}

                    </>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "7px", borderTop: "1px solid #292929", paddingTop: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: "#737373", fontSize: "10px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Categoria de popularidade</span>
                      <span data-testid="text-player-category" style={{ display: "block", marginTop: "6px", color: selectedPlayerCategory ? "#f5f5f5" : "#a3a3a3", fontSize: "13px", fontWeight: 700, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {selectedPlayerCategory?.pathLabel ?? "Informe sua categoria para continuar"}
                      </span>
                    </div>
                    <button
                      data-testid="select-player-category"
                      type="button"
                      onClick={() => {
                        if (isJoiningPlayer) return;
                        setIsPlayerCategoryPickerOpen((isOpen) => !isOpen);
                        setPlayerCategorySearch("");
                      }}
                      disabled={isJoiningPlayer}
                      aria-label={selectedPlayerCategory ? "Editar categoria" : "Informar categoria"}
                      title={selectedPlayerCategory ? "Editar categoria" : "Informar categoria"}
                      aria-haspopup="listbox"
                      aria-expanded={isPlayerCategoryPickerOpen}
                      style={{ width: "28px", height: "28px", padding: 0, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "8px", backgroundColor: "transparent", border: "1px solid #3b3b3b", color: "#a3a3a3", cursor: isJoiningPlayer ? "default" : "pointer", opacity: isJoiningPlayer ? 0.5 : 1 }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  </div>

                  {isPlayerCategoryPickerOpen && (
                    <div role="listbox" aria-label="Categorias de popularidade" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "3px", padding: "8px", borderRadius: "10px", backgroundColor: "#202020", border: "1px solid #3a3a3a", boxShadow: "0 8px 22px rgba(0,0,0,0.28)" }}>
                      <div style={{ position: "relative" }}>
                        <Search size={14} aria-hidden="true" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#737373", pointerEvents: "none" }} />
                        <input
                          data-testid="input-search-player-category"
                          type="search"
                          value={playerCategorySearch}
                          onChange={(event) => setPlayerCategorySearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setIsPlayerCategoryPickerOpen(false);
                              setPlayerCategorySearch("");
                            }
                          }}
                          placeholder="Buscar categoria"
                          aria-label="Buscar categoria"
                          autoFocus
                          style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 30px", borderRadius: "8px", backgroundColor: "#2a2a2a", color: "#f5f5f5", border: "1px solid #454545", fontSize: "12px", outline: "none" }}
                        />
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "190px", overflowY: "auto" }}>
                        {visiblePlayerCategoryOptions.length === 0 ? (
                          <span style={{ padding: "12px 10px", color: "#737373", fontSize: "12px", textAlign: "center" }}>Nenhuma categoria encontrada.</span>
                        ) : (
                          visiblePlayerCategoryOptions.map((category) => (
                            <div key={category.id} style={{ display: "flex", alignItems: "stretch", gap: "2px", paddingLeft: `${category.depth * 18}px` }}>
                              {category.hasChildren ? (
                                <button
                                  type="button"
                                  aria-label={`${expandedPlayerCategoryIds.has(category.id) ? "Recolher" : "Expandir"} ${category.name}`}
                                  aria-expanded={expandedPlayerCategoryIds.has(category.id)}
                                  onClick={() => setExpandedPlayerCategoryIds((expanded) => {
                                    const next = new Set(expanded);
                                    if (next.has(category.id)) next.delete(category.id);
                                    else next.add(category.id);
                                    return next;
                                  })}
                                  style={{ width: "26px", flexShrink: 0, display: "grid", placeItems: "center", padding: 0, border: "none", borderRadius: "7px", backgroundColor: "transparent", color: "#737373", cursor: "pointer" }}
                                >
                                  {expandedPlayerCategoryIds.has(category.id) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                                </button>
                              ) : (
                                <span aria-hidden="true" style={{ width: "26px", flexShrink: 0 }} />
                              )}
                              <button
                                type="button"
                                role="option"
                                aria-selected={category.id === playerCategoryId}
                                onClick={() => {
                                  setPlayerCategoryId(category.id);
                                  setIsPlayerCategoryPickerOpen(false);
                                  setPlayerCategorySearch("");
                                }}
                                style={{ flex: 1, minWidth: 0, padding: "9px 10px", display: "block", border: "none", borderRadius: "7px", backgroundColor: category.id === playerCategoryId ? "#363636" : "transparent", color: category.id === playerCategoryId ? "#fff" : category.depth === 0 ? "#f5f5f5" : "#d4d4d4", fontSize: "12px", fontWeight: category.depth === 0 ? 700 : 600, textAlign: "left", cursor: "pointer" }}
                              >
                                <span style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{category.name}</span>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                 <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid #292929", paddingTop: "16px" }}>
                   <label style={{ display: "flex", alignItems: "flex-start", gap: "9px", padding: "0 2px", color: "#a3a3a3", fontSize: "11px", lineHeight: 1.5, cursor: isJoiningPlayer ? "default" : "pointer" }}>
                     <input
                       data-testid="checkbox-player-terms"
                       type="checkbox"
                       checked={hasAcceptedPlayerTerms}
                       onChange={(event) => setHasAcceptedPlayerTerms(event.target.checked)}
                       disabled={isJoiningPlayer}
                       style={{ width: "15px", height: "15px", margin: "1px 0 0", flexShrink: 0, accentColor: "#f5f5f5", cursor: isJoiningPlayer ? "default" : "pointer" }}
                     />
                     <span>
                        Ao entrar na disputa de popularidade, declaro que li e concordo com os{" "}
                        <a href="/termos-de-servico" style={{ color: "#c7d2fe", fontWeight: 700 }}>Termos de Serviço</a>{" "}
                        e a{" "}
                        <a href="/privacidade" style={{ color: "#c7d2fe", fontWeight: 700 }}>Política de Privacidade</a>.
                     </span>
                   </label>
                   <button data-testid="button-confirm-player-signup" type="button" onClick={() => void joinPlayer()} disabled={isJoiningPlayer || !playerCategoryId || !playerLocationComplete || !hasAcceptedPlayerTerms} style={{ width: "100%", padding: "11px", borderRadius: "9999px", backgroundColor: "#f5f5f5", color: "#0a0a0a", fontWeight: 700, fontSize: "13px", border: "none", cursor: isJoiningPlayer || !hasAcceptedPlayerTerms ? "default" : "pointer", opacity: isJoiningPlayer || !playerLocationComplete || !hasAcceptedPlayerTerms ? 0.6 : 1 }}>{isJoiningPlayer ? "Entrando na disputa…" : "Entrar na disputa"}</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {pendingMode && selectedCell && (
        <div className="action-modal-backdrop" onClick={closeModal} style={{ position: "fixed", inset: 0, zIndex: 120, backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))", boxSizing: "border-box", overflow: "hidden" }}>
          <div
            className="action-modal-shell"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(94vw, 520px)", maxWidth: "100%", height: "auto", maxHeight: "calc(100dvh - 24px)", minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", borderRadius: "clamp(18px, 5vw, 30px)", backgroundColor: "#111214", boxSizing: "border-box", boxShadow: "0 18px 64px rgba(0,0,0,0.58)" }}
          >
              <div className="action-modal-hero" style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", flexShrink: 0, overflow: "hidden", backgroundColor: selectedCellData?.color ?? "#25262b" }}>
                {selectedCellData && (
                  <PersonVisual
                    person={selectedCellData}
                    alt={`Imagem de ${selectedCellData.name}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 0 }}
                  />
                )}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(to bottom, rgba(10,10,12,0.68) 0%, rgba(10,10,12,0.05) 35%, rgba(17,18,20,0.02) 54%, rgba(17,18,20,0.82) 92%, #111214 100%)" }} />
                <div className="action-modal-header" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "14px", padding: "24px 24px 0", boxSizing: "border-box" }}>
                  <h2 id="action-modal-title" style={{ maxWidth: "calc(100% - 52px)", margin: 0, color: "#fff", fontSize: "clamp(24px, 7vw, 34px)", lineHeight: 1.06, fontWeight: 500, letterSpacing: "-0.04em", textShadow: "0 2px 16px rgba(0,0,0,0.36)" }}>
                    Você é fã ou hater de <strong style={{ fontWeight: 850 }}>{selectedCellData?.name ?? selectedCell}</strong>?
                  </h2>
                  <button data-testid="button-close-action" onClick={closeModal} aria-label="Fechar seleção de nível" style={{ width: "40px", height: "40px", flexShrink: 0, borderRadius: "50%", backgroundColor: "rgba(20,21,24,0.72)", color: "#f5f5f5", border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", display: "grid", placeItems: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.22)" }}><X size={21} strokeWidth={2.3} /></button>
                </div>
              </div>

              {selectedCellData && (
                <div className="action-modal-profile" style={{ padding: "18px 22px 28px", backgroundColor: "#111214", boxSizing: "border-box" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "14px", paddingBottom: "17px", borderBottom: "1px solid #2a2c31" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: "#8c8f96", fontSize: "10px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>Perfil</span>
                      <span style={{ display: "block", marginTop: "5px", color: "#f4f4f5", fontSize: "18px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCellData.name}</span>
                      <span style={{ display: "block", marginTop: "4px", color: "#92959d", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCellData.categoryPath?.map((category) => category.name).join(" / ")}</span>
                    </div>
                    {selectedCellData.xProfileUrl && selectedCellData.xUsername ? (
                      <a
                        data-testid="link-selected-cell-x-profile"
                        href={selectedCellData.xProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir perfil de @${String(selectedCellData.xUsername).replace(/^@/, "")} no X`}
                        onClick={(event) => event.stopPropagation()}
                        style={{ display: "inline-flex", alignItems: "center", gap: "7px", flexShrink: 0, minHeight: "36px", maxWidth: "46%", padding: "0 11px", border: "1px solid #3a3c43", borderRadius: "9999px", backgroundColor: "#1c1e23", color: "#f5f5f5", textDecoration: "none", boxSizing: "border-box" }}
                      >
                        <FaXTwitter size={14} aria-hidden="true" />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", fontWeight: 750 }}>@{String(selectedCellData.xUsername).replace(/^@/, "")}</span>
                      </a>
                    ) : (
                      <span style={{ minWidth: 0, maxWidth: "46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", color: "#6f727a", fontSize: "11px", alignSelf: "center" }}>Perfil no X não informado</span>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", marginTop: "16px" }}>
                    <div style={{ minWidth: 0, padding: "13px 14px", borderRadius: "14px", backgroundColor: "#1a1c21", border: "1px solid #292c32" }}>
                      <span style={{ display: "block", color: "#858991", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Popularidade</span>
                      <strong style={{ display: "block", marginTop: "7px", color: "#f4f4f5", fontSize: "22px", lineHeight: 1, fontWeight: 850 }}>{Number(selectedCellData.value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</strong>
                      {selectedPopularityRank && <span style={{ display: "block", marginTop: "6px", color: "#858991", fontSize: "11px" }}>#{selectedPopularityRank} no mapa</span>}
                    </div>
                    <div style={{ minWidth: 0, padding: "13px 14px", borderRadius: "14px", backgroundColor: "#1a1c21", border: "1px solid #292c32" }}>
                      <span style={{ display: "block", color: "#858991", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Polarização</span>
                      <strong style={{ display: "block", marginTop: "7px", color: "#f4f4f5", fontSize: "16px", lineHeight: 1.1, fontWeight: 800 }}>
                        {selectedCellData.polarization === null ? "Sem dados" : `${Math.round(selectedCellData.polarization * 100)}%`}
                      </strong>
                      <div aria-label="Distribuição histórica das ações entre hater e fã" style={{ display: "flex", height: "6px", marginTop: "10px", overflow: "hidden", borderRadius: "999px", backgroundColor: "#30333a" }}>
                        <span style={{ width: `${selectedCellData.totalHaters + selectedCellData.totalFans > 0 ? (selectedCellData.totalHaters / (selectedCellData.totalHaters + selectedCellData.totalFans)) * 100 : 0}%`, backgroundColor: "#ff625f" }} />
                        <span style={{ width: `${selectedCellData.totalHaters + selectedCellData.totalFans > 0 ? (selectedCellData.totalFans / (selectedCellData.totalHaters + selectedCellData.totalFans)) * 100 : 0}%`, backgroundColor: "#df5184" }} />
                      </div>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "6px", color: "#858991", fontSize: "10px" }}>
                        <span>Hater {selectedCellData.totalHaters.toLocaleString("pt-BR")}</span>
                        <span>Fã {selectedCellData.totalFans.toLocaleString("pt-BR")}</span>
                      </span>
                    </div>
                  </div>
                  {(selectedCellData.cidade || selectedCellData.estado || selectedCellData.pais) && (
                    <span style={{ display: "block", marginTop: "14px", color: "#73767e", fontSize: "11px" }}>
                      {[selectedCellData.cidade, selectedCellData.estado, selectedCellData.pais].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              )}

            <div className="action-modal-footer" style={{ padding: "16px 22px calc(16px + env(safe-area-inset-bottom))", borderTop: "1px solid #2b2d32", backgroundColor: "rgba(20,21,23,0.98)", boxShadow: "0 -12px 28px rgba(0,0,0,0.28)", boxSizing: "border-box" }}>
              <div className="action-modal-toggle-wrap" style={{ display: "flex", justifyContent: "center", marginBottom: "14px" }}>
                <div className="action-modal-toggle" style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "4px", borderRadius: "9999px", backgroundColor: "#292b31", boxShadow: "0 3px 10px rgba(0,0,0,0.16)" }}>
                   <button type="button" data-testid="button-switch-hater" onClick={() => openModal("atacar")} style={{ minWidth: "96px", padding: "9px 14px", border: "none", borderRadius: "9999px", backgroundColor: pendingMode === "atacar" ? ACTION_MODE_COLORS.atacar : "transparent", color: pendingMode === "atacar" ? "#fff" : "rgba(255,255,255,0.62)", fontSize: "14px", fontWeight: 800, cursor: "pointer", boxShadow: pendingMode === "atacar" ? "0 2px 5px rgba(0,0,0,0.16)" : "none" }}>🖕 Hater</button>
                   <button type="button" data-testid="button-switch-fan" onClick={() => openModal("defender")} style={{ minWidth: "82px", padding: "9px 14px", border: "none", borderRadius: "9999px", backgroundColor: pendingMode === "defender" ? ACTION_MODE_COLORS.defender : "transparent", color: pendingMode === "defender" ? "#fff" : "rgba(255,255,255,0.62)", fontSize: "14px", fontWeight: 800, cursor: "pointer", boxShadow: pendingMode === "defender" ? "0 2px 5px rgba(0,0,0,0.16)" : "none" }}>❤️ Fã</button>
                </div>
              </div>
              {authenticatedUser ? (
                <>
                  <FanHaterLevelPicker
                    mode={pendingMode}
                    levels={levelsByActionType[actionTypeByMode[pendingMode]] ?? []}
                    value={modalLevel}
                    onChange={setModalLevel}
                    basePrice={selectedCellData?.basePrice}
                  />
                  <div style={{ height: "1px", margin: "14px 0 14px", backgroundColor: "#303238" }} />
                  <div className="action-modal-primary-row" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
                    <div className="action-modal-total" style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                      <span style={{ color: "#8c8f96", fontSize: "10px", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>CUSTO TOTAL</span>
                      <span data-testid="text-action-base-price" style={{ color: "#8c8f96", fontSize: "11px", lineHeight: 1, whiteSpace: "nowrap" }}>
                        Preço-base {selectedCellData?.basePrice == null ? "—" : formatBRL(selectedCellData.basePrice)}
                      </span>
                      <span data-testid="text-action-total-price" style={{ color: "#f4f4f5", fontSize: "22px", lineHeight: 1, fontWeight: 650, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{selectedActionPrice === null ? "—" : formatBRL(selectedActionPrice)}</span>
                    </div>
                     <button className="action-modal-send" data-testid="button-send-action" onClick={confirmAction} disabled={createActionMutation.isPending || !selectedActionType || !selectedLevel} style={{ minWidth: "158px", padding: "13px 18px", borderRadius: "9999px", backgroundColor: ACTION_MODE_COLORS[pendingMode], color: "#fff", fontSize: "15px", fontWeight: 800, border: "none", cursor: createActionMutation.isPending ? "wait" : "pointer", opacity: createActionMutation.isPending || !selectedActionType || !selectedLevel ? 0.55 : 1, boxShadow: `0 5px 16px ${ACTION_MODE_COLORS[pendingMode]}33`, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      {createActionMutation.isPending ? "Enviando…" : <><span>{pendingMode === "defender" ? "Enviar apoio" : "Enviar hate"}</span><ArrowRight size={18} strokeWidth={2.8} aria-hidden="true" /></>}
                    </button>
                  </div>
                  {selectedLevel?.startDelayMs > 0 && !createActionMutation.isPending && <span style={{ display: "block", marginTop: "10px", color: "#8c8f96", fontSize: "11px" }}>A ação inicia em {Math.ceil(selectedLevel.startDelayMs / 1000)}s.</span>}
                  {createActionMutation.error && <span style={{ display: "block", marginTop: "10px", color: "#fca5a5", fontSize: "11px" }}>{actionWasRateLimited ? "Muitas ações em pouco tempo. Aguarde um instante e tente novamente." : "Não foi possível enviar esta ação. Tente novamente."}</span>}
                </>
              ) : (
                <div data-testid="action-auth-prompt" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px 8px 4px", textAlign: "center" }}>
                  <div style={{ display: "grid", placeItems: "center", width: "38px", height: "38px", borderRadius: "9999px", backgroundColor: "#292b31", color: "#c7d2fe" }}><FaXTwitter size={19} aria-hidden="true" /></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <strong style={{ color: "#f4f4f5", fontSize: "14px" }}>Conecte-se para escolher o nível</strong>
                    <span style={{ color: "#92959d", fontSize: "11px", lineHeight: 1.45 }}>Ações de fã/apoio e hate só podem ser enviadas por contas conectadas ao X.</span>
                  </div>
                  <button
                    data-testid="button-connect-for-action"
                    type="button"
                    onClick={() => {
                      closeModal();
                      setConnectPurpose("action");
                      setShowConnectModal(true);
                    }}
                    style={{ minHeight: "40px", padding: "10px 18px", borderRadius: "9999px", backgroundColor: "#f5f5f5", color: "#0a0a0a", border: "none", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}
                  >
                    Conectar com X
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @container (max-width: 130px) { .action-pill-count { display: none; } }
        .action-modal-shell { scrollbar-width: thin; }
        @media (max-width: 520px) {
          .action-modal-shell { width: 100% !important; }
          .action-modal-header { padding: 18px 18px 0 !important; }
          .action-modal-profile { padding-left: 16px !important; padding-right: 16px !important; }
          .action-modal-footer { padding-left: 16px !important; padding-right: 16px !important; }
          .action-modal-toggle-wrap { width: 100%; }
          .action-modal-toggle { width: 100%; }
          .action-modal-toggle > button { flex: 1; min-width: 0 !important; }
          .action-modal-primary-row { flex-direction: column !important; align-items: stretch !important; gap: 11px !important; }
          .action-modal-total { align-items: flex-start !important; }
          .action-modal-send { width: 100%; min-width: 0 !important; }
        }
        @media (max-height: 680px) {
          .action-modal-hero { aspect-ratio: 16 / 10 !important; }
        }
      `}</style>
    </div>
  );
}