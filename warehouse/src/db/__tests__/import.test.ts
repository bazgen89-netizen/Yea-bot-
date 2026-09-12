import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { listCounterparties } from '../counterparties';
import { importParties, importProducts } from '../import';
import { getProduct, listProducts, productCategories } from '../products';
import { getStock } from '../stock';
import { detectDelimiter, parseCsv, parseTable } from '../../domain/csv';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

describe('разбор файла', () => {
  it('узнаёт разделитель сам', () => {
    expect(detectDelimiter('Наименование;Цена\nЧай;100')).toBe(';');
    expect(detectDelimiter('Наименование,Цена\nЧай,100')).toBe(',');
  });

  it('не считает разделителем то, что внутри кавычек', () => {
    // У Excel в русской локали разделитель — точка с запятой, а запятая
    // спокойно живёт внутри названия.
    expect(detectDelimiter('"Чай, зелёный";Цена\nа;1')).toBe(';');
  });

  it('держит перенос строки и кавычки внутри поля', () => {
    const rows = parseCsv('a;b\n"первая\nвторая";"Чай ""Особый"""');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('первая\nвторая');
    expect(rows[1][1]).toBe('Чай "Особый"');
  });

  it('снимает BOM, который ставит Excel', () => {
    const rows = parseTable('﻿Наименование;Цена\nЧай;100');
    expect(rows[0]['наименование']).toBe('Чай');
  });

  it('заголовки сравниваются без учёта регистра и лишних пробелов', () => {
    const rows = parseTable('  ЦЕНА  ПРОДАЖИ ;Наименование\n100;Чай');
    expect(rows[0]['цена продажи']).toBe('100');
  });
});

describe('загрузка товаров', () => {
  it('заводит товары с ценами, единицей и категорией', () => {
    const result = importProducts(
      db,
      'Наименование;Артикул;Ед. изм.;Цена продажи;Цена закупки;Категория\n' +
        'Шу пуэр;SH-01;кг;5000,00;2000,00;Пуэр\n' +
        'Улун;UL-02;гр;30,00;12,00;Улунский чай\n',
    );

    expect(result.added).toBe(2);
    expect(result.problems).toEqual([]);

    const products = listProducts(db);
    const tea = products.find((p) => p.name === 'Шу пуэр')!;
    expect(tea.sale_price).toBe(500000);
    expect(tea.purchase_price).toBe(200000);
    expect(tea.unit).toBe('кг');
    expect(tea.category_name).toBe('Пуэр');
  });

  it('повторная загрузка того же файла не плодит дубли', () => {
    const csv = 'Наименование;Штрих-код;Цена продажи\nЧай;4600000000001;100,00\n';

    importProducts(db, csv);
    const second = importProducts(db, csv);

    expect(second.added).toBe(0);
    expect(second.updated).toBe(1);
    expect(listProducts(db)).toHaveLength(1);
  });

  it('находит товар по штрихкоду, даже если название изменилось', () => {
    importProducts(db, 'Наименование;Штрих-код;Цена продажи\nЧай;4600000000001;100,00\n');
    importProducts(db, 'Наименование;Штрих-код;Цена продажи\nЧай зелёный;4600000000001;120,00\n');

    const products = listProducts(db);
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Чай зелёный');
    expect(products[0].sale_price).toBe(12000);
  });

  it('остатки заводятся одним документом, а не по одному на товар', () => {
    importProducts(
      db,
      'Наименование;Остаток\nЧай;5\nКофе;3\n',
    );

    const products = listProducts(db);
    expect(getStock(db, products.find((p) => p.name === 'Чай')!.id)).toBe(5000);
    expect(getStock(db, products.find((p) => p.name === 'Кофе')!.id)).toBe(3000);

    // Один документ загрузки на весь файл.
    const docs = db.all<{ n: number }>('SELECT COUNT(*) AS n FROM docs');
    expect(docs[0].n).toBe(1);
  });

  it('вид позиции читается из файла', () => {
    importProducts(db, 'Наименование;Вид\nСтрижка;услуга\nНабор;комплект\nЧай;товар\n');

    const products = listProducts(db);
    expect(products.find((p) => p.name === 'Стрижка')!.kind).toBe('service');
    expect(products.find((p) => p.name === 'Набор')!.kind).toBe('set');
    expect(products.find((p) => p.name === 'Чай')!.kind).toBe('product');
  });

  it('строка без наименования пропускается с объяснением', () => {
    const result = importProducts(db, 'Наименование;Цена продажи\n;100,00\nЧай;50,00\n');

    expect(result.added).toBe(1);
    expect(result.problems).toEqual([{ line: 2, reason: 'нет наименования' }]);
  });

  it('нечисловая цена не роняет весь файл', () => {
    const result = importProducts(
      db,
      'Наименование;Цена продажи\nЧай;дорого\nКофе;100,00\n',
    );

    expect(result.added).toBe(1);
    expect(result.problems[0].line).toBe(2);
    expect(listProducts(db).map((p) => p.name)).toEqual(['Кофе']);
  });

  it('пустой файл — это ноль строк, а не исключение', () => {
    expect(importProducts(db, '')).toEqual({ added: 0, updated: 0, problems: [] });
  });

  it('лишние колонки не мешают', () => {
    const result = importProducts(
      db,
      'Неизвестно;Наименование;Ещё что-то;Цена продажи\nхлам;Чай;хлам;100,00\n',
    );

    expect(result.added).toBe(1);
    expect(getProduct(db, listProducts(db)[0].id)!.sale_price).toBe(10000);
  });
});

describe('загрузка клиентов', () => {
  it('заводит клиентов с телефоном и днём рождения', () => {
    const result = importParties(
      db,
      'Наименование;Телефон;День рождения;Пол\n' +
        'Анна;+7 (999) 123-45-67;13/07/2006;Женский\n',
    );

    expect(result.added).toBe(1);

    const anna = listCounterparties(db, { kind: 'customer' })[0];
    expect(anna.name).toBe('Анна');
    expect(anna.birthday).toBe('13/07/2006');
    expect(anna.gender).toBe('Женский');
  });

  it('один и тот же номер в разной записи — один человек', () => {
    importParties(db, 'Наименование;Телефон\nАнна;+7 (999) 123-45-67\n');
    const second = importParties(db, 'Наименование;Телефон\nАнна Иванова;89991234567\n');

    expect(second.added).toBe(0);
    expect(listCounterparties(db, { kind: 'customer' })).toHaveLength(1);
  });

  it('поставщики грузятся тем же файлом в свой список', () => {
    importParties(db, 'Наименование;Телефон\nЧайный дом;+79990000000\n', 'supplier');

    expect(listCounterparties(db, { kind: 'supplier' })).toHaveLength(1);
    expect(listCounterparties(db, { kind: 'customer' })).toHaveLength(0);
  });
});

describe('категории в файле', () => {
  it('несколько категорий через запятую попадают все, а в карточку — первая', () => {
    importProducts(
      db,
      'Наименование;Категории;Цена продажи\nШу пуэр;Пуэр, Подарочное;500,00\n',
    );

    const tea = listProducts(db).find((item) => item.name === 'Шу пуэр')!;
    expect(productCategories(db, tea.id).sort()).toEqual(['Подарочное', 'Пуэр']);
    expect(tea.category_name).toBe('Пуэр');
  });
});
