type MetricValue = {
  count: number;
  sum: number;
  max: number;
};

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const timings = new Map<string, MetricValue>();

export function incrementMetric(name: string, value = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + value);
}

export function setMetric(name: string, value: number): void {
  if (Number.isFinite(value)) gauges.set(name, value);
}

export function observeMetric(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const current = timings.get(name) ?? { count: 0, sum: 0, max: 0 };
  current.count += 1;
  current.sum += value;
  current.max = Math.max(current.max, value);
  timings.set(name, current);
}

export function getRuntimeMetrics(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<
    string,
    { count: number; sum: number; max: number; average: number }
  >;
  collectedAt: string;
} {
  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    timings: Object.fromEntries(
      [...timings.entries()].map(([name, value]) => [
        name,
        {
          ...value,
          average: value.count === 0 ? 0 : value.sum / value.count,
        },
      ]),
    ),
    collectedAt: new Date().toISOString(),
  };
}