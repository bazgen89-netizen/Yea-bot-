import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * У каждого экрана телефона есть название.
 *
 * Без него телефон пишет в шапке имя файла. Так и было: «money/index»
 * вместо «Движение денег», «registers» вместо «Кассы» — на четырнадцати
 * экранах, нашлось обходом телефонного «Меню». Название задаётся либо в
 * `app/_layout.tsx`, либо в самом экране через `<Stack.Screen options>`.
 */
const КОРЕНЬ = join(__dirname, '../../../app');

function экраны(папка: string): string[] {
  return readdirSync(папка).flatMap((имя) => {
    const путь = join(папка, имя);
    if (statSync(путь).isDirectory()) return экраны(путь);
    return имя.endsWith('.tsx') ? [путь] : [];
  });
}

describe('названия экранов на телефоне', () => {
  const раскладка = readFileSync(join(КОРЕНЬ, '_layout.tsx'), 'utf8');

  const все = экраны(КОРЕНЬ)
    .map((путь) => relative(КОРЕНЬ, путь).replace(/\.tsx$/, ''))
    // Служебные: раскладки, вкладки со своей шапкой, страница «не найдено».
    .filter((имя) => !/(^|\/)_layout$/.test(имя) && !имя.startsWith('(tabs)') && имя !== '+not-found');

  it.each(все)('%s — с названием', (имя) => {
    const вРаскладке = раскладка.includes(`name="${имя}"`);
    const вСебе = /Stack\.Screen|title:/.test(readFileSync(join(КОРЕНЬ, `${имя}.tsx`), 'utf8'));
    expect(вРаскладке || вСебе).toBe(true);
  });
});
