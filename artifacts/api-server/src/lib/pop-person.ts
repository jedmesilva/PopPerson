import { randomUUID } from "node:crypto";
import type {
  PopPerson,
  PopPersonAction,
  PopPersonActionInput,
  PopPersonBootstrap,
  PopPersonConfig,
  PopPersonLevel,
  PopPersonState,
} from "@workspace/api-zod";

const COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#a855f7",
  "#ef4444",
  "#14b8a6",
] as const;

const POLITICIANS = [
  { name: "Marcos Rocha", cargo: "Deputado Federal", cidade: "Belo Horizonte", estado: "MG", pais: "Brasil", status: "titular" },
  { name: "Beatriz Alves", cargo: "Senadora", cidade: "Porto Alegre", estado: "RS", pais: "Brasil", status: "titular" },
  { name: "Ricardo Aguiar", cargo: "Prefeito", cidade: "Recife", estado: "PE", pais: "Brasil", status: "candidato" },
  { name: "Fernanda Nunes", cargo: "Vereadora", cidade: "Curitiba", estado: "PR", pais: "Brasil", status: "titular" },
  { name: "Eduardo Vaz", cargo: "Governador", cidade: "Salvador", estado: "BA", pais: "Brasil", status: "candidato" },
  { name: "Camila Costa", cargo: "Ministra", cidade: "Brasília", estado: "DF", pais: "Brasil", status: "titular" },
  { name: "Roberto Farias", cargo: "Senador", cidade: "Manaus", estado: "AM", pais: "Brasil", status: "candidato" },
  { name: "Juliana Lemos", cargo: "Deputada Federal", cidade: "Fortaleza", estado: "CE", pais: "Brasil", status: "titular" },
] satisfies Array<Omit<PopPerson, "value" | "color">>;

const CONFIG: PopPersonConfig = {
  elements: {
    atacar: [
      { id: "flecha", emoji: "🏹", label: "Flecha", force: 1, price: 0.1, gender: "f" },
      { id: "espada", emoji: "⚔️", label: "Espada", force: 3, price: 0.3, gender: "f" },
      { id: "fogo", emoji: "🔥", label: "Bola de Fogo", force: 5, price: 0.5, gender: "f" },
      { id: "foguete", emoji: "🚀", label: "Míssil", force: 10, price: 0.9, gender: "m" },
      { id: "meteoro", emoji: "☄️", label: "Meteoro", force: 20, price: 1.9, gender: "m" },
    ],
    defender: [
      { id: "pocao", emoji: "🧪", label: "Poção", force: 1, price: 0.1, gender: "f" },
      { id: "escudo", emoji: "🛡️", label: "Escudo", force: 3, price: 0.3, gender: "m" },
      { id: "aura", emoji: "💠", label: "Aura", force: 5, price: 0.5, gender: "f" },
      { id: "muralha", emoji: "🧱", label: "Muralha", force: 10, price: 0.9, gender: "f" },
      { id: "fortaleza", emoji: "🏰", label: "Fortaleza", force: 20, price: 1.9, gender: "f" },
    ],
  },
  levels: [
    { key: "moderado", label: "Moderado", powerLabel: "10x", emoji: "🔥", count: 10, staggerMs: 45, duration: 400, growthPerHit: 1.2, shake: false },
    { key: "forte", label: "Forte", powerLabel: "50x", emoji: "⚡", count: 50, staggerMs: 40, duration: 350, growthPerHit: 1.2, shake: false },
    { key: "extremo", label: "Extremo", powerLabel: "100x", emoji: "💥", count: 100, staggerMs: 35, duration: 300, growthPerHit: 1.2, shake: false },
    { key: "devastador", label: "Devastador", powerLabel: "500x", emoji: "🌋", count: 500, staggerMs: 25, duration: 260, growthPerHit: 1.2, shake: true },
    { key: "apocaliptico", label: "Apocalíptico", powerLabel: "1.000x", emoji: "☄️", count: 1000, staggerMs: 15, duration: 220, growthPerHit: 1.2, shake: true },
  ],
  actionDelayMs: 10000,
  minValue: 2,
};

const dataset: PopPerson[] = POLITICIANS.map((politician, index) => ({
  ...politician,
  value: 10 + Math.random() * 90,
  color: COLORS[index % COLORS.length],
}));

const actions = new Map<string, PopPersonAction>();
const stateListeners = new Set<(state: PopPersonState) => void>();

function activeActions(): PopPersonAction[] {
  return [...actions.values()].filter((action) => action.status !== "completed");
}

function currentState(): PopPersonState {
  return {
    dataset: dataset.map((person) => ({ ...person })),
    actions: activeActions().map((action) => ({ ...action })),
  };
}

function notifyStateChange(): void {
  const state = currentState();
  stateListeners.forEach((listener) => listener(state));
}

export function subscribePopPersonState(
  listener: (state: PopPersonState) => void,
): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function completeAction(action: PopPersonAction): void {
  const target = dataset.find((person) => person.name === action.targetName);
  if (!target || action.status === "completed") return;

  const direction = action.mode === "defender" ? 1 : -1;
  target.value = Math.max(
    target.value + action.growthPerHit * action.count * direction,
    CONFIG.minValue,
  );
  action.status = "completed";
  action.completedAt = Date.now();
  notifyStateChange();
}

function scheduleAction(action: PopPersonAction, totalDuration: number): void {
  setTimeout(() => {
    action.status = "running";
    notifyStateChange();
    setTimeout(() => completeAction(action), totalDuration);
  }, Math.max(0, action.executeAt - Date.now()));
}

export function getPopPersonBootstrap(): PopPersonBootstrap {
  return {
    config: CONFIG,
    state: currentState(),
  };
}

export function getPopPersonState(): PopPersonState {
  return currentState();
}

export function createPopPersonAction(input: PopPersonActionInput): PopPersonAction {
  const elements = CONFIG.elements[input.mode];
  const element = elements.find((candidate) => candidate.id === input.elementId);
  const level = CONFIG.levels.find((candidate) => candidate.key === input.level);
  const target = dataset.find((person) => person.name === input.targetName);

  if (!element || !level || !target) {
    throw new Error("Ação inválida: elemento, intensidade ou alvo não encontrado.");
  }

  const action: PopPersonAction = {
    id: randomUUID(),
    mode: input.mode,
    elementId: element.id,
    level: level.key,
    targetName: target.name,
    status: "queued",
    executeAt: Date.now() + CONFIG.actionDelayMs,
    completedAt: null,
    count: level.count,
    growthPerHit: level.growthPerHit * (element.force / 5),
  };

  actions.set(action.id, action);
  notifyStateChange();
  scheduleAction(action, (level.count - 1) * level.staggerMs + level.duration);
  return { ...action };
}