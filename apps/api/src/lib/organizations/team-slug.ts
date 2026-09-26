import slugify from 'slugify';

/** A team's name as it appears in URLs and `@org/team` mentions. Teams have no stored slug, so renaming a team moves its URL. */
export function teamSlug(name: string) {
  return slugify(name, { lower: true, strict: true });
}
