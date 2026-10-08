"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** `#L10`, `#L10,L11,L59` and `#L10-L59`, mixed freely, as `[first, last]` line ranges; `null` for any other hash. */
export function parseLineTarget(hash: string): [number, number][] | null {
  const match = /^#(L\d+(?:-L\d+)?(?:,L\d+(?:-L\d+)?)*)$/.exec(hash);
  if (!match) return null;
  return match[1].split(",").map((part) => {
    const [a, b = a] = part.split("-").map((line) => Number(line.slice(1)));
    return [Math.min(a, b), Math.max(a, b)];
  });
}

/** `:target` follows only the navigations the browser makes itself. Next's router moves the hash with pushState, and React reuses rows between files, so the highlighted line is a style rule rendered from the hash rather than a pseudo-class or an attribute set by hand. */
export function LineTarget() {
  // read again on every navigation, which pushState alone would not announce
  const pathname = usePathname();
  const hash = useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => "",
  );
  const ranges = parseLineTarget(hash);
  const first = ranges ? `L${ranges[0][0]}` : null;

  // streamed rows arrive after the browser's own jump to the fragment, and a move to another file can land before its rows render
  useEffect(() => {
    if (first) document.getElementById(first)?.scrollIntoView();
  }, [pathname, first]);

  if (!ranges) return null;
  // row n is line n, so a range is one selector however long it runs; only parsed numbers reach the rule, so the hash cannot inject CSS
  const selector = ranges
    .map(([a, b]) => `tr[id^="L"]:nth-child(n+${a}):nth-child(-n+${b})`)
    .join(", ");
  return (
    <style>{`${selector} { background-color: color-mix(in oklab, var(--color-primary) 10%, transparent); }`}</style>
  );
}
