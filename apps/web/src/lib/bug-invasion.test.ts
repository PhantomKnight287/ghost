import { describe, expect, it } from "bun:test";

import { createBug } from "./bug-invasion";

describe("createBug", () => {
  it("keeps the bug on-screen with a tilt in range", () => {
    const bug = createBug(7, () => 0.5);
    expect(bug).toEqual({ id: 7, x: 45, y: 42.5, angle: 180 });
  });

  it("stays within the viewport at the extremes", () => {
    const low = createBug(0, () => 0);
    expect(low.x).toBeGreaterThanOrEqual(0);
    expect(low.y).toBeGreaterThanOrEqual(0);
    expect(low.angle).toBeGreaterThanOrEqual(0);

    const high = createBug(1, () => 0.9999);
    expect(high.x).toBeLessThanOrEqual(90);
    expect(high.y).toBeLessThanOrEqual(85);
    expect(high.angle).toBeLessThan(360);
  });
});
