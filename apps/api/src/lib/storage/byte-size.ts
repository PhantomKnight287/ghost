const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/** Parses `"1073741824"`, `"1gb"` or `"500 MB"` (binary units) into bytes. Blank means "no limit" and reads as null; anything else unreadable throws, so a typo fails at boot instead of silently lifting a limit. */
export function parseByteSize(value: string | undefined, name: string) {
  const text = value?.trim().toLowerCase();
  if (!text) return null;

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/.exec(text);
  if (!match) throw new Error(`${name} is not a byte size: ${value}`);

  const bytes = Math.floor(Number(match[1]) * UNITS[match[2] ?? 'b']);
  // enough digits overflow to Infinity, or past where a count of bytes is exact
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(`${name} is not a byte size: ${value}`);
  }
  return bytes;
}

/** `1073741824` → `"1 GB"`, for error messages a person reads. */
export function formatByteSize(bytes: number) {
  const [unit, size] = Object.entries(UNITS)
    .reverse()
    .find(([, size]) => bytes >= size) ?? ['b', 1];
  const value = bytes / size;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit.toUpperCase()}`;
}
