import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../../domain/errors.js';

/** Generous, but far past anything git itself will hold. */
export const MAX_TREE_PATH_LENGTH = 4096;
export const MAX_TREE_PATH_DEPTH = 64;

/**
 * NUL survives percent-decoding and would terminate the argument git actually
 * sees; the other control characters have no business in a URL query.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export class UnsafeTreePathError extends DomainError {
  readonly status = HttpStatus.BAD_REQUEST;

  constructor(reason: string) {
    super(`Invalid repository path: ${reason}`);
  }
}

/**
 * Whether a browser-supplied path is a plain repository-relative directory.
 *
 * Express has already percent-decoded the query value once, so this runs on
 * the real characters - decoding again here would turn `%252e%252e` into `..`
 * and hand back the traversal this is meant to reject.
 */
export function isSafeTreePath(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    normalizeTreePath(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a path to the trailing-slash prefix form a listing uses ("" at the
 * repository root), rejecting anything that is not a literal subdirectory.
 *
 * Nothing here reaches the filesystem - the path becomes a git pathspec, and
 * git resolves it inside the tree object - but a traversal still deserves a
 * 400 rather than an escaping `fatal:` from git, and rejecting the input early
 * keeps the pathspec free of surprises.
 */
export function normalizeTreePath(input: string): string {
  if (input.length > MAX_TREE_PATH_LENGTH) {
    throw new UnsafeTreePathError('too long');
  }
  if (CONTROL_CHARACTERS.test(input)) {
    throw new UnsafeTreePathError('contains control characters');
  }

  const trimmed = input.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';

  const segments = trimmed.split('/');
  if (segments.length > MAX_TREE_PATH_DEPTH) {
    throw new UnsafeTreePathError('too deep');
  }

  for (const segment of segments) {
    // "" is a doubled slash, which git would never have produced itself
    if (!segment) throw new UnsafeTreePathError('contains an empty segment');
    if (segment === '.' || segment === '..') {
      throw new UnsafeTreePathError('contains a relative segment');
    }
  }

  return `${segments.join('/')}/`;
}

/**
 * The file form of {@link normalizeTreePath}: same rejections, no trailing
 * slash, and the root is not a file so an empty path is refused.
 */
export function normalizeBlobPath(input: string): string {
  const prefix = normalizeTreePath(input);
  if (!prefix) throw new UnsafeTreePathError('is empty');
  return prefix.slice(0, -1);
}
