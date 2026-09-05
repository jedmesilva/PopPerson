import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  actionEventsTable,
  actionLevelsTable,
  actionTypesTable,
  actionsTable,
  cellsTable,
  categoriesTable,
  locationsTable,
  paymentOrdersTable,
  peopleTable,
  roomMembersTable,
  roomsTable,
  usersTable,
} from "@workspace/db";
import type Stripe from "stripe";
import type {
  JoinPopPersonBody,
  PopPerson,
  PopPersonAction,
  PopPersonActionInput,
  PopPersonBootstrap,
  PopPersonCategory,
  PopPersonConfig,
  PopPersonState,
  PlayerRegistration,
} from "@workspace/api-zod";
import {
  dueHitCountAt,
  hitAtForIndex,
  isTimelineComplete,
} from "@workspace/api-zod";
import { logger } from "./logger";

// Publish the running state before the first visual impact whenever possible.
// A 500ms polling window could authorize short actions after their complete
// timeline, leaving the client with only the final resolution to display.
const PROCESS_INTERVAL_MS = 100;
// Keep each worker transaction short. A single action can contain thousands of
// projectiles, and processing all due hits at once holds cell/room locks long
// enough to block new action requests and other worker instances.
const MAX_HITS_PER_TRANSACTION = 50;
// Multiple API processes may be connected to the same database. Serialize the
// action worker at the database level so two workers cannot lock the same
// action/cell/room rows in different orders and deadlock each other.
const POP_PERSON_WORKER_LOCK_KEY = 29184731;
// Dynamic pricing knobs from the product pricing specification.
const POPULARITY_PRICE_MINIMUM = 0.1;
const POPULARITY_PRICE_SCALE = 100;
const POPULARITY_PRICE_EXPONENT = 2;
// Stripe rejects very small BRL charges after converting them to its
// account currency. Keep the technical payment floor in the same server-side
// price calculation used by both the UI dataset and checkout creation.
const STRIPE_MINIMUM_ACTION_PRICE = 3;
const CONFIRMED_ACTION_STATUSES = ["queued", "running", "completed"] as const;
export type PopPersonResolvedEvent = {
  eventId: string;
  actionId: string;
  hitCount: number;
  direction: PopPersonAction["mode"];
  delta: number;
  targetName: string;
  previousValue: number;
  finalValue: number;
  durationMs: number;
  intervalMs: number;
  stateVersion: number;
  resolvedAt: number;
};
export type PopPersonHitEvent = {
  eventId: string;
  actionId: string;
  sequence: number;
  hitIndex: number;
  hitAt: number;
  targetName: string;
  actionType: PopPersonAction["actionType"];
  direction: PopPersonAction["mode"];
  emoji: string;
  delta: number;
  previousValue: number;
  finalValue: number;
  stateVersion: number;
};
export type PopPersonRealtimeNotification =
  | {
      type: "action:started";
      roomId: string;
      actionId: string;
      stateVersion: number;
    }
  | {
      type: "action:resolved";
      roomId: string;
      actionId: string;
      event: PopPersonResolvedEvent;
    }
  | {
      type: "action:hit";
      roomId: string;
      actionId: string;
      event: PopPersonHitEvent;
    }
  | {
      type: "action:completed" | "action:cancelled";
      roomId: string;
      actionId: string;
      stateVersion?: number;
    }
  | {
      type: "state:changed";
      roomId: string;
      stateVersion: number;
    };
type Snapshot = Record<string, unknown>;
type AuthenticatedPopPersonUser = NonNullable<PopPersonBootstrap["user"]> & {
  id: string;
};
type PlayerRegistrationLocation = JoinPopPersonBody["location"];
type ResolvedAccessLocation = {
  source: "ip" | "local" | "unavailable";
  city: string;
  region: string;
  regionCode: string;
  country: string;
  countryCode: string;
  timezone: string;
};

export const POP_PERSON_REALTIME_CHANNEL = "pop_person_live";

let defaultRoomId: string | null = null;
let initializationPromise: Promise<void> | null = null;
let processorTimer: NodeJS.Timeout | null = null;
let processing = false;

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

async function enqueueRealtimeNotification(
  tx: SqlExecutor,
  notification: PopPersonRealtimeNotification,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_notify(${POP_PERSON_REALTIME_CHANNEL}, ${JSON.stringify(notification)})`,
  );
}

async function enqueueRealtimeNotificationBatch(
  tx: SqlExecutor,
  notifications: PopPersonRealtimeNotification[],
): Promise<void> {
  if (notifications.length === 0) return;
  const payloads = notifications.map((notification) => JSON.stringify(notification));
  await tx.execute(
    sql`SELECT pg_notify(${POP_PERSON_REALTIME_CHANNEL}, notification_payload)
      FROM jsonb_array_elements_text(${JSON.stringify(payloads)}::jsonb)
      AS notification_payload`,
  );
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculatePopularityBasePrice(totalFans: number, totalHaters: number): number {
  const popularity = Math.max(0, totalFans - totalHaters);
  const price = POPULARITY_PRICE_MINIMUM * (
    1 + (popularity / POPULARITY_PRICE_SCALE) ** POPULARITY_PRICE_EXPONENT
  );
  return Math.max(STRIPE_MINIMUM_ACTION_PRICE, roundCurrency(price));
}

function toTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function snapshotNumber(snapshot: unknown, key: string, fallback: number): number {
  if (!snapshot || typeof snapshot !== "object") return fallback;
  return toNumber((snapshot as Snapshot)[key], fallback);
}

function snapshotBoolean(snapshot: unknown, key: string, fallback: boolean): boolean {
  if (!snapshot || typeof snapshot !== "object") return fallback;
  const value = (snapshot as Snapshot)[key];
  return typeof value === "boolean" ? value : fallback;
}

function toActionStatus(status: string): "queued" | "running" | "completed" {
  return status === "running" || status === "completed" ? status : "queued";
}

async function loadConfiguredRoom(): Promise<void> {
  const [room] = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(eq(roomsTable.active, true))
    .orderBy(asc(roomsTable.createdAt))
    .limit(1);

  if (!room) {
    throw new Error("Nenhuma sala ativa foi configurada no banco de dados.");
  }

  defaultRoomId = room.id;
}

export async function initializePopPersonStore(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = loadConfiguredRoom().then(async () => {
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
  const [rows, categories, actionCounts] = await Promise.all([
    db
      .select({
        personId: peopleTable.id,
        name: peopleTable.name,
        categoryId: peopleTable.categoryId,
        categoryName: categoriesTable.name,
        categorySlug: categoriesTable.slug,
        categoryParentId: categoriesTable.parentId,
         gender: peopleTable.gender,
        status: peopleTable.status,
         imageUrl: peopleTable.imageUrl,
         xUsername: usersTable.username,
        cidade: locationsTable.city,
        estado: locationsTable.state,
        estadoCodigo: locationsTable.stateCode,
        pais: locationsTable.country,
        paisCodigo: locationsTable.countryCode,
        value: cellsTable.currentValue,
        color: peopleTable.color,
      })
      .from(cellsTable)
      .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
      .innerJoin(categoriesTable, eq(peopleTable.categoryId, categoriesTable.id))
      .leftJoin(locationsTable, eq(peopleTable.locationId, locationsTable.id))
      .leftJoin(usersTable, eq(peopleTable.playerUserId, usersTable.id))
      .where(
        and(
          eq(cellsTable.roomId, roomId),
          eq(cellsTable.active, true),
          eq(peopleTable.active, true),
          eq(categoriesTable.active, true),
        ),
      )
      .orderBy(asc(cellsTable.createdAt)),
    db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        slug: categoriesTable.slug,
        parentId: categoriesTable.parentId,
      })
      .from(categoriesTable)
      .where(eq(categoriesTable.active, true)),
    db
      .select({
        personId: cellsTable.personId,
        mode: actionsTable.mode,
        count: sql<number>`count(*)::int`,
      })
      .from(actionsTable)
      .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
      .where(
        and(
          eq(actionsTable.roomId, roomId),
          inArray(actionsTable.status, CONFIRMED_ACTION_STATUSES),
        ),
      )
      .groupBy(cellsTable.personId, actionsTable.mode),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const actionCountsByPersonId = new Map<string, { totalFans: number; totalHaters: number }>();
  for (const row of actionCounts) {
    const counts = actionCountsByPersonId.get(row.personId) ?? { totalFans: 0, totalHaters: 0 };
    if (row.mode === "defender") {
      counts.totalFans += toNumber(row.count);
    } else {
      counts.totalHaters += toNumber(row.count);
    }
    actionCountsByPersonId.set(row.personId, counts);
  }
  const pathCache = new Map<string, PopPersonCategory[]>();
  const getCategoryPath = (
    categoryId: string,
    visiting = new Set<string>(),
  ): PopPersonCategory[] => {
    const cached = pathCache.get(categoryId);
    if (cached) return cached;
    if (visiting.has(categoryId)) {
      throw new Error("Hierarquia de categorias inválida: ciclo detectado.");
    }
    const category = categoryById.get(categoryId);
    if (!category) {
      throw new Error(`Categoria "${categoryId}" não encontrada.`);
    }
    const nextVisiting = new Set(visiting).add(categoryId);
    const parentPath = category.parentId
      ? getCategoryPath(category.parentId, nextVisiting)
      : [];
    const path = [
      ...parentPath,
      {
        id: category.id,
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
      },
    ];
    pathCache.set(categoryId, path);
    return path;
  };

  return rows.map((person) => {
    if (person.status !== "titular" && person.status !== "candidato") {
      throw new Error(`Status inválido para "${person.name}": "${person.status}".`);
    }

    const counts = actionCountsByPersonId.get(person.personId);
    const totalFans = counts?.totalFans ?? 0;
    const totalHaters = counts?.totalHaters ?? 0;
    const totalInteractions = totalFans + totalHaters;
    const polarization = totalInteractions > 0
      ? 1 - ((totalFans - totalHaters) / totalInteractions) ** 2
      : null;
    const basePrice = calculatePopularityBasePrice(totalFans, totalHaters);

    return {
      name: person.name,
      category: {
        id: person.categoryId,
        name: person.categoryName,
        slug: person.categorySlug,
        parentId: person.categoryParentId,
      },
      categoryPath: getCategoryPath(person.categoryId),
       gender: person.gender,
      cidade: person.cidade ?? "",
      estado: person.estado ?? "",
      estadoCodigo: person.estadoCodigo ?? "",
      pais: person.pais ?? "",
      paisCodigo: person.paisCodigo ?? "",
      status: person.status,
      value: toNumber(person.value),
      color: person.color,
      basePrice,
      totalFans,
      totalHaters,
      polarization,
       imageUrl: person.imageUrl ?? null,
       xUsername: person.xUsername ?? null,
       xProfileUrl: person.xUsername
         ? `https://x.com/${encodeURIComponent(person.xUsername)}`
         : null,
    };
  });
}

async function getActions(
  roomId: string,
  actionId?: string,
): Promise<PopPersonAction[]> {
  const rows = await db
    .select({
      id: actionsTable.id,
      sourceCellId: actionsTable.sourceCellId,
      mode: actionsTable.mode,
      actionType: actionTypesTable.code,
      actionTypeLabel: actionTypesTable.label,
      level: actionLevelsTable.code,
      levelName: actionLevelsTable.label,
      levelEmoji: actionLevelsTable.emoji,
      levelMultiplier: actionLevelsTable.multiplier,
      targetName: peopleTable.name,
      status: actionsTable.status,
      priceCharged: actionsTable.priceCharged,
      actionStartDelayMs: actionsTable.startDelayMs,
      executeAt: actionsTable.scheduledFor,
      completesAt: actionsTable.completesAt,
      activatedAt: actionsTable.activatedAt,
      completedAt: actionsTable.completedAt,
      levelStaggerMs: actionLevelsTable.staggerMs,
      levelDurationMs: actionLevelsTable.durationMs,
      levelGrowthPerHit: actionLevelsTable.growthPerHit,
      levelImpactMultiplier: actionLevelsTable.impactMultiplier,
      levelShake: actionLevelsTable.shake,
      ruleSnapshot: actionsTable.ruleSnapshot,
    })
    .from(actionsTable)
    .leftJoin(actionTypesTable, eq(actionsTable.actionTypeId, actionTypesTable.id))
    .innerJoin(actionLevelsTable, eq(actionsTable.actionLevelId, actionLevelsTable.id))
    .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
    .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
    .where(
      actionId
        ? and(eq(actionsTable.roomId, roomId), eq(actionsTable.id, actionId))
        : and(
            eq(actionsTable.roomId, roomId),
            inArray(actionsTable.status, ["queued", "running"]),
          ),
    )
    .orderBy(asc(actionsTable.scheduledFor));

  const sourceCellIds = rows
    .map((action) => action.sourceCellId)
    .filter((cellId): cellId is string => Boolean(cellId));
  const sourceRows = sourceCellIds.length > 0
    ? await db
        .select({
          cellId: cellsTable.id,
          name: peopleTable.name,
        })
        .from(cellsTable)
        .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
        .where(inArray(cellsTable.id, sourceCellIds))
    : [];
  const sourceNameByCellId = new Map(
    sourceRows.map((source) => [source.cellId, source.name]),
  );

  const hitProgressByActionId = new Map<
    string,
    { hitCount: number; lastHitAt: Date | null }
  >();
  if (rows.length > 0) {
    const hitRows = await db
      .select({
        actionId: actionEventsTable.actionId,
        hitCount: sql<number>`count(*)::int`,
        lastHitAt: sql<Date | null>`max(${actionEventsTable.occurredAt})`,
      })
      .from(actionEventsTable)
      .where(
        and(
          inArray(
            actionEventsTable.actionId,
            rows.map((action) => action.id),
          ),
          eq(actionEventsTable.eventType, "hit"),
        ),
      )
      .groupBy(actionEventsTable.actionId);

    for (const hit of hitRows) {
      hitProgressByActionId.set(hit.actionId, {
        hitCount: toNumber(hit.hitCount),
        lastHitAt: hit.lastHitAt,
      });
    }
  }

  return rows.map((action) => {
    const count = snapshotNumber(
      action.ruleSnapshot,
      "count",
      toNumber(action.levelMultiplier, 1),
    );
    const staggerMs = snapshotNumber(
      action.ruleSnapshot,
      "staggerMs",
      action.levelStaggerMs,
    );
    const duration = snapshotNumber(
      action.ruleSnapshot,
      "durationMs",
      action.levelDurationMs,
    );
    // The action row is the source of truth once the action is queued. Its
    // snapshot is retained for the other execution values, but the schedule
    // must always reflect the persisted action timing.
    const startDelayMs = action.actionStartDelayMs;
    const impactMultiplier = snapshotNumber(
      action.ruleSnapshot,
      "impactMultiplier",
      toNumber(action.levelImpactMultiplier, 1),
    );
    const growthPerHit = snapshotNumber(
      action.ruleSnapshot,
      "growthPerHit",
      toNumber(action.levelGrowthPerHit) * impactMultiplier,
    );
    const price = snapshotNumber(
      action.ruleSnapshot,
      "price",
      toNumber(action.priceCharged, 0),
    );
    const hitProgress = hitProgressByActionId.get(action.id);

    return {
      id: action.id,
      mode: action.mode,
      actionType: action.actionType ?? (action.mode === "defender" ? "fan" : "hate"),
      level: action.level,
      levelName: action.levelName,
      levelEmoji: action.levelEmoji ?? (action.mode === "defender" ? "❤️" : "💥"),
      multiplier: toNumber(action.levelMultiplier, count),
      targetName: action.targetName,
      sourceName: sourceNameByCellId.get(action.sourceCellId ?? "") ?? null,
      status: toActionStatus(action.status),
      startDelayMs,
      executeAt: action.executeAt.getTime(),
      completesAt: action.completesAt.getTime(),
      startedAt: action.activatedAt?.getTime() ?? null,
      completedAt: action.completedAt?.getTime() ?? null,
      hitCount: hitProgress?.hitCount ?? 0,
      lastHitAt: toTimestampMs(hitProgress?.lastHitAt),
      count,
      growthPerHit,
      impactMultiplier,
      staggerMs,
      duration,
      price,
      shake: snapshotBoolean(action.ruleSnapshot, "shake", action.levelShake),
    };
  });
}

export async function getPopPersonAction(
  roomId: string,
  actionId: string,
): Promise<PopPersonAction | null> {
  const [action] = await getActions(roomId, actionId);
  return action ?? null;
}

async function currentState(roomId: string): Promise<PopPersonState> {
  const [[room], dataset, actions] = await Promise.all([
    db
      .select({ stateVersion: roomsTable.stateVersion })
      .from(roomsTable)
      .where(eq(roomsTable.id, roomId))
      .limit(1),
    getDataset(roomId),
    getActions(roomId),
  ]);
  if (!room) throw new Error("PopPerson room is unavailable.");
  return { stateVersion: room.stateVersion, dataset, actions };
}

async function getPopPersonConfig(): Promise<PopPersonConfig> {
  const [dbTypes, dbLevels] = await Promise.all([
    db
      .select({
        id: actionTypesTable.id,
        code: actionTypesTable.code,
        label: actionTypesTable.label,
        basePriceCurrent: actionTypesTable.basePriceCurrent,
        basePriceMinimum: actionTypesTable.basePriceMinimum,
      })
      .from(actionTypesTable)
      .where(eq(actionTypesTable.active, true))
      .orderBy(asc(actionTypesTable.code)),
    db
      .select({
        id: actionLevelsTable.id,
        actionTypeId: actionLevelsTable.actionTypeId,
        code: actionLevelsTable.code,
        label: actionLevelsTable.label,
        emoji: actionLevelsTable.emoji,
        multiplier: actionLevelsTable.multiplier,
        startDelayMs: actionLevelsTable.startDelayMs,
        staggerMs: actionLevelsTable.staggerMs,
        durationMs: actionLevelsTable.durationMs,
        growthPerHit: actionLevelsTable.growthPerHit,
        impactMultiplier: actionLevelsTable.impactMultiplier,
        shake: actionLevelsTable.shake,
      })
      .from(actionLevelsTable)
      .where(and(eq(actionLevelsTable.active, true), sql`${actionLevelsTable.actionTypeId} IS NOT NULL`))
      .orderBy(asc(actionLevelsTable.sortOrder)),
  ]);

  const dbTypeById = new Map(dbTypes.map((type) => [type.id, type]));
  const activeLevels = dbLevels.map((level) => {
    const actionType = level.actionTypeId ? dbTypeById.get(level.actionTypeId) : undefined;
    const multiplier = toNumber(level.multiplier);
    if (!actionType || !level.emoji || !Number.isInteger(multiplier) || multiplier < 1) {
      throw new Error(`Nível "${level.code}" está com configuração inválida.`);
    }
    return {
      key: level.code,
      actionType: actionType.code,
      name: level.label,
      emoji: level.emoji,
      multiplier,
      startDelayMs: level.startDelayMs,
      staggerMs: level.staggerMs,
      duration: level.durationMs,
      growthPerHit: toNumber(level.growthPerHit),
      impactMultiplier: toNumber(level.impactMultiplier, 1),
      shake: level.shake,
    };
  });

  for (const actionType of ["hate", "fan"] as const) {
    const count = activeLevels.filter((level) => level.actionType === actionType).length;
    if (count !== 10) {
      throw new Error(`O tipo de ação "${actionType}" precisa ter exatamente 10 níveis ativos.`);
    }
  }

  const actionTypes = Object.fromEntries(
    dbTypes.map((type) => [
      type.code,
      {
        key: type.code,
        label: type.label,
        basePriceCurrent: toNumber(type.basePriceCurrent),
        basePriceMinimum: toNumber(type.basePriceMinimum),
      },
    ]),
  ) as PopPersonConfig["actionTypes"];

  if (!actionTypes.hate || !actionTypes.fan) {
    throw new Error("Os tipos de ação hate e fan precisam estar configurados.");
  }

  return {
    actionTypes,
    levels: activeLevels,
  };
}

export async function getPopPersonBootstrap(
  sessionId?: string,
  user: AuthenticatedPopPersonUser | null = null,
): Promise<PopPersonBootstrap> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  const [config, state, player] = await Promise.all([
    getPopPersonConfig(),
    currentState(roomId),
    getPlayerMembership(roomId, user?.id),
  ]);
  return { config, state, user, player };
}

export async function getPopPersonState(
  sessionId?: string,
): Promise<PopPersonState> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  return currentState(roomId);
}

export async function getPlayerRegistration(
  user: AuthenticatedPopPersonUser,
): Promise<PlayerRegistration> {
  const categories = await db
    .select({
      id: categoriesTable.id,
      name: categoriesTable.name,
      slug: categoriesTable.slug,
      parentId: categoriesTable.parentId,
    })
    .from(categoriesTable)
    .where(eq(categoriesTable.active, true))
    .orderBy(asc(categoriesTable.name));
  return {
    user: {
      xUserId: user.xUserId,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
      email: user.email,
    },
    categories,
    defaultCategoryId:
      categories.find((category) => category.slug === "players")?.id ??
      categories[0]?.id ??
      null,
  };
}

async function getPlayerMembership(
  roomId: string,
  userId?: string,
): Promise<PopPersonBootstrap["player"]> {
  if (!userId) return { isPlayer: false, name: null };

  const [player] = await db
    .select({ name: peopleTable.name })
    .from(peopleTable)
    .innerJoin(cellsTable, eq(cellsTable.personId, peopleTable.id))
    .where(
      and(
        eq(peopleTable.playerUserId, userId),
        eq(cellsTable.roomId, roomId),
        eq(cellsTable.active, true),
        eq(peopleTable.active, true),
      ),
    )
    .limit(1);

  return { isPlayer: Boolean(player), name: player?.name ?? null };
}

function playerDisplayName(user: AuthenticatedPopPersonUser): string {
  return user.name.trim();
}

function playerColor(xUserId: string): string {
  const palette = [
    "#7c3aed",
    "#2563eb",
    "#0891b2",
    "#059669",
    "#ca8a04",
    "#ea580c",
    "#db2777",
  ];
  let hash = 0;
  for (const character of xUserId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function locationCode(value: string, maxLength: number): string {
  const code = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, maxLength);
  return code || "UNKNOWN";
}

export async function joinPopPersonAsPlayer(
  user: AuthenticatedPopPersonUser,
  sessionId?: string,
  input?: JoinPopPersonBody,
  accessLocation?: ResolvedAccessLocation,
): Promise<PopPerson> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  const now = new Date();
  const displayName = playerDisplayName(user);
  const slug = `player-${user.xUserId}`;
  if (!input?.categoryId || !input.location) {
    throw new Error("Categoria e localização são obrigatórias.");
  }
  if (!input.termsAccepted) {
    throw new Error("É necessário aceitar os Termos e Condições do InstaPop.");
  }
  const location = input.location;
  if (
    !location.city.trim() ||
    !location.region.trim() ||
    !location.country.trim()
  ) {
    throw new Error("Informe cidade, estado e país.");
  }
  if (!accessLocation) {
    throw new Error("Não foi possível entrar na disputa. Tente novamente.");
  }

  await db.transaction(async (tx) => {
    const [category] = await tx
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(
        and(
          eq(categoriesTable.id, input.categoryId),
          eq(categoriesTable.active, true),
        ),
      )
      .limit(1);
    if (!category) throw new Error("Não foi possível definir sua categoria.");

    const [savedLocation] = await tx
      .insert(locationsTable)
      .values({
        city: location.city.trim(),
        state: location.region.trim(),
        stateCode: locationCode(location.region, 16),
        country: location.country.trim(),
        countryCode: locationCode(location.country, 8),
      })
      .onConflictDoUpdate({
        target: [
          locationsTable.countryCode,
          locationsTable.stateCode,
          locationsTable.city,
        ],
        set: {
          state: location.region.trim(),
          country: location.country.trim(),
        },
      })
      .returning({ id: locationsTable.id });
    if (!savedLocation) throw new Error("Não foi possível salvar sua localização.");

    const [existing] = await tx
      .select({ id: peopleTable.id })
      .from(peopleTable)
      .where(eq(peopleTable.playerUserId, user.id))
      .limit(1);

    let personId = existing?.id;
    if (personId) {
      await tx
        .update(peopleTable)
        .set({
          name: displayName,
          slug,
          categoryId: category.id,
          gender: null,
          color: playerColor(user.xUserId),
          status: "candidato",
          imageUrl: user.avatarUrl,
          locationId: savedLocation.id,
          active: true,
          updatedAt: now,
        })
        .where(eq(peopleTable.id, personId));
    } else {
      const [created] = await tx
        .insert(peopleTable)
        .values({
          name: displayName,
          slug,
          categoryId: category.id,
          gender: null,
          color: playerColor(user.xUserId),
          status: "candidato",
          imageUrl: user.avatarUrl,
          locationId: savedLocation.id,
          playerUserId: user.id,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: peopleTable.id });
      personId = created?.id;
    }
    if (!personId) throw new Error("Não foi possível concluir sua entrada na disputa.");

    await tx
      .insert(cellsTable)
      .values({
        roomId,
        personId,
        currentValue: "10",
        minimumValue: "2",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cellsTable.roomId, cellsTable.personId],
        set: { active: true, updatedAt: now },
      });

    const [updatedRoom] = await tx
      .update(roomsTable)
      .set({
        stateVersion: sql`${roomsTable.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(roomsTable.id, roomId))
      .returning({ stateVersion: roomsTable.stateVersion });
    await enqueueRealtimeNotification(tx, {
      type: "state:changed",
      roomId,
      stateVersion: toNumber(updatedRoom?.stateVersion),
    });
  });

  const dataset = await getDataset(roomId);
  const player = dataset.find((person) => person.name === displayName);
  if (!player) throw new Error("Player criado, mas não pôde ser carregado.");
  return player;
}

function calculateActionValues(
  basePrice: number,
  level: {
    startDelayMs: number;
    multiplier: string;
    staggerMs: number;
    durationMs: number;
    growthPerHit: string;
    impactMultiplier: string;
    shake: boolean;
  },
) {
  const multiplier = toNumber(level.multiplier, 1);
  const count = Math.max(1, Math.round(multiplier));
  const startDelayMs = level.startDelayMs;
  const staggerMs = level.staggerMs;
  const durationMs = level.durationMs;
  const impactMultiplier = toNumber(level.impactMultiplier, 1);
  const growthPerHit = toNumber(level.growthPerHit) * impactMultiplier;
  const price = roundCurrency(basePrice * multiplier);
  return {
    startDelayMs,
    count,
    staggerMs,
    durationMs,
    growthPerHit,
    impactMultiplier,
    shake: level.shake,
    price,
    totalImpact: growthPerHit * count,
      multiplier,
  };
}

function modeForActionType(actionType: "hate" | "fan"): "atacar" | "defender" {
  return actionType === "fan" ? "defender" : "atacar";
}

type StripeCheckoutUser = {
  id: string;
  email?: string | null;
};

export type PopPersonCheckout = {
  paymentOrderId: string;
  checkoutSessionId: string;
  clientSecret: string;
  publishableKey: string;
  amount: number;
  currency: string;
};

export async function getPopPersonPaymentStatus(
  checkoutSessionId: string,
  userId: string,
) {
  const [order] = await db
    .select()
    .from(paymentOrdersTable)
    .where(
      and(
        eq(paymentOrdersTable.stripeCheckoutSessionId, checkoutSessionId),
        eq(paymentOrdersTable.userId, userId),
      ),
    )
    .limit(1);

  if (!order) {
    throw new Error("Pedido de pagamento não encontrado.");
  }

  const [action] = order.actionId
    ? await getActions(order.roomId, order.actionId)
    : [];
  const [resolution] = order.actionId
    ? await db
        .select({ payload: actionEventsTable.payload })
        .from(actionEventsTable)
        .where(
          and(
            eq(actionEventsTable.actionId, order.actionId),
            eq(actionEventsTable.eventType, "completed"),
          ),
        )
        .orderBy(desc(actionEventsTable.sequence))
        .limit(1)
    : [];
  const resolutionPayload = resolution?.payload && typeof resolution.payload === "object"
    ? resolution.payload as Record<string, unknown>
    : {};
  const replayFinalValue = toNumber(resolutionPayload.finalValue, Number.NaN);
  const replayDelta = toNumber(resolutionPayload.delta, Number.NaN);
  const replayPreviousValue = toNumber(
    resolutionPayload.previousValue,
    Number.isFinite(replayFinalValue) && Number.isFinite(replayDelta)
      ? replayFinalValue - replayDelta
      : Number.NaN,
  );
  const replay = action?.status === "completed"
    && Number.isFinite(replayPreviousValue)
    && Number.isFinite(replayFinalValue)
    ? {
        targetName: action.targetName,
        previousValue: replayPreviousValue,
        finalValue: replayFinalValue,
        delta: Number.isFinite(replayDelta)
          ? replayDelta
          : replayFinalValue - replayPreviousValue,
        hitCount: Math.max(
          1,
          toNumber(resolutionPayload.hitCount, action.count),
        ),
        durationMs: Math.max(0, action.duration),
        intervalMs: Math.max(0, action.staggerMs),
      }
    : null;

  return {
    status: order.status,
    actionId: order.actionId ?? null,
    action: action ?? null,
    replay,
  };
}

async function getStripeActionProduct() {
  const { getUncachableStripeClient } = await import("./stripe-client");
  const stripe = await getUncachableStripeClient();
  const configuredProductId = process.env.STRIPE_POPPERSON_PRODUCT_ID?.trim();
  if (configuredProductId) {
    return { stripe, product: await stripe.products.retrieve(configuredProductId) };
  }
  const products = await stripe.products.list({ active: true, limit: 100 });
  const existing = products.data.find(
    (product) => product.metadata?.instapop_kind === "action",
  );
  if (existing) return { stripe, product: existing };
  return {
    stripe,
    product: await stripe.products.create({
      name: "InstaPop — ação de popularidade",
      description: "Ação individual de hate ou apoio no jogo global InstaPop.",
      metadata: { instapop_kind: "action" },
    }),
  };
}

export async function createPopPersonCheckout(
  input: PopPersonActionInput,
  sessionId: string | undefined,
  user: StripeCheckoutUser,
  returnOrigin: string,
): Promise<PopPersonCheckout> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  const order = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentOrdersTable)
      .where(
        and(
          eq(paymentOrdersTable.userId, user.id),
          eq(paymentOrdersTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [target] = await tx
      .select({
        cellId: cellsTable.id,
        targetName: peopleTable.name,
      })
      .from(cellsTable)
      .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
      .where(
        and(
          eq(cellsTable.roomId, roomId),
          eq(cellsTable.active, true),
          eq(peopleTable.active, true),
          eq(peopleTable.name, input.targetName),
        ),
      )
      .limit(1);
    const [actionType] = await tx
      .select()
      .from(actionTypesTable)
      .where(
        and(
          eq(actionTypesTable.code, input.actionType),
          eq(actionTypesTable.active, true),
        ),
      )
      .limit(1);
    const [level] = await tx
      .select()
      .from(actionLevelsTable)
      .where(
        and(
          eq(actionLevelsTable.code, input.level),
          eq(actionLevelsTable.actionTypeId, actionType?.id ?? ""),
          eq(actionLevelsTable.active, true),
        ),
      )
      .limit(1);
    if (!target || !actionType || !level) {
      throw new Error("Ação inválida: tipo, nível ou alvo não encontrado.");
    }

    const [targetActionCounts] = await tx
      .select({
        totalFans: sql<number>`count(*) filter (where ${actionsTable.mode} = 'defender')::int`,
        totalHaters: sql<number>`count(*) filter (where ${actionsTable.mode} = 'atacar')::int`,
      })
      .from(actionsTable)
      .where(
        and(
          eq(actionsTable.cellId, target.cellId),
          inArray(actionsTable.status, CONFIRMED_ACTION_STATUSES),
        ),
      );
    const basePrice = calculatePopularityBasePrice(
      toNumber(targetActionCounts?.totalFans),
      toNumber(targetActionCounts?.totalHaters),
    );
    const values = calculateActionValues(basePrice, level);
    const amountMinor = Math.max(1, Math.round(values.price * 100));
    const [created] = await tx
      .insert(paymentOrdersTable)
      .values({
        roomId,
        userId: user.id,
        sessionId: sessionId ?? null,
        provider: "stripe",
        status: "pending",
        targetName: target.targetName,
        actionType: input.actionType,
        actionLevel: input.level,
        idempotencyKey,
        currency: "brl",
        basePriceMinor: Math.max(1, Math.round(basePrice * 100)),
        amountMinor,
        metadata: {
          count: values.count,
          startDelayMs: values.startDelayMs,
          staggerMs: values.staggerMs,
          durationMs: values.durationMs,
          targetName: target.targetName,
        },
      })
      .returning();
    if (!created) throw new Error("Não foi possível criar o pedido de pagamento.");
    return created;
  });

  if (order.stripeCheckoutSessionId && order.status === "pending") {
    const { getStripePublishableKey } = await import("./stripe-client");
    const { stripe } = await getStripeActionProduct();
    const existingSession = await stripe.checkout.sessions.retrieve(
      order.stripeCheckoutSessionId,
    );
    if (existingSession.client_secret) {
      return {
        paymentOrderId: order.id,
        checkoutSessionId: existingSession.id,
        clientSecret: existingSession.client_secret,
        publishableKey: await getStripePublishableKey(),
        amount: order.amountMinor / 100,
        currency: order.currency,
      };
    }
  }
  if (order.status === "paid" && order.actionId) {
    throw new Error("Esta ação já foi paga e enviada.");
  }

  const { stripe, product } = await getStripeActionProduct();
  const { getStripePublishableKey } = await import("./stripe-client");
  const price = await stripe.prices.create({
    product: product.id,
    currency: order.currency,
    unit_amount: order.amountMinor,
    metadata: {
      payment_order_id: order.id,
      instapop_kind: "action",
    },
  });
  const safeOrigin = /^https?:\/\//i.test(returnOrigin)
    ? returnOrigin.replace(/\/+$/, "")
    : `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    ui_mode: "embedded_page",
    line_items: [{ price: price.id, quantity: 1 }],
    customer_email: user.email?.trim() || undefined,
    client_reference_id: order.id,
    metadata: {
      payment_order_id: order.id,
      user_id: user.id,
      target_name: order.targetName,
    },
    redirect_on_completion: "never",
    return_url: `${safeOrigin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  if (!checkoutSession.client_secret) {
    throw new Error("O Stripe não retornou o segredo do checkout embutido.");
  }

  await db
    .update(paymentOrdersTable)
    .set({
      stripeProductId: product.id,
      stripePriceId: price.id,
      stripeCheckoutSessionId: checkoutSession.id,
      updatedAt: new Date(),
    })
    .where(eq(paymentOrdersTable.id, order.id));

  return {
    paymentOrderId: order.id,
    checkoutSessionId: checkoutSession.id,
    clientSecret: checkoutSession.client_secret,
    publishableKey: await getStripePublishableKey(),
    amount: order.amountMinor / 100,
    currency: order.currency,
  };
}

export async function createPopPersonAction(
  input: PopPersonActionInput,
  sessionId: string | undefined,
  userId: string,
  options: { priceOverride?: number } = {},
): Promise<PopPersonAction> {
  if (!userId.trim()) {
    throw new Error("Conecte sua conta do X para enviar ações.");
  }

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
      if (existing) return { action: existing, created: false, stateVersion: null };
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
          eq(peopleTable.active, true),
          eq(peopleTable.name, input.targetName),
        ),
      )
      .limit(1);
    const [actionType] = await tx
      .select()
      .from(actionTypesTable)
      .where(
        and(
          eq(actionTypesTable.code, input.actionType),
          eq(actionTypesTable.active, true),
        ),
      )
      .limit(1);
    const [level] = await tx
      .select()
      .from(actionLevelsTable)
      .where(
        and(
          eq(actionLevelsTable.code, input.level),
          eq(actionLevelsTable.actionTypeId, actionType?.id ?? ""),
          eq(actionLevelsTable.active, true),
        ),
      )
      .limit(1);

    if (!target || !actionType || !level) {
      throw new Error("Ação inválida: tipo, nível ou alvo não encontrado.");
    }

    const [targetActionCounts] = await tx
      .select({
        totalFans: sql<number>`count(*) filter (where ${actionsTable.mode} = 'defender')::int`,
        totalHaters: sql<number>`count(*) filter (where ${actionsTable.mode} = 'atacar')::int`,
      })
      .from(actionsTable)
      .where(
        and(
          eq(actionsTable.cellId, target.cellId),
          inArray(actionsTable.status, CONFIRMED_ACTION_STATUSES),
        ),
      );
    const totalFans = toNumber(targetActionCounts?.totalFans);
    const totalHaters = toNumber(targetActionCounts?.totalHaters);
    const basePrice = calculatePopularityBasePrice(totalFans, totalHaters);

    const [source] = userId
      ? await tx
          .select({ cellId: cellsTable.id })
          .from(cellsTable)
          .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
          .where(
            and(
              eq(cellsTable.roomId, roomId),
              eq(cellsTable.active, true),
              eq(peopleTable.playerUserId, userId),
              eq(peopleTable.active, true),
            ),
          )
          .limit(1)
      : [];
    const values = calculateActionValues(basePrice, level);
    const scheduledFor = new Date(now.getTime() + values.startDelayMs);
    const completesAt = new Date(
      scheduledFor.getTime() +
        (values.count - 1) * values.staggerMs +
        values.durationMs,
    );
    const chargedPrice = options.priceOverride ?? values.price;
    const ruleSnapshot = {
      startDelayMs: values.startDelayMs,
      count: values.count,
      staggerMs: values.staggerMs,
      durationMs: values.durationMs,
      growthPerHit: values.growthPerHit,
      impactMultiplier: values.impactMultiplier,
      shake: values.shake,
      totalImpact: values.totalImpact,
      basePrice,
      price: chargedPrice,
      actionTypeCode: actionType.code,
      levelCode: level.code,
      levelName: level.label,
      levelEmoji: level.emoji,
      multiplier: values.multiplier,
    };
    const [action] = await tx
      .insert(actionsTable)
      .values({
        roomId,
        cellId: target.cellId,
        sourceCellId: source?.cellId ?? null,
        sessionId: sessionId ?? null,
        actionTypeId: actionType.id,
        actionLevelId: level.id,
        mode: modeForActionType(input.actionType),
        status: "queued",
        startDelayMs: values.startDelayMs,
        scheduledFor,
        completesAt,
        effectiveImpact: String(values.totalImpact),
        priceCharged: String(chargedPrice),
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

    const [queuedRoom] = await tx
      .update(roomsTable)
      .set({
        stateVersion: sql`${roomsTable.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(roomsTable.id, roomId))
      .returning({ stateVersion: roomsTable.stateVersion });
    await enqueueRealtimeNotification(tx, {
      type: "state:changed",
      roomId,
      stateVersion: toNumber(queuedRoom?.stateVersion),
    });

    return {
      action,
      created: true,
      stateVersion: toNumber(queuedRoom?.stateVersion),
    };
  });

  if (result.created) {
    logger.info(
      {
        actionId: result.action.id,
        roomId: result.action.roomId,
        state: result.action.status,
        executeAt: result.action.scheduledFor.getTime(),
        completesAt: result.action.completesAt.getTime(),
        hitCount: snapshotNumber(result.action.ruleSnapshot, "count", 0),
        stateVersion: result.stateVersion,
      },
      "PopPerson action queued",
    );
  }
  const [response] = await getActions(roomId, result.action.id);
  if (!response) throw new Error("Ação criada, mas não pôde ser carregada.");
  return response;
}

export async function fulfillStripeCheckout(
  checkoutSession: Stripe.Checkout.Session,
): Promise<void> {
  const paymentOrderId =
    checkoutSession.metadata?.payment_order_id ?? checkoutSession.client_reference_id;
  if (!paymentOrderId) {
    throw new Error("Stripe Checkout session is missing payment_order_id.");
  }

  const [order] = await db
    .select()
    .from(paymentOrdersTable)
    .where(eq(paymentOrdersTable.id, paymentOrderId))
    .limit(1);
  if (!order) throw new Error(`Payment order "${paymentOrderId}" was not found.`);
  if (order.actionId) return;

  const action = await createPopPersonAction(
    {
      actionType: order.actionType as PopPersonActionInput["actionType"],
      level: order.actionLevel,
      targetName: order.targetName,
      idempotencyKey: `stripe:${order.id}`,
    },
    order.sessionId ?? undefined,
    order.userId,
    { priceOverride: order.amountMinor / 100 },
  );

  await db
    .update(paymentOrdersTable)
    .set({
      status: "paid",
      actionId: action.id,
      stripePaymentIntentId:
        typeof checkoutSession.payment_intent === "string"
          ? checkoutSession.payment_intent
          : checkoutSession.payment_intent?.id ?? null,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentOrdersTable.id, order.id),
        isNull(paymentOrdersTable.actionId),
      ),
    );
}

async function nextActionEventSequence(
  tx: any,
  actionId: string,
): Promise<string> {
  const [lastEvent] = await tx
    .select({ sequence: actionEventsTable.sequence })
    .from(actionEventsTable)
    .where(eq(actionEventsTable.actionId, actionId))
    .orderBy(desc(actionEventsTable.sequence))
    .limit(1);
  return String(toNumber(lastEvent?.sequence, 0) + 1);
}

async function processDueActions(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${POP_PERSON_WORKER_LOCK_KEY}) AS locked`,
      );
      const lockRow = (
        lockResult as unknown as { rows?: Array<{ locked?: boolean | string }> }
      ).rows?.[0];
      const lockAcquired = lockRow?.locked === true || lockRow?.locked === "t";
      if (!lockAcquired) return;

      const now = new Date();
      const dueActions = await tx
        .select({
          id: actionsTable.id,
          roomId: actionsTable.roomId,
          cellId: actionsTable.cellId,
          mode: actionsTable.mode,
          status: actionsTable.status,
          scheduledFor: actionsTable.scheduledFor,
          completesAt: actionsTable.completesAt,
          effectiveImpact: actionsTable.effectiveImpact,
          ruleSnapshot: actionsTable.ruleSnapshot,
          targetName: peopleTable.name,
          actionType: actionTypesTable.code,
          levelEmoji: actionLevelsTable.emoji,
        })
        .from(actionsTable)
        .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
        .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
        .leftJoin(actionTypesTable, eq(actionsTable.actionTypeId, actionTypesTable.id))
        .innerJoin(actionLevelsTable, eq(actionsTable.actionLevelId, actionLevelsTable.id))
        .where(
          and(
            inArray(actionsTable.status, ["queued", "running"]),
            lte(actionsTable.scheduledFor, now),
          ),
        )
        .orderBy(asc(actionsTable.scheduledFor))
        .limit(100);

      for (const action of dueActions) {
        if (action.status !== "queued") continue;
        const [activated] = await tx
          .update(actionsTable)
          .set({
            status: "running",
            activatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(actionsTable.id, action.id),
              eq(actionsTable.status, "queued"),
              lte(actionsTable.scheduledFor, now),
            ),
          )
          .returning({ id: actionsTable.id });
        if (!activated) continue;

        const [startedRoom] = await tx
          .update(roomsTable)
          .set({
            stateVersion: sql`${roomsTable.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(roomsTable.id, action.roomId))
          .returning({ stateVersion: roomsTable.stateVersion });
        await enqueueRealtimeNotification(tx, {
          type: "action:started",
          roomId: action.roomId,
          actionId: action.id,
          stateVersion: toNumber(startedRoom?.stateVersion),
        });
        await tx.insert(actionEventsTable).values({
          actionId: action.id,
          roomId: action.roomId,
          cellId: action.cellId,
          sequence: await nextActionEventSequence(tx, action.id),
          eventType: "started",
          status: "running",
          payload: {
            kind: "action:started",
            actionId: action.id,
            startedAt: now.toISOString(),
          },
        });
      }

      const runningActions = await tx
        .select({
          id: actionsTable.id,
          roomId: actionsTable.roomId,
          cellId: actionsTable.cellId,
          mode: actionsTable.mode,
          status: actionsTable.status,
          scheduledFor: actionsTable.scheduledFor,
          completesAt: actionsTable.completesAt,
          effectiveImpact: actionsTable.effectiveImpact,
          ruleSnapshot: actionsTable.ruleSnapshot,
          targetName: peopleTable.name,
          actionType: actionTypesTable.code,
          levelEmoji: actionLevelsTable.emoji,
        })
        .from(actionsTable)
        .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
        .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
        .leftJoin(actionTypesTable, eq(actionsTable.actionTypeId, actionTypesTable.id))
        .innerJoin(actionLevelsTable, eq(actionsTable.actionLevelId, actionLevelsTable.id))
        .where(
          and(
            eq(actionsTable.status, "running"),
            lte(actionsTable.scheduledFor, now),
          ),
        )
        .orderBy(asc(actionsTable.scheduledFor))
        .limit(100);

      let remainingHitBudget = MAX_HITS_PER_TRANSACTION;
      const roomStateVersions = new Map<string, number>();
      for (const action of runningActions) {
        const previousEvents = await tx
          .select({
            sequence: actionEventsTable.sequence,
            eventType: actionEventsTable.eventType,
            payload: actionEventsTable.payload,
          })
          .from(actionEventsTable)
          .where(eq(actionEventsTable.actionId, action.id));
        const alreadyResolved = previousEvents.some(
          (event) => event.eventType === "completed",
        );
        if (alreadyResolved) {
          await tx
            .update(actionsTable)
            .set({
              status: "completed",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(actionsTable.id, action.id));
          continue;
        }

        const previousHitCount = previousEvents.filter(
          (event) => event.eventType === "hit",
        ).length;
        const previousSequence = previousEvents.reduce(
          (highest, event) => Math.max(highest, toNumber(event.sequence)),
          0,
        );
        const hitCount = Math.max(
          1,
          Math.floor(snapshotNumber(action.ruleSnapshot, "count", 1)),
        );
        const timeline = {
          executeAt: action.scheduledFor.getTime(),
          duration: Math.max(0, snapshotNumber(action.ruleSnapshot, "durationMs", 0)),
          staggerMs: Math.max(0, snapshotNumber(action.ruleSnapshot, "staggerMs", 0)),
          count: hitCount,
        };
        const dueHitCount = dueHitCountAt(timeline, now.getTime());
        const remainingHitCount = Math.max(0, dueHitCount - previousHitCount);
        const direction = action.mode === "defender" ? 1 : -1;
        const growthPerHit = snapshotNumber(
          action.ruleSnapshot,
          "growthPerHit",
          toNumber(action.effectiveImpact) / hitCount,
        );
        const delta = growthPerHit * direction;
        const durationMs = timeline.duration;
        const intervalMs = timeline.staggerMs;

        const [cell] = await tx
          .select({
            currentValue: cellsTable.currentValue,
            minimumValue: cellsTable.minimumValue,
          })
          .from(cellsTable)
          .where(eq(cellsTable.id, action.cellId))
          .limit(1);
        if (!cell) {
          throw new Error(`Ação ${action.id} perdeu seu alvo durante a resolução.`);
        }

        let currentValue = toNumber(cell.currentValue);
        let roomStateVersion = roomStateVersions.get(action.roomId);
        if (roomStateVersion === undefined) {
          const [room] = await tx
            .select({ stateVersion: roomsTable.stateVersion })
            .from(roomsTable)
            .where(eq(roomsTable.id, action.roomId))
            .limit(1);
          if (!room) throw new Error(`Ação ${action.id} perdeu sua sala durante a resolução.`);
          roomStateVersion = toNumber(room.stateVersion);
          roomStateVersions.set(action.roomId, roomStateVersion);
        }
        let lastStateVersion = roomStateVersion;
        let processedHits = 0;
        const pendingHitEventRows: Array<typeof actionEventsTable.$inferInsert> = [];
        const pendingHitNotifications: PopPersonRealtimeNotification[] = [];
        const firstHitPreviousValue = previousEvents
          .find((event) => event.eventType === "hit")
          ?.payload?.previousValue;
        const actionPreviousValue = Number(firstHitPreviousValue);

        for (
          let offset = 0;
          offset < remainingHitCount && remainingHitBudget > 0;
          offset += 1
        ) {
          const hitIndex = previousHitCount + offset + 1;
          const previousValue = currentValue;
          const finalValue = Math.max(
            toNumber(cell.minimumValue),
            previousValue + delta,
          );
          currentValue = finalValue;
          processedHits += 1;
          roomStateVersion += 1;
          lastStateVersion = roomStateVersion;
          const sequence = previousSequence + processedHits;
          const hitEvent: PopPersonHitEvent = {
            eventId: randomUUID(),
            actionId: action.id,
            sequence,
            hitIndex,
            hitAt: hitAtForIndex(timeline, hitIndex),
            targetName: action.targetName,
            actionType: action.actionType === "fan" ? "fan" : "hate",
            direction: action.mode,
            emoji: action.levelEmoji || (action.actionType === "fan" ? "❤️" : "💢"),
            delta: currentValue - previousValue,
            previousValue,
            finalValue: currentValue,
            stateVersion: lastStateVersion,
          };

          pendingHitEventRows.push({
            actionId: action.id,
            roomId: action.roomId,
            cellId: action.cellId,
            sequence: String(sequence),
            eventType: "hit",
            status: "running",
            deltaValue: String(hitEvent.delta),
            payload: { kind: "action:hit", ...hitEvent },
          });
          pendingHitNotifications.push({
            type: "action:hit",
            roomId: action.roomId,
            actionId: action.id,
            event: hitEvent,
          });
          remainingHitBudget -= 1;
        }

        if (processedHits > 0) {
          const [updatedCell] = await tx
            .update(cellsTable)
            .set({
              currentValue: String(currentValue),
              stateVersion: sql`${cellsTable.stateVersion} + ${processedHits}`,
              updatedAt: now,
            })
            .where(eq(cellsTable.id, action.cellId))
            .returning({ id: cellsTable.id });
          if (!updatedCell) {
            throw new Error(`Ação ${action.id} não conseguiu atualizar sua célula.`);
          }
          const [updatedRoom] = await tx
            .update(roomsTable)
            .set({
              stateVersion: sql`${roomsTable.stateVersion} + ${processedHits}`,
              updatedAt: now,
            })
            .where(eq(roomsTable.id, action.roomId))
            .returning({ stateVersion: roomsTable.stateVersion });
          roomStateVersion = toNumber(updatedRoom?.stateVersion, roomStateVersion);
          roomStateVersions.set(action.roomId, roomStateVersion);
          lastStateVersion = roomStateVersion;
          await tx.insert(actionEventsTable).values(pendingHitEventRows);
          await tx
            .update(actionsTable)
            .set({ updatedAt: now })
            .where(eq(actionsTable.id, action.id));
          await enqueueRealtimeNotificationBatch(tx, pendingHitNotifications);
        }

        const recordedHitCount = previousHitCount + processedHits;
        const timelineComplete = isTimelineComplete(
          timeline,
          recordedHitCount,
          now.getTime(),
        );
        if (!timelineComplete) continue;

        const [claimed] = await tx
          .update(actionsTable)
          .set({
            status: "completed",
            completedAt: now,
            updatedAt: now,
          })
          .where(and(eq(actionsTable.id, action.id), eq(actionsTable.status, "running")))
          .returning();
        if (!claimed) continue;

        const resolvedPreviousValue = Number.isFinite(actionPreviousValue)
          ? actionPreviousValue
          : currentValue - delta * hitCount;
        const resolvedEvent: PopPersonResolvedEvent = {
          eventId: action.id,
          actionId: action.id,
          hitCount: recordedHitCount,
          direction: action.mode,
          delta,
          targetName: action.targetName,
          previousValue: resolvedPreviousValue,
          finalValue: currentValue,
          durationMs,
          intervalMs,
          stateVersion: lastStateVersion,
          resolvedAt: now.getTime(),
        };

        const completedSequence = await nextActionEventSequence(tx, claimed.id);
        await tx.insert(actionEventsTable).values({
          actionId: claimed.id,
          roomId: claimed.roomId,
          cellId: claimed.cellId,
          sequence: completedSequence,
          eventType: "completed",
          status: "completed",
          deltaValue: String(resolvedEvent.finalValue - resolvedEvent.previousValue),
          payload: {
            kind: "action:resolved",
            ...resolvedEvent,
            resolvedAt: now.toISOString(),
          },
        });
        await enqueueRealtimeNotification(tx, {
          type: "action:resolved",
          roomId: claimed.roomId,
          actionId: claimed.id,
          event: resolvedEvent,
        });
        logger.info(
          {
            actionId: claimed.id,
            targetName: resolvedEvent.targetName,
            hitCount: resolvedEvent.hitCount,
            previousValue: resolvedEvent.previousValue,
            finalValue: resolvedEvent.finalValue,
            stateVersion: resolvedEvent.stateVersion,
          },
          "PopPerson action resolved",
        );
      }
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to resolve PopPerson actions");
  } finally {
    processing = false;
  }
}

async function processDueActionsLegacy(): Promise<void> {
  // Kept only as a migration marker for source-map compatibility. The
  // resolved-event worker above is the sole action processor.
  return;
  /*
  if (processing) return;
  processing = true;
  let hitsWritten = 0;
  let persistedHitEvents: PopPersonHitEvent[] = [];
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      hitsWritten = 0;
      persistedHitEvents = [];
      const now = new Date();
      try {
        await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${POP_PERSON_WORKER_LOCK_KEY}) AS locked`,
      );
      const lockRow = (
        lockResult as unknown as { rows?: Array<{ locked?: boolean | string }> }
      ).rows?.[0];
      const lockAcquired = lockRow?.locked === true || lockRow?.locked === "t";
      if (!lockAcquired) return;

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
        const [startedRoom] = await tx
          .update(roomsTable)
          .set({
            stateVersion: sql`${roomsTable.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(roomsTable.id, action.roomId))
          .returning({ stateVersion: roomsTable.stateVersion });
        await enqueueRealtimeNotification(tx, {
          type: "action:started",
          roomId: action.roomId,
          actionId: action.id,
          stateVersion: toNumber(startedRoom?.stateVersion),
        });
      }

      const runningActions = await tx
        .select({
          id: actionsTable.id,
          roomId: actionsTable.roomId,
          cellId: actionsTable.cellId,
          actionLevelId: actionsTable.actionLevelId,
          mode: actionsTable.mode,
          status: actionsTable.status,
          startDelayMs: actionsTable.startDelayMs,
          scheduledFor: actionsTable.scheduledFor,
          completesAt: actionsTable.completesAt,
          activatedAt: actionsTable.activatedAt,
          completedAt: actionsTable.completedAt,
          effectiveImpact: actionsTable.effectiveImpact,
          ruleSnapshot: actionsTable.ruleSnapshot,
          targetName: peopleTable.name,
        })
        .from(actionsTable)
        .innerJoin(cellsTable, eq(actionsTable.cellId, cellsTable.id))
        .innerJoin(peopleTable, eq(cellsTable.personId, peopleTable.id))
        .where(
          eq(actionsTable.status, "running"),
        )
        .orderBy(asc(actionsTable.scheduledFor))
        .limit(100);

      for (let actionIndex = 0; actionIndex < runningActions.length; actionIndex += 1) {
        const action = runningActions[actionIndex];
        const hitEvents = await tx
          .select({ id: actionEventsTable.id })
          .from(actionEventsTable)
          .where(
            and(
              eq(actionEventsTable.actionId, action.id),
              eq(actionEventsTable.eventType, "hit"),
            ),
          );
        const recordedHitCount = hitEvents.length;
        const projectileCount = Math.max(
          1,
          Math.floor(snapshotNumber(action.ruleSnapshot, "count", 1)),
        );
        const staggerMs = Math.max(
          0,
          snapshotNumber(action.ruleSnapshot, "staggerMs", 0),
        );
        const durationMs = Math.max(
          0,
          snapshotNumber(action.ruleSnapshot, "durationMs", 0),
        );
        const timeline = {
          executeAt: action.scheduledFor.getTime(),
          duration: durationMs,
          staggerMs,
          count: projectileCount,
        };
        const dueHitCount = dueHitCountAt(timeline, now.getTime());
        const direction = action.mode === "defender" ? 1 : -1;
        const growthPerHit = snapshotNumber(
          action.ruleSnapshot,
          "growthPerHit",
          toNumber(action.effectiveImpact) / projectileCount,
        );
        const delta = growthPerHit * direction;

        // Share the transaction budget across all running actions. Without a
        // per-action quota, the oldest large action can consume all 50 slots
        // on every pass and newer actions remain running forever with zero
        // recorded hits.
        const remainingActions = runningActions.length - actionIndex;
        const remainingBudget = Math.max(0, MAX_HITS_PER_TRANSACTION - hitsWritten);
        const fairActionQuota = remainingBudget > 0
          ? Math.max(
              1,
              Math.ceil(remainingBudget / Math.max(1, remainingActions)),
            )
          : 0;
        const hitLimit = Math.min(
          dueHitCount,
          recordedHitCount + fairActionQuota,
        );
        for (let hitIndex = recordedHitCount; hitIndex < hitLimit; hitIndex += 1) {
          const hitAt = new Date(hitAtForIndex(timeline, hitIndex + 1));
          const [insertedHit] = await tx
            .insert(actionEventsTable)
            .values({
              actionId: action.id,
              roomId: action.roomId,
              cellId: action.cellId,
              sequence: String(hitIndex + 3),
              eventType: "hit",
              status: "running",
              deltaValue: String(delta),
              payload: {
                hitIndex: hitIndex + 1,
                hitAt: hitAt.toISOString(),
                direction: action.mode,
              },
            })
            .onConflictDoNothing({
              target: [actionEventsTable.actionId, actionEventsTable.sequence],
            })
            .returning({ id: actionEventsTable.id });
          if (!insertedHit) continue;

          const [updatedCell] = await tx
            .update(cellsTable)
            .set({
              // Apply each projectile's impact as it lands. Cells have a
              // floor for attacks, but no upper bound for repeated defense.
              currentValue: sql`GREATEST(
                ${cellsTable.minimumValue},
                ${cellsTable.currentValue} + ${delta}
              )`,
              stateVersion: sql`${cellsTable.stateVersion} + 1`,
              updatedAt: now,
            })
            .where(eq(cellsTable.id, action.cellId))
            .returning({ currentValue: cellsTable.currentValue });
          const [updatedRoom] = await tx
            .update(roomsTable)
            .set({
              stateVersion: sql`${roomsTable.stateVersion} + 1`,
              updatedAt: now,
            })
            .where(eq(roomsTable.id, action.roomId))
            .returning({ stateVersion: roomsTable.stateVersion });
          if (!updatedCell || !updatedRoom) {
            throw new Error(`Ação ${action.id} perdeu seu alvo durante o hit.`);
          }
          const hitEvent: PopPersonHitEvent = {
            actionId: action.id,
            hitIndex: hitIndex + 1,
            sequence: hitIndex + 3,
            hitAt: hitAt.getTime(),
            occurredAt: now.getTime(),
            direction: action.mode,
            delta,
            targetName: action.targetName,
            value: toNumber(updatedCell?.currentValue),
            stateVersion: toNumber(updatedRoom?.stateVersion),
          };
          await tx
            .update(actionEventsTable)
            .set({
              payload: {
                hitIndex: hitEvent.hitIndex,
                hitAt: new Date(hitEvent.hitAt).toISOString(),
                direction: hitEvent.direction,
                value: hitEvent.value,
                stateVersion: hitEvent.stateVersion,
              },
            })
            .where(eq(actionEventsTable.id, insertedHit.id));
          await enqueueRealtimeNotification(tx, {
            type: "action:hit",
            roomId: action.roomId,
            event: hitEvent,
          });
          persistedHitEvents.push(hitEvent);
          hitsWritten += 1;
        }

        const recordedAfterThisPass = recordedHitCount + (hitLimit - recordedHitCount);
        if (!isTimelineComplete(timeline, recordedAfterThisPass, now.getTime())) continue;

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

        await tx.insert(actionEventsTable).values({
          actionId: claimed.id,
          roomId: claimed.roomId,
          cellId: claimed.cellId,
          sequence: String(projectileCount + 3),
          eventType: "completed",
          status: "completed",
          deltaValue: String(toNumber(claimed.effectiveImpact) * direction),
          payload: {
            completedAt: now.toISOString(),
            direction: claimed.mode,
          },
        });
        const [completedRoom] = await tx
          .update(roomsTable)
          .set({
            stateVersion: sql`${roomsTable.stateVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(roomsTable.id, claimed.roomId))
          .returning({ stateVersion: roomsTable.stateVersion });
        await enqueueRealtimeNotification(tx, {
          type: "action:completed",
          roomId: claimed.roomId,
          actionId: claimed.id,
          stateVersion: toNumber(completedRoom?.stateVersion),
        });

        if (hitsWritten >= MAX_HITS_PER_TRANSACTION) break;
      }
        });
        for (const hitEvent of persistedHitEvents) {
          logger.info(
            {
              actionId: hitEvent.actionId,
              hitIndex: hitEvent.hitIndex,
              stateVersion: hitEvent.stateVersion,
              hitAt: hitEvent.hitAt,
              occurredAt: hitEvent.occurredAt,
            },
            "PopPerson hit persisted",
          );
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable = message.includes("deadlock detected") ||
          message.includes("could not serialize");
        if (!retryable || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }

  } catch (error) {
    const { logger } = await import("./logger");
    logger.error({ err: error }, "Failed to process PopPerson actions");
  } finally {
    processing = false;
  }
  */
}