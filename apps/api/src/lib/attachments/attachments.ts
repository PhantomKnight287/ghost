import { extname } from 'node:path';

/** Where an attachment's bytes live, or the prefix holding all of a repository's. */
export function attachmentKey(repositoryId: string, attachmentId?: string) {
  return `attachments/${repositoryId}/${attachmentId ?? ''}`;
}

export const ATTACHMENT_MAX_BYTES = 25 * 1024 ** 2;

/** What may be attached, by extension. The type a file is served with comes from here, never from the uploader. SVG is left out: it can carry script. */
const ATTACHMENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.patch': 'text/x-diff',
  '.diff': 'text/x-diff',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
};

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);

/** The media type `name` is served as, or undefined when its extension may not be attached. */
export function attachmentTypeOf(name: string) {
  return ATTACHMENT_TYPES[extname(name).toLowerCase()];
}

/** Images open in the browser, so an embedded one can be clicked through; anything else downloads. */
export function isInlineAttachment(contentType: string) {
  return contentType.startsWith('image/');
}
