/** Linger time before the first bug crawls out on the landing page. */
export const BUG_DELAY_MS = 60_000;

/** One more bug joins every interval while the visitor stays. */
export const BUG_SPAWN_INTERVAL_MS = 2_000;

export interface LandingBug {
  id: number;
  /** Viewport percentages, so a resize never strands a bug off-screen. */
  x: number;
  y: number;
  /** Tilt in degrees. */
  angle: number;
}

/** A bug at a random spot and tilt, kept away from the far edges. */
export function createBug(
  id: number,
  random: () => number = Math.random,
): LandingBug {
  return {
    id,
    x: random() * 90,
    y: random() * 85,
    angle: Math.floor(random() * 360),
  };
}
