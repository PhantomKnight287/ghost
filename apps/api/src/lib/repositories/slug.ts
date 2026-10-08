import { customAlphabet } from 'nanoid';
import slugify from 'slugify';

const slugAlphabet = customAlphabet(
  '_-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  10,
);

export function titleToSlug(title: string) {
  const slugified = slugify(title, { lower: true });
  const slugifiedWithSuffix = `${slugified}-${slugAlphabet()}`;
  return {
    slugified,
    slugifiedWithSuffix,
  };
}
