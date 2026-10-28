import slugify from 'slugify';

export function appSlug(name: string): string {
  return slugify(name, {
    replacement: '-',
    lower: true,
    strict: true,
    trim: true,
    remove: /[^\x00-\x7F]/g,
  });
}
