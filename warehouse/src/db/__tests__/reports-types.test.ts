import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { ensureLocation } from '../locations';
import { createMoneyDoc } from '../money';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { REPORTS, reportById } from '../reportTypes';
import { periodFor } from '../reports';
import { postDoc } from '../stock';
import { groupByMonth, groupByWeek } from '../../domain/grouping';
import type { CartLine } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

const ALL_TIME = { from: '1970-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z' };

describe('реестр отчётов', () => {
  it('у каждого отчёта есть колонки и он считается на пустой базе', () => {
    for (const report of REPORTS) {
      expect(report.columns.length).toBeGreaterThan(1);
      const rows = report.rows(db, ALL_TIME);
      // Пустая база — это ноль строк, а не исключение.
      for (const row of rows) expect(row).toHaveLength(report.columns.length);

      const total = report.total?.(db, ALL_TIME) ?? null;
      if (total) expect(total).toHaveLength(report.columns.length);
    }
  });

  it('плитка ведёт на существующий отчёт', () => {
    expect(reportById('sales-by-day')).not.toBeNull();
    expect(reportById('такого-нет')).toBeNull();
  });

  it('считает продажи и остатки', () => {
    const shop = ensureLocation(db, 'Ереван');
    const id = createProduct(db, {
      name: 'Шу пуэр',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'кг',
      cost_price: 100000,
      sale_price: 200000,
      min_qty: 0,
      photo_uri: null,
    });
    postDoc(db, {
      type: 'purchase',
      locationId: shop,
      lines: [{ product_id: id, name: 'Шу пуэр', unit: 'кг', qty: 10000, price: 100000 }],
    });

    const line: CartLine = {
      product_id: id,
      name: 'Шу пуэр',
      unit: 'кг',
      qty: 2000,
      price: 200000,
      cost_price: 100000,
      stock: 10000,
    };
    // Магазин передаёт касса — так же, как в приложении.
    createSale(db, { lines: [line], payment: 'cash', locationId: shop });
    createMoneyDoc(db, { type: 'expense', amount: 50000, account: 'Касса магазина' });

    const period = periodFor('month');

    const byProduct = reportById('sales-by-product')!.rows(db, period);
    expect(byProduct[0][0]).toBe('Шу пуэр');
    expect(byProduct[0][2]).toBe('4,000.00');

    const accounts = reportById('accounts')!.rows(db, period);
    const cash = accounts.find((row) => row[0] === 'Касса магазина')!;
    // 4000,00 с продажи минус 500,00 расход.
    expect(cash[4]).toBe('3,500.00');

    const stores = reportById('stock-by-store')!.rows(db, period);
    // 10 кг закупили, 2 продали; 8 кг по цене продажи 2000,00.
    expect(stores[0]).toEqual(['Ереван', '1', '8.000', '16,000.00']);
  });
});

describe('группировка по неделям и месяцам', () => {
  const points = [
    { day: '2026-07-29', revenue: 100, profit: 40, receipts: 1 },
    { day: '2026-08-03', revenue: 200, profit: 80, receipts: 2 },
    { day: '2026-08-04', revenue: 300, profit: 90, receipts: 3 },
  ];

  it('неделя начинается с понедельника', () => {
    const weeks = groupByWeek(points);
    expect(weeks).toHaveLength(2);
    // 29 июля 2026 — среда, значит неделя началась в понедельник 27 июля.
    expect(weeks[0].from).toBe('2026-07-27');
    expect(weeks[1].from).toBe('2026-08-03');
    expect(weeks[1].revenue).toBe(500);
    expect(weeks[1].receipts).toBe(5);
  });

  it('месяц называется по-русски', () => {
    const months = groupByMonth(points);
    expect(months.map((m) => m.label)).toEqual(['июль 2026', 'август 2026']);
    expect(months[1].revenue).toBe(500);
  });
});
