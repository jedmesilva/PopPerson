import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  actionEventsTable,
  actionLevelsTable,
  actionsTable,
  cellsTable,
  categoriesTable,
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
  PopPersonCategory,
  PopPersonConfig,
  PopPersonState,
} from "@workspace/api-zod";
import {
  dueHitCountAt,
  hitAtForIndex,
  isTimelineComplete,
} from "@workspace/api-zod";
import { logger } from "./logger";

const PROCESS_INTERVAL_MS = 500;
// Keep each worker transaction short. A single action can contain thousands of
// projectiles, and processing all due hits at once holds cell/room locks long
// enough to block new action requests and other worker instances.
const MAX_HITS_PER_TRANSACTION = 50;
// Multiple API processes may be connected to the same database. Serialize the
// action worker at the database level so two workers cannot lock the same
// action/cell/room rows in different orders and deadlock each other.
const POP_PERSON_WORKER_LOCK_KEY = 29184731;
export type PopPersonHitEvent = {
  actionId: string;
  hitIndex: number;
  sequence: number;
  hitAt: number;
  occurredAt: number;
  direction: PopPersonAction["mode"];
  delta: number;
  targetName: string;
  value: number;
  stateVersion: number;
};
export type PopPersonRealtimeNotification =
  | {
      type: "action:queued" | "action:started";
      roomId: string;
      actionId: string;
      stateVersion?: number;
    }
  | {
      type: "action:hit";
      roomId: string;
      event: PopPersonHitEvent;
    }
  | {
      type: "action:completed" | "action:cancelled";
      roomId: string;
      actionId: string;
      stateVersion?: number;
    };
type Snapshot = Record<string, unknown>;

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

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const [rows, categories] = await Promise.all([
    db
      .select({
        name: peopleTable.name,
        categoryId: peopleTable.categoryId,
        categoryName: categoriesTable.name,
        categorySlug: categoriesTable.slug,
        categoryParentId: categoriesTable.parentId,
         gender: peopleTable.gender,
        status: peopleTable.status,
         imageUrl: peopleTable.imageUrl,
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
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
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
       imageUrl: person.imageUrl ?? null,
    };
  });
}

type PopPersonElement = PopPersonConfig["elements"]["atacar"][number];

function toPopPersonElement(item: {
  code: string;
  name: string;
  emoji: string | null;
  imageUrl: string | null;
  description: string | null;
  gender: string | null;
  impactPower: string;
  price: string;
}): PopPersonElement {
  if (!item.emoji || (item.gender !== "m" && item.gender !== "f")) {
    throw new Error(`Item "${item.code}" está sem emoji ou gênero válido.`);
  }

  return {
    id: item.code,
    emoji: item.emoji,
    imageUrl: item.imageUrl,
    label: item.name,
    description: item.description,
    force: toNumber(item.impactPower),
    price: toNumber(item.price),
    gender: item.gender,
  };
}

async function getActions(
  roomId: string,
  actionId?: string,
): Promise<PopPersonAction[]> {
  const rows = await db
    .select({
      id: actionsTable.id,
      mode: actionsTable.mode,
      elementId: itemsTable.code,
      elementName: itemsTable.name,
      elementEmoji: itemsTable.emoji,
      elementImageUrl: itemsTable.imageUrl,
      elementDescription: itemsTable.description,
      elementGender: itemsTable.gender,
      elementForce: itemsTable.impactPower,
      elementPrice: itemsTable.price,
      level: actionLevelsTable.code,
      targetName: peopleTable.name,
      status: actionsTable.status,
      priceCharged: actionsTable.priceCharged,
      actionStartDelayMs: actionsTable.startDelayMs,
      executeAt: actionsTable.scheduledFor,
      completesAt: actionsTable.completesAt,
      activatedAt: actionsTable.activatedAt,
      completedAt: actionsTable.completedAt,
      levelCount: actionLevelsTable.projectileCount,
      levelStaggerMs: actionLevelsTable.staggerMs,
      levelDurationMs: actionLevelsTable.durationMs,
      levelGrowthPerHit: actionLevelsTable.growthPerHit,
      levelImpactMultiplier: actionLevelsTable.impactMultiplier,
      levelShake: actionLevelsTable.shake,
      ruleSnapshot: actionsTable.ruleSnapshot,
    })
    .from(actionsTable)
    .innerJoin(itemsTable, eq(actionsTable.itemId, itemsTable.id))
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
    const element = toPopPersonElement({
      code: action.elementId,
      name: action.elementName,
      emoji: action.elementEmoji,
      imageUrl: action.elementImageUrl,
      description: action.elementDescription,
      gender: action.elementGender,
      impactPower: action.elementForce,
      price: action.elementPrice,
    });
    const count = snapshotNumber(action.ruleSnapshot, "count", action.levelCount);
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
      toNumber(action.levelGrowthPerHit) *
        (toNumber(action.elementForce) / 5) *
        impactMultiplier,
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
      elementId: action.elementId,
      level: action.level,
      targetName: action.targetName,
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
      element,
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
  const [dbItems, dbLevels, dbRules] = await Promise.all([
    db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        mode: itemsTable.mode,
        name: itemsTable.name,
        emoji: itemsTable.emoji,
        imageUrl: itemsTable.imageUrl,
        description: itemsTable.description,
        gender: itemsTable.gender,
        impactPower: itemsTable.impactPower,
        price: itemsTable.price,
      })
      .from(itemsTable)
      .where(eq(itemsTable.active, true))
      .orderBy(asc(itemsTable.createdAt)),
    db
      .select({
        id: actionLevelsTable.id,
        code: actionLevelsTable.code,
        label: actionLevelsTable.label,
        powerLabel: actionLevelsTable.powerLabel,
        emoji: actionLevelsTable.emoji,
        projectileCount: actionLevelsTable.projectileCount,
        startDelayMs: actionLevelsTable.startDelayMs,
        staggerMs: actionLevelsTable.staggerMs,
        durationMs: actionLevelsTable.durationMs,
        growthPerHit: actionLevelsTable.growthPerHit,
        impactMultiplier: actionLevelsTable.impactMultiplier,
        shake: actionLevelsTable.shake,
      })
      .from(actionLevelsTable)
      .where(eq(actionLevelsTable.active, true))
      .orderBy(asc(actionLevelsTable.sortOrder)),
    db
      .select({
        itemId: itemActionRulesTable.itemId,
        actionLevelId: itemActionRulesTable.actionLevelId,
        startDelayMs: itemActionRulesTable.startDelayMs,
        impactMultiplier: itemActionRulesTable.impactMultiplier,
        growthPerHit: itemActionRulesTable.growthPerHit,
        projectileCount: itemActionRulesTable.projectileCount,
        staggerMs: itemActionRulesTable.staggerMs,
        durationMs: itemActionRulesTable.durationMs,
        priceOverride: itemActionRulesTable.priceOverride,
      })
      .from(itemActionRulesTable)
      .where(eq(itemActionRulesTable.active, true)),
  ]);

  const elements: PopPersonConfig["elements"] = {
    atacar: [],
    defender: [],
  };

  for (const item of dbItems) {
    elements[item.mode].push(toPopPersonElement(item));
  }

  const rulesByPair = new Map(
    dbRules.map((rule) => [`${rule.itemId}:${rule.actionLevelId}`, rule]),
  );

  return {
    elements,
    levels: dbLevels.map((level) => {
      if (!level.powerLabel || !level.emoji) {
        throw new Error(`Nível "${level.code}" está com configuração inválida.`);
      }

      return {
        key: level.code,
        label: level.label,
        powerLabel: level.powerLabel,
        emoji: level.emoji,
        count: level.projectileCount,
        startDelayMs: level.startDelayMs,
        staggerMs: level.staggerMs,
        duration: level.durationMs,
        growthPerHit: toNumber(level.growthPerHit),
        impactMultiplier: toNumber(level.impactMultiplier, 1),
        shake: level.shake,
      };
    }),
    actionRules: dbItems.flatMap((item) =>
      dbLevels.map((level) => {
        const values = calculateActionValues(
          item,
          level,
          rulesByPair.get(`${item.id}:${level.id}`),
        );
        return {
          elementId: item.code,
          level: level.code,
          count: values.count,
          startDelayMs: values.startDelayMs,
          staggerMs: values.staggerMs,
          duration: values.durationMs,
          growthPerHit: values.growthPerHit,
          impactMultiplier: values.impactMultiplier,
          price: values.price,
          shake: values.shake,
        };
      }),
    ),
  };
}

export async function getPopPersonBootstrap(
  sessionId?: string,
): Promise<PopPersonBootstrap> {
  const roomId = await getRoomId();
  await ensureRoomMembership(roomId, sessionId);
  const [config, state] = await Promise.all([
    getPopPersonConfig(),
    currentState(roomId),
  ]);
  return { config, state };
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
    startDelayMs: number;
    projectileCount: number;
    staggerMs: number;
    durationMs: number;
    growthPerHit: string;
    impactMultiplier: string;
    shake: boolean;
  },
  rule: {
    startDelayMs: number | null;
    projectileCount: number | null;
    staggerMs: number | null;
    durationMs: number | null;
    growthPerHit: string | null;
    impactMultiplier: string | null;
    priceOverride: string | null;
  } | undefined,
) {
  const startDelayMs = rule?.startDelayMs ?? level.startDelayMs;
  const count = rule?.projectileCount ?? level.projectileCount;
  const staggerMs = rule?.staggerMs ?? level.staggerMs;
  const durationMs = rule?.durationMs ?? level.durationMs;
  const growthPerHit =
    toNumber(rule?.growthPerHit ?? level.growthPerHit) *
    (toNumber(item.impactPower) / 5) *
    toNumber(rule?.impactMultiplier ?? level.impactMultiplier, 1);
  const impactMultiplier = toNumber(
    rule?.impactMultiplier ?? level.impactMultiplier,
    1,
  );
  // Item price is the unit price. The server derives the total from the
  // selected intensity's projectile count, while a rule override can define
  // an explicit total for a specific item/level pair.
  const price = rule?.priceOverride !== null && rule?.priceOverride !== undefined
    ? toNumber(rule.priceOverride)
    : toNumber(item.price) * count;
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
    const scheduledFor = new Date(now.getTime() + values.startDelayMs);
    const completesAt = new Date(
      scheduledFor.getTime() +
        (values.count - 1) * values.staggerMs +
        values.durationMs,
    );
    const ruleSnapshot = {
      startDelayMs: values.startDelayMs,
      count: values.count,
      staggerMs: values.staggerMs,
      durationMs: values.durationMs,
      growthPerHit: values.growthPerHit,
      impactMultiplier: values.impactMultiplier,
      shake: values.shake,
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
        startDelayMs: values.startDelayMs,
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
    const [queuedRoom] = await tx
      .update(roomsTable)
      .set({
        stateVersion: sql`${roomsTable.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(roomsTable.id, roomId))
      .returning({ stateVersion: roomsTable.stateVersion });
    await enqueueRealtimeNotification(tx, {
      type: "action:queued",
      roomId,
      actionId: action.id,
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

async function processDueActions(): Promise<void> {
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
          itemId: actionsTable.itemId,
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
}