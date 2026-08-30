export type PopPersonTimeline = {
  executeAt: number;
  duration: number;
  staggerMs: number;
  count: number;
};

export function hitAtForIndex(timeline: PopPersonTimeline, hitIndex: number): number {
  const normalizedIndex = Math.max(1, Math.floor(hitIndex));
  return timeline.executeAt
    + Math.max(0, timeline.duration)
    + (normalizedIndex - 1) * Math.max(0, timeline.staggerMs);
}

export function projectileStartAtForIndex(
  timeline: PopPersonTimeline,
  hitIndex: number,
): number {
  return hitAtForIndex(timeline, hitIndex) - Math.max(0, timeline.duration);
}

export function dueHitCountAt(timeline: PopPersonTimeline, now: number): number {
  const count = Math.max(0, Math.floor(timeline.count));
  if (count === 0) return 0;

  const firstHitAt = hitAtForIndex(timeline, 1);
  if (now < firstHitAt) return 0;

  const interval = Math.max(1, timeline.staggerMs);
  return Math.min(count, Math.floor((now - firstHitAt) / interval) + 1);
}

export function isTimelineComplete(
  timeline: PopPersonTimeline,
  recordedHitCount: number,
  now: number,
): boolean {
  const count = Math.max(0, Math.floor(timeline.count));
  return Math.max(0, Math.floor(recordedHitCount)) >= count
    && dueHitCountAt(timeline, now) >= count
    && now >= hitAtForIndex(timeline, timeline.count);
}