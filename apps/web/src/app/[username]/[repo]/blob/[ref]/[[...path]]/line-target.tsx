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

/** `:target` follows only the navigations the browser makes itself. Next's router moves the hash with pushState, and React reuses rows between files, so the highlighted line is a style rule rendered from the hash rather than a pseudo-class or an attribute set by hand. */
export function LineTarget() {
  // read again on every navigation, which pushState alone would not announce
  const pathname = usePathname();
  const hash = useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => "",
  );
  // only a line id reaches the style rule, so the hash cannot inject CSS
  const line = /^#L\d+$/.test(hash) ? hash.slice(1) : null;

  // streamed rows arrive after the browser's own jump to the fragment, and a move to another file can land before its rows render
  useEffect(() => {
    if (line) document.getElementById(line)?.scrollIntoView();
  }, [pathname, line]);

  return line ? (
    <style>{`#${line} { background-color: color-mix(in oklab, var(--color-primary) 10%, transparent); }`}</style>
  ) : null;
}
