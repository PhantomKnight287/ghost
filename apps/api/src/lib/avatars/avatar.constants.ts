/**
 * Content types accepted for an avatar upload, mapped to the stored extension.
 *
 * No WebP: avatars are drawn into the OG images and `next/og` cannot decode it.
 */
export const AVATAR_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
} as const;

export type AvatarContentType = keyof typeof AVATAR_CONTENT_TYPES;

/** Upload ceiling. The client resizes to a 256px square before sending, so this is generous - it only exists so an unresized original cannot fill the bucket. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Bucket prefix every avatar object lives under. */
export const AVATAR_PREFIX = 'avatars';

/** Object names this service generates: `<nanoid>.<extension>`. */
export const AVATAR_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}\.(png|jpg)$/;
