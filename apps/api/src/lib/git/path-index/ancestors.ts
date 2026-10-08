/** "src/a/b.ts" -> ["src/a/b.ts", "src/a", "src", ""] */
export function ancestorsOf(path: string) {
  const segments = path.split('/');
  const paths: string[] = [];
  for (let i = segments.length; i > 0; i--) {
    paths.push(segments.slice(0, i).join('/'));
  }
  paths.push('');
  return paths;
}
