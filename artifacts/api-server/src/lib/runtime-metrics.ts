type MetricValue = {
  count: number;
  sum: number;
  max: number;
  samples: number[];
};

const MAX_TIMING_SAMPLES = 4096;
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
  const current = timings.get(name) ?? {
    count: 0,
    sum: 0,
    max: 0,
    samples: [],
  };
  current.count += 1;
  current.sum += value;
  current.max = Math.max(current.max, value);
  if (current.samples.length < MAX_TIMING_SAMPLES) {
    current.samples.push(value);
  } else {
    current.samples[(current.count - 1) % MAX_TIMING_SAMPLES] = value;
  }
  timings.set(name, current);
}

function percentile(samples: number[], ratio: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function getRuntimeMetrics(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<
    string,
    {
      count: number;
      sum: number;
      max: number;
      average: number;
      p95: number;
      p99: number;
    }
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
          count: value.count,
          sum: value.sum,
          max: value.max,
          average: value.count === 0 ? 0 : value.sum / value.count,
          p95: percentile(value.samples, 0.95),
          p99: percentile(value.samples, 0.99),
        },
      ]),
    ),
    collectedAt: new Date().toISOString(),
  };
}