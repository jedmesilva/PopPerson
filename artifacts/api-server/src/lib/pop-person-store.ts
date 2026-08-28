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

const PROCESS_INTERVAL_MS = 500;
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
        status: peopleTable.status,
        cidade: locationsTable.city,
        estado: locationsTable.stateCode,
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
      cidade: person.cidade ?? "",
      estado: person.estado ?? "",
      estadoCodigo: person.estadoCodigo ?? "",
      pais: person.pais ?? "",
      paisCodigo: person.paisCodigo ?? "",
      status: person.status,
      value: toNumber(person.value),
      color: person.color,
    };
  });
}

type PopPersonElement = PopPersonConfig["elements"]["atacar"][number];

function toPopPersonElement(item: {
  code: string;
  name: string;
  emoji: string | null;
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
    label: item.name,
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
      elementGender: itemsTable.gender,
      elementForce: itemsTable.impactPower,
      elementPrice: itemsTable.price,
      level: actionLevelsTable.code,
      targetName: peopleTable.name,
      status: actionsTable.status,
      actionStartDelayMs: actionsTable.startDelayMs,
      executeAt: actionsTable.scheduledFor,
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

  return rows.map((action) => {
    const element = toPopPersonElement({
      code: action.elementId,
      name: action.elementName,
      emoji: action.elementEmoji,
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

    return {
      id: action.id,
      mode: action.mode,
      elementId: action.elementId,
      level: action.level,
      targetName: action.targetName,
      status: toActionStatus(action.status),
      startDelayMs,
      executeAt: action.executeAt.getTime(),
      completedAt: action.completedAt?.getTime() ?? null,
      count,
      growthPerHit,
      impactMultiplier,
      staggerMs,
      duration,
      shake: snapshotBoolean(action.ruleSnapshot, "shake", action.levelShake),
      element,
    };
  });
}

async function currentState(roomId: string): Promise<PopPersonState> {
  const [dataset, actions] = await Promise.all([
    getDataset(roomId),
    getActions(roomId),
  ]);
  return { dataset, actions };
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
  const price = toNumber(rule?.priceOverride ?? item.price);
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
    await tx
      .update(roomsTable)
      .set({
        stateVersion: sql`${roomsTable.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(roomsTable.id, roomId));
    return { action, created: true };
  });

  const [response] = await getActions(roomId, result.action.id);
  if (!response) throw new Error("Ação criada, mas não pôde ser carregada.");
  if (result.created) await notifyStateChange();
  return response;
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