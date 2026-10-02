"use client";

import { useEffect, useRef, useState } from "react";

import {
  BUG_DELAY_MS,
  BUG_SPAWN_INTERVAL_MS,
  createBug,
  type LandingBug,
} from "@/lib/bug-invasion";

/**
 * A minute into the landing page, bugs crawl out: one more every 2 seconds,
 * each at a random spot and tilt. Hovering one tells you what it is.
 */
export function BugInvasion() {
  const [bugs, setBugs] = useState<LandingBug[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let spawn: ReturnType<typeof setInterval> | undefined;
    const invasion = setTimeout(() => {
      spawn = setInterval(() => {
        setBugs((prev) => [...prev, createBug(nextId.current++)]);
      }, BUG_SPAWN_INTERVAL_MS);
    }, BUG_DELAY_MS);

    return () => {
      clearTimeout(invasion);
      if (spawn) clearInterval(spawn);
    };
  }, []);

  if (bugs.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100]">
      {bugs.map((bug) => (
        <div
          key={bug.id}
          className="group pointer-events-auto absolute"
          style={{
            left: `${bug.x}%`,
            top: `${bug.y}%`,
            transform: `rotate(${bug.angle}deg)`,
          }}
        >
          <img
            src="/bug.png"
            alt=""
            title="THIS IS A BUG!!"
            draggable={false}
            className="size-16"
          />
          <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100">
            THIS IS A BUG!!
          </span>
        </div>
      ))}
    </div>
  );
}
