"use client";

import { useSyncExternalStore } from "react";

/** Returns `true` once the component is mounted on the client (hydrated) and `false` while rendering on the server, so client-only reads (e.g. `sessionStorage`) stay safe during SSR. */
export function useIsHydrated() {
  const subscribe = () => () => {};
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
