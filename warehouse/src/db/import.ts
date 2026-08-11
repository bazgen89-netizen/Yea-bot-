import type { SqlDriver } from './driver';
import { importCounterparties, type PartyInput } from './counterparties';
import { ensureLocation } from './locations';
import {
  createProduct,
  ensureCategory,
  listProducts,
  saveCategories,
  updateProduct,
} from './products';
import { postInventory } from './stock';
import { parseTable, pick } from '../domain/csv';
import { parseMoney } from '../domain/money';
import { parsePercent, parseDate } from '../domain/pricing';
import { parseQty } from '../domain/qty';
import type { Id, ProductKind } from '../domain/types';

/**
 * Загрузка справочников из файла.
 *
 * Программа не должна быть привязана к одному магазину: каталог и клиентов
 * заводит тот, кто ставит её себе, а не тот, кто её собирал. Поэтому импорт —
 * не вспомогательная кнопка, а способ начать работу.
 *
 * Файл — обычный CSV, какой отдаёт Excel и любая складская программа.
 * Колонки распознаются по заголовку, а порядок и лишние столбцы значения
 * не имеют: у каждой программы выгрузка своя, и требовать точный формат
 * значило бы заставлять человека переделывать файл руками.
 */

export interface ImportResult {
  added: number;
  updated: number;
  /** Строки, которые не удалось разобрать: номер строки и что не так. */
  problems: { line: number; reason: string }[];
}

/** Вид позиции из текста: «услуга», «комплект», иначе товар. */
function kindOf(value: string): ProductKind {
  const text = value.toLowerCase();
  if (text.startsWith('услуг') || text === 'service') return 'service';
  if (text.startsWith('комплект') || text === 'set') return 'set';
  return 'product';
}

/**
 * Товары и комплекты.
 *
 * Существующий товар обновляется, а не задваивается. Ищется он по тому, что
 * действительно уникально: сначала штрихкод, потом код, потом артикул. По
 * названию — только если больше не по чему: названия повторяются, и связывать
 * по ним значит однажды слить два разных товара в один.
 */
export function importProducts(db: SqlDriver, text: string): ImportResult {
  const rows = parseTable(text);
  const result: ImportResult = { added: 0, updated: 0, problems: [] };
  if (rows.length === 0) return result;

  const existing = listProducts(db, { includeArchived: true });
  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const byCode = new Map(existing.filter((p) => p.code).map((p) => [p.code!, p]));
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!, p]));
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  // Остатки применяются одним документом инвентаризации после разбора всех
  // строк: так в журнале остаётся одна запись «загрузка», а не по одной на
  // каждый товар.
  const stock: { product_id: Id; name: string; unit: string; actual: number }[] = [];
  const shopName = pick(rows[0], 'магазин', 'склад');
  const shop = shopName ? ensureLocation(db, shopName) : null;

  rows.forEach((row, index) => {
    const line = index + 2; // +1 на заголовок, +1 чтобы считать с единицы

    const name = pick(row, 'наименование', 'название', 'товар', 'name');
    if (!name) {
      result.problems.push({ line, reason: 'нет наименования' });
      return;
    }

    const barcode = pick(row, 'штрих-код', 'штрихкод', 'barcode', 'ean');
    const code = pick(row, 'код товара', 'код', 'code');
    const sku = pick(row, 'артикул', 'sku');

    const money = (...names: string[]) => {
      const raw = pick(row, ...names);
      return raw ? parseMoney(raw) : null;
    };

    const salePrice = money('цена продажи', 'цена', 'price');
    if (pick(row, 'цена продажи', 'цена', 'price') && salePrice === null) {
      result.problems.push({ line, reason: `цена «${pick(row, 'цена продажи', 'цена', 'price')}» не число` });
      return;
    }

    const found =
      (barcode ? byBarcode.get(barcode) : undefined) ??
      (code ? byCode.get(code) : undefined) ??
      (sku ? bySku.get(sku) : undefined) ??
      byName.get(name.toLowerCase());

    // Категорий у товара бывает несколько — в файле они через запятую.
    const category = pick(row, 'категория', 'категории', 'группа', 'category');
    const categoryList = category
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const discount = pick(row, 'скидка', 'скидка, %', 'discount');
    const expires = pick(row, 'срок годности', 'годен до');
    const minQty = pick(row, 'мин. остаток', 'мин. ост.', 'минимальный остаток');

    const input = {
      name,
      kind: kindOf(pick(row, 'вид', 'тип', 'kind', 'type')),
      sku: sku || null,
      code: code || null,
      barcode: barcode || null,
      category_id: categoryList[0] ? ensureCategory(db, categoryList[0]) : (found?.category_id ?? null),
      unit: pick(row, 'ед. изм.', 'единица измерения', 'единица', 'unit') || found?.unit || 'шт',
      cost_price: money('себестоимость', 'cost') ?? found?.cost_price ?? 0,
      purchase_price: money('цена закупки', 'закупка', 'purchase') ?? found?.purchase_price ?? 0,
      sale_price: salePrice ?? found?.sale_price ?? 0,
      min_qty: (minQty ? parseQty(minQty) : null) ?? found?.min_qty ?? 0,
      discount_bp: (discount ? parsePercent(discount) : null) ?? found?.discount_bp ?? 0,
      expires_at: (expires ? parseDate(expires) : null) ?? found?.expires_at ?? null,
      country: pick(row, 'страна', 'country') || found?.country || null,
      plu_code: pick(row, 'plu код', 'plu') || found?.plu_code || null,
      description: pick(row, 'описание', 'description') || found?.description || null,
      photo_uri: found?.photo_uri ?? null,
    };

    let productId: Id;
    try {
      if (found) {
        updateProduct(db, found.id, input);
        productId = found.id;
        result.updated++;
      } else {
        productId = createProduct(db, input);
        result.added++;
      }
    } catch (error) {
      const message = String(error);
      result.problems.push({
        line,
        reason: message.includes('UNIQUE') ? `штрихкод ${barcode} уже занят` : message,
      });
      return;
    }

    if (categoryList.length > 0) saveCategories(db, productId, categoryList);

    const qtyText = pick(row, 'остаток', 'количество', 'кол-во', 'qty', 'stock');
    if (qtyText) {
      const qty = parseQty(qtyText);
      if (qty === null) {
        result.problems.push({ line, reason: `остаток «${qtyText}» не число` });
      } else if (qty > 0) {
        stock.push({ product_id: productId, name, unit: input.unit, actual: qty });
      }
    }
  });

  if (stock.length > 0) {
    postInventory(db, {
      locationId: shop,
      note: 'Загрузка из файла',
      lines: stock.map((item) => ({ ...item, price: 0 })),
    });
  }

  return result;
}

/**
 * Клиенты и поставщики из файла.
 *
 * Разбирает колонки и передаёт готовые записи в `importCounterparties`:
 * сопоставление по телефону, бережное отношение к заполненным полям и защита
 * от повторной загрузки уже написаны там и проверены тестами. Своя вторая
 * реализация того же разошлась бы с первой при первой же правке.
 */
export function importParties(
  db: SqlDriver,
  text: string,
  kind: 'customer' | 'supplier' = 'customer',
): ImportResult {
  const rows = parseTable(text);
  const result: ImportResult = { added: 0, updated: 0, problems: [] };
  if (rows.length === 0) return result;

  const parsed: PartyInput[] = [];

  rows.forEach((row, index) => {
    const name = pick(row, 'наименование', 'название', 'имя', 'клиент', 'name');
    if (!name) {
      result.problems.push({ line: index + 2, reason: 'нет имени' });
      return;
    }

    parsed.push({
      kind,
      name,
      phone: pick(row, 'телефон', 'phone', 'моб. телефон') || null,
      email: pick(row, 'почта', 'email', 'e-mail') || null,
      note: pick(row, 'описание', 'комментарий', 'note') || null,
      discount_bp: parsePercent(pick(row, 'скидка', 'discount')) ?? 0,
      birthday: pick(row, 'день рождения', 'дата рождения', 'др') || null,
      gender: pick(row, 'пол', 'gender') || null,
      address: pick(row, 'адрес', 'address') || null,
      created_by: pick(row, 'кто создал', 'создал') || null,
    });
  });

  const loaded = importCounterparties(db, parsed);
  result.added = loaded.created;
  result.updated = loaded.updated;
  return result;
}
