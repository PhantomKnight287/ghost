import type { SyncedFields } from "../store.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether `source` changed at or after `target`; an item without a timestamp counts as newer, so it is never silently dropped. */
export function isNewer(source: { updated_at?: string }, target: { updated_at?: string }) {
  if (!source.updated_at || !target.updated_at) return true;
  return Date.parse(source.updated_at) >= Date.parse(target.updated_at);
}

/** The fields to copy from `source` and the agreed state to save after. A field moves only when it changed since `base` on the source alone, so one side's pass never undoes the other side's uncopied change; on both sides, or with no `base`, the newer side wins. */
export function mergeFields(source: SyncedFields, target: SyncedFields, base: SyncedFields | null, sourceIsNewer: boolean) {
  const write: SyncedFields = {};
  const agreed: SyncedFields = { ...base };
  for (const [key, value] of Object.entries(source)) {
    if (same(value, target[key])) {
      agreed[key] = value;
      continue;
    }
    const sourceMoved = !base || !same(value, base[key]);
    const targetMoved = !base || !same(target[key], base[key]);
    if (sourceMoved && (!targetMoved || sourceIsNewer)) {
      write[key] = value;
      agreed[key] = value;
    }
  }
  return { write, agreed };
}

/** One activity line per field written to `what`, such as "Closed GitHub issue #2". */
export function describeChanges(write: SyncedFields, what: string) {
  return Object.entries(write).map(([key, value]) => {
    switch (key) {
      case "state":
        return value === "closed" ? `Closed ${what}` : `Reopened ${what}`;
      case "title":
        return `Retitled ${what} to "${value}"`;
      case "body":
        return `Edited the description of ${what}`;
      case "labels":
        return Array.isArray(value) && value.length > 0 ? `Set the labels of ${what} to ${value.join(", ")}` : `Removed the labels of ${what}`;
      case "draft":
        return value ? `Marked ${what} as a draft` : `Marked ${what} ready for review`;
      case "base":
        return `Changed the base branch of ${what} to ${value}`;
      default:
        return `Updated ${key} of ${what}`;
    }
  });
}
