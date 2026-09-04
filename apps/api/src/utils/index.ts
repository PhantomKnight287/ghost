import { customAlphabet } from 'nanoid'
import slugify from 'slugify'

const slugAlphabet = customAlphabet('_-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10)


export function titleToSlug(title: string) {
  const slugified = slugify(title, { lower: true })
  const slugifiedWithSuffix = `${slugified}-${slugAlphabet()}`
  return {
    slugified,
    slugifiedWithSuffix,
  }
}

// Opaque keyset cursor: a (timestamp, id) pair, base64url encoded so callers
// treat it as a token instead of something they can hand-build.
export function encodeCursor({ date, id }: { date: Date; id: string }) {
  return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url')
}

export function decodeCursor(cursor: string) {
  const [timestamp, id] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|')
  if (!timestamp || !id) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return { date, id }
}
