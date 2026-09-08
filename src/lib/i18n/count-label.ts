export type Translate = (key: string) => string;

/**
 * "1 module" / "{count} modules": o singular tem chave propria porque nem todo
 * idioma pluraliza acrescentando uma letra. Vivia dentro do hub do curso; o
 * builder repetia "1 modules, 1 lessons" por nao ter acesso a ele.
 */
export function countLabel(t: Translate, oneKey: string, manyKey: string, count: number): string {
  return t(count === 1 ? oneKey : manyKey).replace("{count}", () => String(count));
}
