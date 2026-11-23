import { other, type Side } from "../side.ts";
import type { SyncedFields } from "../store.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const isDiffer = (base: unknown): base is { differ: Record<Side, unknown> } => typeof base === "object" && base !== null && !Array.isArray(base) && "differ" in base;
/** Whether `side`'s `value` is still what was agreed: its own value, for twins agreed to differ. */
const unchanged = (value: unknown, base: unknown, side: Side) => (isDiffer(base) ? same(base.differ[side], value) : same(value, base));

/** Whether `side` still holds the value it had when twins were paired agreeing to differ on `key`; false for any field both sides agreed on. */
export function keptApartSince(base: SyncedFields | null, key: string, side: Side, value: unknown) {
  return base !== null && isDiffer(base[key]) && same(base[key].differ[side], value);
}

/** The agreed state of two items paired as they stand, such as twin issues a person opened on both sides: equal fields agree, and differing ones are agreed to differ, each side keeping its own value, so pairing writes nothing until a person changes one side. */
export function pairedFields(fields: Record<Side, SyncedFields>): SyncedFields {
  return Object.fromEntries(
    Object.entries(fields.ghost).map(([key, value]) => [key, same(value, fields.github[key]) ? value : { differ: { ghost: value, github: fields.github[key] ?? null } }]),
  ) as SyncedFields;
}

/** Whether `source` changed at or after `target`; an item without a timestamp counts as newer, so it is never silently dropped. */
export function isNewer(source: { updated_at?: string }, target: { updated_at?: string }) {
  if (!source.updated_at || !target.updated_at) return true;
  return Date.parse(source.updated_at) >= Date.parse(target.updated_at);
}

/** The fields to copy from `source` and the agreed state to save after. A field moves only when it changed since `base` on the source alone, so one side's pass never undoes the other side's uncopied change; on both sides, or with no `base`, the newer side wins. */
export function mergeFields(from: Side, source: SyncedFields, target: SyncedFields, base: SyncedFields | null, sourceIsNewer: boolean) {
  const write: SyncedFields = {};
  const agreed: SyncedFields = { ...base };
  for (const [key, value] of Object.entries(source)) {
    if (same(value, target[key])) {
      agreed[key] = value;
      continue;
    }
    const sourceMoved = !base || !unchanged(value, base[key], from);
    const targetMoved = !base || !unchanged(target[key], base[key], other(from));
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
