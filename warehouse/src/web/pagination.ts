/**
 * Какие номера страниц показывать в навигации.
 *
 * Отдельным модулем без React: 3184 клиента дают 64 страницы, правило их
 * сворачивания стоит проверять тестом, а не глазами на экране.
 */

/**
 * Первые семь страниц, затем многоточие и последняя — как в исходном
 * приложении. `null` означает многоточие.
 */
export function visiblePages(page: number, pages: number): (number | null)[] {
  if (pages <= 8) return Array.from({ length: pages }, (_, i) => i + 1);

  const head = Array.from({ length: 7 }, (_, i) => i + 1);
  // Текущая страница не должна пропасть из списка, если она в свёрнутой середине.
  if (page <= 7) return [...head, null, pages];
  if (page >= pages) return [...head, null, pages];
  return [...head, null, page, null, pages];
}
