/**
 * Types a browser may render in place. Everything else downloads: serving
 * user-controlled bytes inline is an XSS vector, and SVG is the reason this is
 * an allowlist rather than a blocklist.
 */
const INLINE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
};

export function mediaTypeFor(filename: string) {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const type = INLINE_TYPES[extension];

  return {
    type: type ?? 'application/octet-stream',
    inline: type !== undefined,
  };
}
