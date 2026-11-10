/**
 * Is `path` an establishment detail address of this slug —
 * `/{city}/{category}/{slug}`, plain segments only? Server actions that drop a
 * cached detail page (revalidatePath) check this first, so a request cannot
 * point them at an arbitrary route.
 */
const PATH_SEGMENT = /^[a-z0-9-]+$/i;

/**
 * Is `path` an establishment detail address of any card —
 * `/{city}/{category}/{slug}`, plain segments only? For the actions that know
 * the card by its id, not its slug (the review actions).
 */
export function isDetailPath(path: string): boolean {
  const parts = path.split('/');
  return isDetailPathOf(path, parts[3] ?? '');
}

export function isDetailPathOf(path: string, slug: string): boolean {
  const parts = path.split('/');
  return (
    parts.length === 4 &&
    parts[0] === '' &&
    parts[3] === slug &&
    parts.slice(1).every((part) => PATH_SEGMENT.test(part))
  );
}
