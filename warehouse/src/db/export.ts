import { listCounterparties } from './counterparties';
import type { SqlDriver } from './driver';
import { listProducts } from './products';
import { formatMoney } from '../domain/money';
import { formatQty } from '../domain/qty';
import type { PartyKind } from '../domain/types';

/**
 * Экранирование по RFC 4180: поле в кавычках, внутренние кавычки удваиваются.
 * Без этого название товара с запятой разъедет таблицу.
 */
function csvCell(value: string | number | null): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function toCsv(rows: (string | number | null)[][]): string {
  // BOM — иначе Excel открывает кириллицу как «ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ».
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/** Выгрузка остатков: то, что чаще всего нужно отправить бухгалтеру или поставщику. */
export function stockCsv(db: SqlDriver): string {
  const products = listProducts(db, { includeArchived: false });

  const rows: (string | number | null)[][] = [
    [
      'Название',
      'Категория',
      'Артикул',
      'Штрихкод',
      'Единица',
      'Остаток',
      'Закупочная цена',
      'Цена продажи',
      'Стоимость остатка',
    ],
  ];

  for (const p of products) {
    rows.push([
      p.name,
      p.category_name,
      p.sku,
      p.barcode,
      p.unit,
      formatQty(p.stock),
      formatMoney(p.cost_price),
      formatMoney(p.sale_price),
      formatMoney(Math.round((p.stock * p.cost_price) / 1000)),
    ]);
  }

  return toCsv(rows);
}

/**
 * Клиенты (или поставщики) со всем, что есть в карточке.
 *
 * Выгрузка сделана так, чтобы её можно было **загрузить обратно**: заголовки
 * колонок — те же слова, по которым импорт узнаёт поля. Это не мелочь. Так
 * базу правят там, где это быстрее всего, — в таблице: выгрузил, проставил
 * пять сотен дней рождения разом, загрузил обратно. Совпадение по телефону
 * не даст завести людей заново.
 *
 * Проценты и деньги выводятся так же, как показываются на экране: человек
 * потом смотрит в этот файл глазами, а не только машиной.
 */
export function partiesCsv(db: SqlDriver, kind: PartyKind): string {
  const parties = listCounterparties(db, { kind, includeArchived: false });

  const rows: (string | number | null)[][] = [
    [
      'Наименование',
      'Телефон',
      'Другие телефоны',
      'Почта',
      'День рождения',
      'Пол',
      'Адрес',
      'Комментарий',
      'Скидка',
      'Дисконтная карта',
      'Вид лояльности',
      'Бонусы',
      'Потрачено бонусов',
      'Кешбэк',
      'Кто создал',
      'Дата создания',
      'Покупок на сумму',
      'Чеков',
      'Последняя покупка',
    ],
  ];

  for (const party of parties) {
    // Первый телефон уже стоит своей колонкой — в «других» он был бы
    // повтором, а после обратной загрузки превратился бы в дубль.
    const rest = phoneList(party.phones).filter((phone) => phone !== party.phone);

    rows.push([
      party.name,
      party.phone,
      rest.join(', '),
      party.email,
      party.birthday,
      party.gender,
      party.address,
      party.note,
      percent(party.discount_bp),
      party.discount_card,
      party.loyalty_type,
      formatMoney(party.bonus_balance),
      formatMoney(party.bonus_spent),
      percent(party.cashback_bp),
      party.created_by,
      day(party.created_at),
      formatMoney(party.purchases),
      party.receipts,
      day(party.last_sale_at),
    ]);
  }

  return toCsv(rows);
}

/**
 * Каталог целиком — все поля карточки, а не только остатки и цены.
 *
 * «Остатки и цены» отправляют бухгалтеру, а эта выгрузка нужна для другого:
 * поправить каталог таблицей и залить обратно. Поэтому здесь стоят и код, и
 * штрихкод, и PLU, и описание, и вес с размерами — всё, что импорт умеет
 * прочитать.
 */
export function catalogCsv(db: SqlDriver): string {
  const products = listProducts(db, { includeArchived: false });

  const rows: (string | number | null)[][] = [
    [
      'Наименование',
      'Код',
      'Артикул',
      'Штрихкод',
      'Код весов',
      'Категория',
      'Единица',
      'Закупочная цена',
      'Цена продажи',
      'Скидка',
      'Остаток',
      'Минимальный остаток',
      'Описание',
      'Вес, г',
      'Высота, мм',
      'Ширина, мм',
      'Глубина, мм',
    ],
  ];

  for (const p of products) {
    rows.push([
      p.name,
      p.code,
      p.sku,
      p.barcode,
      p.plu_code,
      p.category_name,
      p.unit,
      formatMoney(p.cost_price),
      formatMoney(p.sale_price),
      percent(p.discount_bp),
      formatQty(p.stock),
      formatQty(p.min_qty),
      p.description,
      p.weight_g,
      p.height_mm,
      p.width_mm,
      p.depth_mm,
    ]);
  }

  return toCsv(rows);
}

/** Телефоны хранятся строкой JSON; битую строку молча считаем пустой. */
function phoneList(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Сотые доли процента — процентами: 1050 → «10,5». */
function percent(bp: number | null | undefined): string {
  if (!bp) return '';
  return String(bp / 100).replace('.', ',');
}

/** Из отметки времени — только день: «19.08.2026». */
function day(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`;
}
