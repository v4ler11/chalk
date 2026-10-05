import { useSyncExternalStore } from "react";
import { getRuns, subscribe, type RunEntry } from "./runs";

/**
 * The runs as they stand, re-rendering the window whenever Rust says one of
 * them changed. The store is module-level, so every reader sees the same runs,
 * and the snapshot is replaced whole so React can compare it by identity.
 */
export function useRuns(): ReadonlyMap<number, RunEntry> {
  return useSyncExternalStore(subscribe, getRuns, getRuns);
}
