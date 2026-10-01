// Under the API's 2 MB body limit with room for the envelope; a single item larger than this travels alone.
const MAX_CHUNK_BYTES = 1_000_000;

/** Splits `items` so each chunk's JSON stays under `maxBytes`. Order is kept. */
export function chunkBySize<T>(items: T[], maxBytes = MAX_CHUNK_BYTES): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (current.length && size + itemSize > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
