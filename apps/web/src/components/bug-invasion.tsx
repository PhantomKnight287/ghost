"use client";

import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BUG_DELAY_MS,
  BUG_SPAWN_INTERVAL_MS,
  MAX_BUGS,
  createBug,
  type LandingBug,
} from "@/lib/bug-invasion";

/**
 * A minute into the landing page, bugs crawl out: one more every 2 seconds,
 * each at a random spot and tilt, up to MAX_BUGS. Hovering one tells you
 * what it is.
 */
export function BugInvasion() {
  const [bugs, setBugs] = useState<LandingBug[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let spawn: ReturnType<typeof setInterval> | undefined;
    const invasion = setTimeout(() => {
      spawn = setInterval(() => {
        // nextId counts spawned bugs, so it doubles as the cap counter.
        if (nextId.current >= MAX_BUGS) {
          clearInterval(spawn);
          return;
        }
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
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <TooltipProvider>
        {bugs.map((bug) => (
          <Tooltip key={bug.id}>
            <TooltipTrigger asChild>
              <img
                src="/bug.png"
                alt="Bug"
                draggable={false}
                className="pointer-events-auto absolute size-16"
                style={{
                  left: `${bug.x}%`,
                  top: `${bug.y}%`,
                  transform: `rotate(${bug.angle}deg)`,
                }}
              />
            </TooltipTrigger>
            <TooltipContent>THIS IS A BUG!!</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </div>
  );
}
