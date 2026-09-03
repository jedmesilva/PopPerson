type LoadOptions = {
  baseUrl: string;
  actionCount: number;
  concurrency: number;
  mode: "atacar" | "defender";
};

type ActionResponse = {
  status: number;
  latencyMs: number;
};

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readMode(): "atacar" | "defender" {
  const index = process.argv.indexOf("--mode");
  const value = index === -1 ? process.env.LOAD_MODE : process.argv[index + 1];
  return value === "defender" ? "defender" : "atacar";
}

function readOptions(): LoadOptions {
  return {
    baseUrl: process.env.LOAD_BASE_URL ?? "http://127.0.0.1:8080",
    actionCount: readNumberFlag("--actions", 20),
    concurrency: Math.max(1, readNumberFlag("--concurrency", 4)),
    mode: readMode(),
  };
}

async function runLoad(options: LoadOptions): Promise<void> {
  const bootstrapResponse = await fetch(`${options.baseUrl}/api/pop-person`);
  if (!bootstrapResponse.ok) {
    throw new Error(`Bootstrap failed with HTTP ${bootstrapResponse.status}`);
  }
  const bootstrap = await bootstrapResponse.json() as {
    config?: {
      elements?: Record<string, Array<{ id?: string }>>;
      levels?: Array<{ key?: string }>;
    };
    state?: {
      dataset?: Array<{ name?: string }>;
    };
  };
  const targetName = bootstrap.state?.dataset?.find((person) => person.name)?.name;
  const elementId = bootstrap.config?.elements?.[options.mode]
    ?.find((element) => element.id)?.id;
  const level = bootstrap.config?.levels?.find((item) => item.key)?.key;
  if (!targetName || !elementId || !level) {
    throw new Error("Bootstrap did not expose an action target, element, and level.");
  }

  const results: ActionResponse[] = [];
  let nextAction = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const actionNumber = nextAction;
      nextAction += 1;
      if (actionNumber >= options.actionCount) return;
      const startedAt = performance.now();
      const response = await fetch(`${options.baseUrl}/api/pop-person/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: options.mode,
          elementId,
          level,
          targetName,
          idempotencyKey: `load-test-${process.pid}-${actionNumber}`,
        }),
      });
      results.push({
        status: response.status,
        latencyMs: performance.now() - startedAt,
      });
      await response.arrayBuffer();
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, Math.max(1, options.actionCount)) },
      () => worker(),
    ),
  );

  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const percentile = (ratio: number) => (
    latencies.length === 0
      ? 0
      : latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * ratio) - 1)]
  );
  const counts = results.reduce<Record<string, number>>((all, result) => {
    all[String(result.status)] = (all[String(result.status)] ?? 0) + 1;
    return all;
  }, {});
  console.log(JSON.stringify({
    requested: options.actionCount,
    completed: results.length,
    statuses: counts,
    latencyMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: latencies.at(-1) ?? 0,
    },
  }, null, 2));
}

runLoad(readOptions()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});