import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  actionEventsTable,
  actionLevelsTable,
  actionsTable,
  cellsTable,
  itemActionRulesTable,
  itemsTable,
  locationsTable,
  peopleTable,
  roomMembersTable,
  roomsTable,
} from "@workspace/db";
import type {
  PopPerson,
  PopPersonAction,
  PopPersonActionInput,
  PopPersonBootstrap,
  PopPersonConfig,
  PopPersonState,
} from "@workspace/api-zod";

const DEFAULT_ROOM_SLUG = "pop-person-default";
const DEFAULT_ROOM_NAME = "PopPerson";
const PROCESS_INTERVAL_MS = 500;
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

const PEOPLE = [
  { name: "Marcos Rocha", slug: "marcos-rocha", cargo: "Deputado Federal", cidade: "Belo Horizonte", estado: "MG", pais: "Brasil", status: "titular", value: 68 },
  { name: "Beatriz Alves", slug: "beatriz-alves", cargo: "Senadora", cidade: "Porto Alegre", estado: "RS", pais: "Brasil", status: "titular", value: 52 },
  { name: "Ricardo Aguiar", slug: "ricardo-aguiar", cargo: "Prefeito", cidade: "Recife", estado: "PE", pais: "Brasil", status: "candidato", value: 84 },
  { name: "Fernanda Nunes", slug: "fernanda-nunes", cargo: "Vereadora", cidade: "Curitiba", estado: "PR", pais: "Brasil", status: "titular", value: 34 },
  { name: "Eduardo Vaz", slug: "eduardo-vaz", cargo: "Governador", cidade: "Salvador", estado: "BA", pais: "Brasil", status: "candidato", value: 62 },
  { name: "Camila Costa", slug: "camila-costa", cargo: "Ministra", cidade: "Brasília", estado: "DF", pais: "Brasil", status: "titular", value: 45 },
  { name: "Roberto Farias", slug: "roberto-farias", cargo: "Senador", cidade: "Manaus", estado: "AM", pais: "Brasil", status: "candidato", value: 76 },
  { name: "Juliana Lemos", slug: "juliana-lemos", cargo: "Deputada Federal", cidade: "Fortaleza", estado: "CE", pais: "Brasil", status: "titular", value: 57 },
] as const;

type ActionMode = "atacar" | "defender";
type ActionLevelCode =
  | "moderado"
  | "forte"
  | "extremo"
  | "devastador"
  | "apocaliptico";

const ELEMENTS: Record<ActionMode, Array<{
  code: string;
  emoji: string;
  label: string;
  force: number;
  price: number;
  gender: "m" | "f";
}>> = {
  atacar: [
    { code: "flecha", emoji: "🏹", label: "Flecha", force: 1, price: 0.1, gender: "f" },
    { code: "espada", emoji: "⚔️", label: "Espada", force: 3, price: 0.3, gender: "f" },
    { code: "fogo", emoji: "🔥", label: "Bola de Fogo", force: 5, price: 0.5, gender: "f" },
    { code: "foguete", emoji: "🚀", label: "Míssil", force: 10, price: 0.9, gender: "m" },
    { code: "meteoro", emoji: "☄️", label: "Meteoro", force: 20, price: 1.9, gender: "m" },
  ],
  defender: [
    { code: "pocao", emoji: "🧪", label: "Poção", force: 1, price: 0.1, gender: "f" },
    { code: "escudo", emoji: "🛡️", label: "Escudo", force: 3, price: 0.3, gender: "m" },
    { code: "aura", emoji: "💠", label: "Aura", force: 5, price: 0.5, gender: "f" },
    { code: "muralha", emoji: "🧱", label: "Muralha", force: 10, price: 0.9, gender: "f" },
    { code: "fortaleza", emoji: "🏰", label: "Fortaleza", force: 20, price: 1.9, gender: "f" },
  ],
};

const LEVELS: Array<{
  code: ActionLevelCode;
  label: string;
  powerLabel: string;
  emoji: string;
  projectileCount: number;
  staggerMs: number;
  durationMs: number;
  growthPerHit: number;
  shake: boolean;
}> = [
  { code: "moderado", label: "Moderado", powerLabel: "10x", emoji: "🔥", projectileCount: 10, staggerMs: 45, durationMs: 400, growthPerHit: 1.2, shake: false },
  { code: "forte", label: "Forte", powerLabel: "50x", emoji: "⚡", projectileCount: 50, staggerMs: 40, durationMs: 350, growthPerHit: 1.2, shake: false },
  { code: "extremo", label: "Extremo", powerLabel: "100x", emoji: "💥", projectileCount: 100, staggerMs: 35, durationMs: 300, growthPerHit: 1.2, shake: false },
  { code: "devastador", label: "Devastador", powerLabel: "500x", emoji: "🌋", projectileCount: 500, staggerMs: 25, durationMs: 260, growthPerHit: 1.2, shake: true },
  { code: "apocaliptico", label: "Apocalíptico", powerLabel: "1.000x", emoji: "☄️", projectileCount: 1000, staggerMs: 15, durationMs: 220, growthPerHit: 1.2, shake: true },
];

const CONFIG: PopPersonConfig = {
  elements: {
    atacar: ELEMENTS.atacar.map(({ code, ...element }) => ({ id: code, ...element })),
    defender: ELEMENTS.defender.map(({ code, ...element }) => ({ id: code, ...element })),
  },
  levels: LEVELS.map(({ code, projectileCount, durationMs, ...level }) => ({
    key: code,
    count: projectileCount,
    duration: durationMs,
    ...level,
  })),
  actionDelayMs: 10_000,
  minValue: 2,
};

type StateListener = (state: PopPersonState) => void | Promise<void>;
type Snapshot = Record<string, unknown>;

let defaultRoomId: string | null = null;
let initializationPromise: Promise<void> | null = null;
let processorTimer: NodeJS.Timeout | null = null;
let processing = false;
const stateListeners = new Set<StateListener>();

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function snapshotNumber(snapshot: unknown, key: string, fallback: number): number {
  if (!snapshot || typeof snapshot !== "object") return fallback;
  return toNumber((snapshot as Snapshot)[key], fallback);
}

function toActionStatus(status: string): "queued" | "running" | "completed" {
  return status === "running" || status === "completed" ? status : "queued";
}

async function ensureSeedData(): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    const [room] = await tx
      .insert(roomsTable)
      .values({
        slug: DEFAULT_ROOM_SLUG,
        name: DEFAULT_ROOM_NAME,
        active: true,
      })
      .onConflictDoUpdate({
        target: roomsTable.slug,
        set: { name: DEFAULT_ROOM_NAME, active: true, updatedAt: now },
      })
      .returning({ id: roomsTable.id });
    defaultRoomId = room.id;

    const locationIds = new Map<string, string>();
    for (const person of PEOPLE) {
      const [location] = await tx
        .insert(locationsTable)
        .values({
          city: person.cidade,
          state: person.estado,
          stateCode: person.estado,
          country: person.pais,
          countryCode: "BR",
        })
        .onConflictDoNothing()
        .returning({ id: locationsTable.id });
      if (location) {
        locationIds.set(person.slug, location.id);
      } else {
        const [existingLocation] = await tx
          .select({ id: locationsTable.id })
          .from(locationsTable)
          .where(
            and(
              eq(locationsTable.countryCode, "BR"),
              eq(locationsTable.stateCode, person.estado),
              eq(locationsTable.city, person.cidade),
            ),
          )
          .limit(1);
        if (!existingLocation) throw new Error(`Location seed failed for ${person.slug}`);
        locationIds.set(person.slug, existingLocation.id);
      }

      const [dbPerson] = await tx
        .insert(peopleTable)
        .values({
          name: person.name,
          slug: person.slug,
          roleTitle: person.cargo,
          status: person.status,
          locationId: locationIds.get(person.slug),
          active: true,
        })
        .onConflictDoUpdate({
          target: peopleTable.slug,
          set: {
            name: person.name,
            roleTitle: person.cargo,
            status: person.status,
            locationId: locationIds.get(person.slug),
            active: true,
            updatedAt: now,
          },
        })
        .returning({ id: peopleTable.id });
      if (!dbPerson) throw new Error(`Person seed failed for ${person.slug}`);

      await tx
        .insert(cellsTable)
        .values({
          roomId: room.id,
          personId: dbPerson.id,
          backgroundColor: COLORS[PEOPLE.indexOf(person) % COLORS.length],
          currentValue: String(person.value),
          minimumValue: String(CONFIG.minValue),
          maximumValue: "100",
          active: true,
        })
        .onConflictDoNothing();
    }

    for (const mode of ["atacar", "defender"] as const) {
      for (const element of ELEMENTS[mode]) {
        await tx
          .insert(itemsTable)
          .values({
            code: element.code,
            mode,
            name: element.label,
            emoji: element.emoji,
            gender: element.gender,
            impactPower: String(element.force),
            price: String(element.price),
            active: true,
          })
          .onConflictDoUpdate({
            target: itemsTable.code,
            set: {
              mode,
              name: element.label,
              emoji: element.emoji,
              gender: element.gender,
              impactPower: String(element.force),
              price: String(element.price),
              active: true,
              updatedAt: now,
            },
          });
      }
    }

    for (let index = 0; index < LEVELS.length; index += 1) {
      const level = LEVELS[index];
      await tx
        .insert(actionLevelsTable)
        .values({
          code: level.code,
          label: level.label,
          powerLabel: level.powerLabel,
          sortOrder: index,
          projectileCount: level.projectileCount,
          staggerMs: level.staggerMs,
          durationMs: level.durationMs,
          growthPerHit: String(level.growthPerHit),
          impactMultiplier: "1",
          shake: level.shake,
          active: true,
        })
        .onConflictDoUpdate({
          target: actionLevelsTable.code,
          set: {
            label: level.label,
            powerLabel: level.powerLabel,
            sortOrder: index,
            projectileCount: level.projectileCount,
            staggerMs: level.staggerMs,
            durationMs: level.durationMs,
            growthPerHit: String(level.growthPerHit),
            shake: level.shake,
            active: true,
            updatedAt: now,
          },
        });
    }

    const dbItems = await tx
      .select({ id: itemsTable.id, code: itemsTable.code })
      .from(itemsTable);
    const dbLevels = await tx
      .select({ id: actionLevelsTable.id, code: actionLevelsTable.code })
      .from(actionLevelsTable);
    for (const item of dbItems) {
      for (const level of dbLevels) {
        await tx
          .insert(itemActionRulesTable)
          .values({
            itemId: item.id,
            actionLevelId: level.id,
            active: true,
          })
          .onConflictDoNothing();
      }
    }
  });
}

export async function initializePopPersonStore(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = ensureSeedData().then(async () => {
      await processDueActions();
      processorTimer = setInterval(() => {
        void processDueActions();
      }, PROCESS_INTERVAL_MS);
      processorTimer.unref();
    });
  }
  await initializationPromise;
}

async function getRoomId(): Promise<string> {
  if (!defaultRoomId) await initializePopPersonStore();
  if (!defaultRoomId) throw new Error("PopPerson default room is unavailable.");
  return defaultRoomId;
}

async function ensureRoomMembership(roomId: string, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await db
    .insert(roomMembersTable)
    .values({ roomId, sessionId, active: true })
    .onConflictDoUpdate({
      target: [
        roomMembersTable.roomId,
        roomMembersTable.sessionId,
      ],
      set: {
        active: true,
        lastSeenAt: new Date(),
        leftAt: null,
      },
    });
}

async function getDataset(roomId: string): Promise<PopPerson[]> {
  const rows = await db
    .select({
      name: peopleTable.name,
      cargo: peopleTable.roleTitle,
      status: peopleTable.status,
      cidade: locationsTable.city,
      estado: locationsTable.stateCode,
      pais: locationsTable.country,
      value: cellsTable.currentValue,
      color: cellsTable.backgroundColor,
    })
    .from(cellsTable)
    .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
    .leftJoin(locationsTable, eq(peopleTable.locationId, locationsTable.id))
    .where(and(eq(cellsTable.roomId, roomId), eq(cellsTable.active, true)))
    .orderBy(asc(cellsTable.createdAt));

  return rows.map((person) => ({
    name: person.name,
    cargo: person.cargo ?? "",
    cidade: person.cidade ?? "",
    estado: person.estado ?? "",
    pais: person.pais ?? "",
    status: person.status === "candidato" ? "candidato" : "titular",
    value: toNumber(person.value),
    color: person.color,
  }));
}

async function getActions(roomId: string): Promise<PopPersonAction[]> {
  const rows = await db
    .select({
      id: actionsTable.id,
      mode: actionsTable.mode,
      elementId: itemsTable.code,
      level: actionLevelsTable.code,
      targetName: peopleTable.name,
      status: actionsTable.status,
      executeAt: actionsTable.scheduledFor,
      completedAt: actionsTable.completedAt,
      count: actionLevelsTable.projectileCount,
      growthPerHit: actionsTable.ruleSnapshot,
    })
    .from(actionsTable)
    .innerJoin(itemsTable, eq(actionsTable.itemId, itemsTable.id))
    .innerJoin(actionLevelsTable, eq(actionsTable.actionLevelId, actionLevelsTable.id))
    .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
    .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
    .where(
      and(
        eq(actionsTable.roomId, roomId),
        inArray(actionsTable.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(actionsTable.scheduledFor));

  return rows.map((action) => ({
    id: action.id,
    mode: action.mode,
    elementId: action.elementId,
    level: action.level as ActionLevelCode,
    targetName: action.targetName,
    status: toActionStatus(action.status),
    executeAt: action.executeAt.getTime(),
    completedAt: action.completedAt?.getTime() ?? null,
    count: action.count,
    growthPerHit: snapshotNumber(action.growthPerHit, "growthPerHit", 0),
  }));
}

async function currentState(roomId: string): Promise<PopPersonState> {
  const [dataset, actions] = await Promise.all([
    getDataset(roomId),
    getActions(roomId),
  ]);
  return { dataset, actions };
}

async function notifyStateChange(): Promise<void> {
  const state = await currentState(await getRoomId());
  await Promise.all([...stateListeners].map((listener) => listener(state)));
}

export function subscribePopPersonState(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export async function getPopPersonBootstrap(
  sessionId?: string,
): Promise<PopPersonBootstrap> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  return { config: CONFIG, state: await currentState(roomId) };
}

export async function getPopPersonState(
  sessionId?: string,
): Promise<PopPersonState> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  return currentState(roomId);
}

function calculateActionValues(
  item: { impactPower: string; price: string },
  level: {
    projectileCount: number;
    staggerMs: number;
    durationMs: number;
    growthPerHit: string;
    impactMultiplier: string;
  },
  rule: {
    projectileCount: number | null;
    staggerMs: number | null;
    durationMs: number | null;
    growthPerHit: string | null;
    impactMultiplier: string | null;
    priceOverride: string | null;
  } | undefined,
) {
  const count = rule?.projectileCount ?? level.projectileCount;
  const staggerMs = rule?.staggerMs ?? level.staggerMs;
  const durationMs = rule?.durationMs ?? level.durationMs;
  const growthPerHit =
    toNumber(rule?.growthPerHit ?? level.growthPerHit) *
    (toNumber(item.impactPower) / 5) *
    toNumber(rule?.impactMultiplier ?? level.impactMultiplier, 1);
  const price = toNumber(rule?.priceOverride ?? item.price);
  return {
    count,
    staggerMs,
    durationMs,
    growthPerHit,
    price,
    totalImpact: growthPerHit * count,
  };
}

export async function createPopPersonAction(
  input: PopPersonActionInput,
  sessionId?: string,
): Promise<PopPersonAction> {
  const roomId = await getRoomId();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  await ensureRoomMembership(roomId, sessionId);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    if (sessionId) {
      const [existing] = await tx
        .select()
        .from(actionsTable)
        .where(
          and(
            eq(actionsTable.sessionId, sessionId),
            eq(actionsTable.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return { action: existing, created: false };
    }

    const [target] = await tx
      .select({
        cellId: cellsTable.id,
        personId: peopleTable.id,
        targetName: peopleTable.name,
      })
      .from(cellsTable)
      .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
      .where(
        and(
          eq(cellsTable.roomId, roomId),
          eq(cellsTable.active, true),
          eq(peopleTable.name, input.targetName),
        ),
      )
      .limit(1);
    const [item] = await tx
      .select()
      .from(itemsTable)
      .where(
        and(
          eq(itemsTable.code, input.elementId),
          eq(itemsTable.mode, input.mode),
          eq(itemsTable.active, true),
        ),
      )
      .limit(1);
    const [level] = await tx
      .select()
      .from(actionLevelsTable)
      .where(
        and(eq(actionLevelsTable.code, input.level), eq(actionLevelsTable.active, true)),
      )
      .limit(1);

    if (!target || !item || !level) {
      throw new Error("Ação inválida: elemento, intensidade ou alvo não encontrado.");
    }

    const [rule] = await tx
      .select()
      .from(itemActionRulesTable)
      .where(
        and(
          eq(itemActionRulesTable.itemId, item.id),
          eq(itemActionRulesTable.actionLevelId, level.id),
          eq(itemActionRulesTable.active, true),
        ),
      )
      .limit(1);
    const values = calculateActionValues(item, level, rule);
    const scheduledFor = new Date(now.getTime() + CONFIG.actionDelayMs);
    const completesAt = new Date(
      scheduledFor.getTime() +
        (values.count - 1) * values.staggerMs +
        values.durationMs,
    );
    const ruleSnapshot = {
      count: values.count,
      staggerMs: values.staggerMs,
      durationMs: values.durationMs,
      growthPerHit: values.growthPerHit,
      totalImpact: values.totalImpact,
      price: values.price,
      itemCode: item.code,
      levelCode: level.code,
    };
    const [action] = await tx
      .insert(actionsTable)
      .values({
        roomId,
        cellId: target.cellId,
        sessionId: sessionId ?? null,
        itemId: item.id,
        actionLevelId: level.id,
        mode: input.mode,
        status: "queued",
        scheduledFor,
        completesAt,
        effectiveImpact: String(values.totalImpact),
        priceCharged: String(values.price),
        ruleSnapshot,
        idempotencyKey,
      })
      .onConflictDoNothing({
        target: [actionsTable.sessionId, actionsTable.idempotencyKey],
      })
      .returning();
    if (!action && sessionId) {
      const [existing] = await tx
        .select()
        .from(actionsTable)
        .where(
          and(
            eq(actionsTable.sessionId, sessionId),
            eq(actionsTable.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return { action: existing, created: false };
    }
    if (!action) throw new Error("Não foi possível criar a ação.");

    await tx.insert(actionEventsTable).values({
      actionId: action.id,
      roomId,
      cellId: target.cellId,
      sequence: "1",
      eventType: "queued",
      status: "queued",
      deltaValue: "0",
      payload: { targetName: target.targetName, itemCode: item.code, levelCode: level.code },
    });
    await tx
      .update(roomsTable)
      .set({
        stateVersion: sql`${roomsTable.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(roomsTable.id, roomId));
    return { action, created: true };
  });

  if (result.created) await notifyStateChange();
  return {
    id: result.action.id,
    mode: result.action.mode,
    elementId: input.elementId,
    level: input.level,
    targetName: input.targetName,
    status: toActionStatus(result.action.status),
    executeAt: result.action.scheduledFor.getTime(),
    completedAt: result.action.completedAt?.getTime() ?? null,
    count: snapshotNumber(result.action.ruleSnapshot, "count", 1),
    growthPerHit: snapshotNumber(result.action.ruleSnapshot, "growthPerHit", 0),
  };
}

async function processDueActions(): Promise<void> {
  if (processing) return;
  processing = true;
  let changed = false;
  try {
    const now = new Date();
    await db.transaction(async (tx) => {
      const activated = await tx
        .update(actionsTable)
        .set({
          status: "running",
          activatedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(actionsTable.status, "queued"),
            lte(actionsTable.scheduledFor, now),
          ),
        )
        .returning();

      for (const action of activated) {
        changed = true;
        await tx.insert(actionEventsTable).values({
          actionId: action.id,
          roomId: action.roomId,
          cellId: action.cellId,
          sequence: "2",
          eventType: "started",
          status: "running",
          deltaValue: "0",
          payload: { startedAt: now.toISOString() },
        });
      }

      const dueActions = await tx
        .select()
        .from(actionsTable)
        .where(
          and(
            eq(actionsTable.status, "running"),
            lte(actionsTable.completesAt, now),
          ),
        )
        .orderBy(asc(actionsTable.completesAt))
        .limit(100);

      for (const action of dueActions) {
        const [claimed] = await tx
          .update(actionsTable)
          .set({
            status: "completed",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(actionsTable.id, action.id),
              eq(actionsTable.status, "running"),
              lte(actionsTable.completesAt, now),
            ),
          )
          .returning();
        if (!claimed) continue;

        const direction = claimed.mode === "defender" ? 1 : -1;
        const delta = toNumber(claimed.effectiveImpact) * direction;
        await tx
          .update(cellsTable)
          .set({
            currentValue: sql`LEAST(
              COALESCE(${cellsTable.maximumValue}, ${cellsTable.currentValue} + ${delta}),
              GREATEST(${cellsTable.minimumValue}, ${cellsTable.currentValue} + ${delta})
            )`,
            stateVersion: sql`${cellsTable.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(cellsTable.id, claimed.cellId));
        await tx
          .update(roomsTable)
          .set({
            stateVersion: sql`${roomsTable.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(roomsTable.id, claimed.roomId));
        await tx.insert(actionEventsTable).values({
          actionId: claimed.id,
          roomId: claimed.roomId,
          cellId: claimed.cellId,
          sequence: "3",
          eventType: "completed",
          status: "completed",
          deltaValue: String(delta),
          payload: {
            completedAt: now.toISOString(),
            direction: claimed.mode,
          },
        });
        changed = true;
      }
    });

    if (changed) await notifyStateChange();
  } catch (error) {
    const { logger } = await import("./logger");
    logger.error({ err: error }, "Failed to process PopPerson actions");
  } finally {
    processing = false;
  }
}