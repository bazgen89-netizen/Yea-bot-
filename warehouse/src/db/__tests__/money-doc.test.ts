import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale, updateSalePayment } from '../sales';
import { createMoneyDoc, deleteMoneyDoc, getMoneyDoc, updateMoneyDoc } from '../money';
import { listMoney } from '../journal';

/**
 * Страница денежного документа.
 *
 * В их таблице движения денег на страницу документа ведёт каждая строка —
 * и заведённая руками, и приход по чеку. Поэтому `getMoneyDoc` обязан
 * собрать документ в обоих случаях, а приход по чеку — остаться
 * нередактируемым: сумма там держится проданным товаром, и менять её надо
 * в самом чеке.
 */
describe('денежный документ', () => {
  let db: SqlDriver;
  let store: number;

  beforeEach(() => {
    db = createTestDriver();
    store = ensureLocation(db, 'Чайный бар');
  });

  const doc = () =>
    createMoneyDoc(db, {
      type: 'expense',
      amount: 50_000,
      account: 'Касса магазина',
      category: 'Аренда',
      counterparty: 'Арендодатель',
      note: 'за август',
      locationId: store,
    });

  it('отдаёт заведённый руками документ со всеми полями', () => {
    const one = getMoneyDoc(db, doc());

    expect(one?.source).toBe('doc');
    expect(one?.type).toBe('expense');
    expect(one?.amount).toBe(50_000);
    expect(one?.category).toBe('Аренда');
    expect(one?.note).toBe('за август');
    // Правится здесь же — привязки к чеку у него нет.
    expect(one?.sale_id).toBeNull();
  });

  it('правит счёт, сумму, категорию и комментарий', () => {
    const id = doc();

    updateMoneyDoc(db, id, {
      amount: 60_000,
      account: 'Счет в банке',
      category: 'Прочий расход',
      counterparty: 'Арендодатель',
      note: 'за август и сентябрь',
    });

    const after = getMoneyDoc(db, id);
    expect(after?.amount).toBe(60_000);
    expect(after?.account).toBe('Счет в банке');
    expect(after?.category).toBe('Прочий расход');
    expect(after?.note).toBe('за август и сентябрь');
  });

  it('не даёт сохранить нулевую сумму и документ без счёта', () => {
    const id = doc();

    expect(() => updateMoneyDoc(db, id, { amount: 0, account: 'Касса магазина' })).toThrow();
    expect(() => updateMoneyDoc(db, id, { amount: 100, account: '  ' })).toThrow();
  });

  it('дату меняет только когда её прислали', () => {
    const id = doc();
    const was = getMoneyDoc(db, id)?.created_at;

    updateMoneyDoc(db, id, { amount: 50_000, account: 'Касса магазина' });
    expect(getMoneyDoc(db, id)?.created_at).toBe(was);

    updateMoneyDoc(db, id, {
      amount: 50_000,
      account: 'Касса магазина',
      createdAt: '2026-08-23 18:15',
    });
    expect(getMoneyDoc(db, id)?.created_at).not.toBe(was);
    expect(getMoneyDoc(db, id)?.created_at).toContain('2026-08-23');
  });

  it('удаляется', () => {
    const id = doc();
    deleteMoneyDoc(db, id);
    expect(getMoneyDoc(db, id)).toBeNull();
  });

  describe('приход по чеку', () => {
    let saleId: number;

    beforeEach(() => {
      const productId = createProduct(db, {
        name: 'Габа Алишань',
        sku: null,
        barcode: null,
        category_id: null,
        unit: 'гр',
        cost_price: 3_000,
        sale_price: 10_000,
        min_qty: 0,
        photo_uri: null,
      });

      saleId = createSale(db, {
        lines: [
          {
            product_id: productId,
            name: 'Габа Алишань',
            qty: 2_000,
            price: 10_000,
            cost_price: 3_000,
            unit: 'гр',
            stock: 0,
          },
        ],
        locationId: store,
        payment: 'card',
        allowNegative: true,
      });
    });

    it('открывается такой же страницей, как заведённый руками', () => {
      const one = getMoneyDoc(db, saleId, 'sale');

      expect(one?.source).toBe('sale');
      expect(one?.type).toBe('income');
      expect(one?.amount).toBe(20_000);
      // Способ оплаты — это и есть счёт, на который легли деньги.
      expect(one?.account).toBe('Терминал / Счет в банке');
      expect(one?.category).toBe('Оплата от клиента');
      expect(one?.counterparty).toBe('Розничный покупатель');
      // «Привязка к документу» — то самое поле, что стоит у него.
      expect(one?.sale_id).toBe(saleId);
    });

    it('правится то, что лежит в чеке: контрагент и комментарий', () => {
      const buyer = db.run(
        `INSERT INTO counterparties (name, kind, created_at) VALUES ('Андрей', 'customer', '2026-08-01')`,
      );
      void buyer;
      const id = db.get<{ id: number }>('SELECT id FROM counterparties WHERE name = ?', ['Андрей'])!.id;

      updateSalePayment(db, saleId, { customerId: id, note: 'наличными без сдачи' });

      const one = getMoneyDoc(db, saleId, 'sale');
      expect(one?.counterparty).toBe('Андрей');
      expect(one?.note).toBe('наличными без сдачи');
      // Сумма прихода — итог чека, и правка её не трогает.
      expect(one?.amount).toBe(20_000);
    });

    /**
     * Поле «статус» в его строке отбора движения денег.
     *
     * Оно там есть, и я его завёл — но врать оно не должно: отложенных
     * ордеров у нас не бывает, значит «Документ не проведён» показывает
     * пусто, а «Документ проведён» — весь список.
     */
    it('отбор по статусу: проведённые — все, отложенных нет ни одного', () => {
      expect(listMoney(db, 500, { status: 'posted' }).length).toBe(listMoney(db).length);
      expect(listMoney(db, 500, { status: 'draft' })).toHaveLength(0);
    });

    it('в ленте у строки есть и источник, и то, чем её открыть', () => {
      const row = listMoney(db).find((entry) => entry.source === 'sale');

      expect(row?.id).toBe(saleId);
      expect(getMoneyDoc(db, row!.id, row!.source)?.amount).toBe(20_000);
    });
  });
});
