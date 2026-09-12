import { countHeld, deleteHeld, holdReceipt, listHeld } from '../held';
import { migrate } from '../schema';
import { createTestDriver } from '../testDriver';
import type { CartLine } from '../../domain/types';

/**
 * Отложенные чеки.
 *
 * Проверяется главное свойство: отложить можно сколько угодно, и ни один из
 * них не трогает склад — иначе «отложить» означало бы «продать».
 */
describe('очередь чеков', () => {
  const line = (name: string, price: number): CartLine => ({
    product_id: 1,
    name,
    unit: 'шт',
    qty: 1000,
    price,
    cost_price: 0,
    discount_bp: 0,
    stock: 5000,
  });

  function open() {
    const db = createTestDriver();
    migrate(db);
    return db;
  }

  it('складывает чеки один за другим', () => {
    const db = open();
    holdReceipt(db, {
      mode: 'sale',
      customerId: null,
      customerName: null,
      discount: 0,
      lines: [line('Шу пуэр', 30000)],
    });
    holdReceipt(db, {
      mode: 'sale',
      customerId: null,
      customerName: 'Тарасова Елена',
      discount: 5000,
      lines: [line('Сертификат', 150000)],
    });

    expect(countHeld(db)).toBe(2);

    // Свежий сверху — как в его окне: последний отложенный ближе всех.
    const queue = listHeld(db);
    expect(queue[0].customer_name).toBe('Тарасова Елена');
    expect(queue[0].lines[0].name).toBe('Сертификат');
    expect(queue[0].discount).toBe(5000);
    expect(queue[1].lines[0].name).toBe('Шу пуэр');
  });

  it('склад не трогает', () => {
    const db = open();
    holdReceipt(db, {
      mode: 'sale',
      customerId: null,
      customerName: null,
      discount: 0,
      lines: [line('Шу пуэр', 30000)],
    });

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves')?.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales')?.n).toBe(0);
  });

  it('выбранный из очереди чек из неё пропадает', () => {
    const db = open();
    holdReceipt(db, {
      mode: 'sale',
      customerId: null,
      customerName: null,
      discount: 0,
      lines: [line('Шу пуэр', 30000)],
    });

    deleteHeld(db, listHeld(db)[0].id);
    expect(countHeld(db)).toBe(0);
  });
});
