export type Translate = (key: string) => string;

/**
 * "1 module" / "{count} modules": the singular has its own key because not every
 * language pluralizes by adding a letter. It used to live inside the course hub; the
 * builder repeated "1 modules, 1 lessons" because it had no access to it.
 */
export function countLabel(t: Translate, oneKey: string, manyKey: string, count: number): string {
  return t(count === 1 ? oneKey : manyKey).replace("{count}", () => String(count));
}
