import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { createCounterparty, getCounterparty } from '../counterparties';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale, getSale } from '../sales';
import { getSettings, saveSettings } from '../settings';
import type { CartLine } from '../../domain/types';

/**
 * Бонусы на кассе.
 *
 * Счета перенеслись из CloudShop, история их показывает — а начислять за
 * новые чеки было некому: касса про бонусы не знала вовсе. Пока это так,
 * программой нельзя торговать: покупатель, которому обещали кешбэк, после
 * первой же покупки увидит прежний счёт.
 */
describe('бонусы на кассе', () => {
  let db: SqlDriver;
  let productId: number;

  beforeEach(() => {
    db = createTestDriver();
    ensureLocation(db, 'Чайный бар');

    productId = createProduct(db, {
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

    saveSettings(db, {
      ...getSettings(db),
      bonusOn: true,
      cashbackRateBp: 300,
      redemptionRateBp: 10_000,
      bonusLimitBp: 5_000,
    });
  });

  const line = (qty: number): CartLine => ({
    product_id: productId,
    name: 'Габа Алишань',
    qty,
    price: 10_000,
    cost_price: 3_000,
    unit: 'гр',
    stock: 1_000_000,
  });

  /**
   * Продать одну позицию.
   *
   * `allowNegative` — чтобы не заводить приход ради проверки бонусов: здесь
   * проверяется счёт покупателя, а не остаток склада.
   */
  const sell = (over: Omit<Parameters<typeof createSale>[1], 'lines'> = {}): number =>
    createSale(db, { lines: [line(1_000)], allowNegative: true, ...over });

  const bonusClient = (balance = 0) =>
    createCounterparty(db, {
      kind: 'customer',
      name: 'Монтеро Антонио',
      loyalty_type: 'bonus',
      bonus_balance: balance,
      cashback_bp: 300,
    });

  it('начисляет кешбэк на счёт покупателя', () => {
    const customerId = bonusClient();
    const saleId = sell({ customerId });

    // Чек на 100,00, ставка 3 % — три рубля бонусами.
    expect(getSale(db, saleId)?.bonus_earned).toBe(300);
    expect(getCounterparty(db, customerId)?.bonus_balance).toBe(300);
  });

  it('своя ставка покупателя важнее общей', () => {
    const customerId = createCounterparty(db, {
      kind: 'customer',
      name: 'Анна Швецова',
      loyalty_type: 'bonus',
      cashback_bp: 500,
    });

    const saleId = sell({ customerId });
    expect(getSale(db, saleId)?.bonus_earned).toBe(500);
  });

  it('списание уменьшает чек и счёт', () => {
    const customerId = bonusClient(16_450);
    const saleId = sell({ customerId, bonusUsed: 4_000 });

    const sale = getSale(db, saleId);
    expect(sale?.bonus_used).toBe(4_000);
    // Чек был 100,00, бонусами закрыли 40,00 — к оплате 60,00.
    expect(sale?.total).toBe(6_000);

    // Со счёта ушло 40,00, вернулось 3 % с оплаченных деньгами 60,00.
    const party = getCounterparty(db, customerId);
    expect(party?.bonus_balance).toBe(16_450 - 4_000 + 180);
    expect(party?.bonus_spent).toBe(4_000);
  });

  it('за часть, закрытую бонусами, кешбэк не начисляется', () => {
    const customerId = bonusClient(16_450);
    const saleId = sell({ customerId, bonusUsed: 4_000 });

    // 3 % с 60,00, а не со 100,00.
    expect(getSale(db, saleId)?.bonus_earned).toBe(180);
  });

  it('больше предела компании списать нельзя, даже если попросили', () => {
    const customerId = bonusClient(90_000);
    // Половина чека — 50,00, просим 90,00.
    const saleId = sell({ customerId, bonusUsed: 90_000 });

    expect(getSale(db, saleId)?.bonus_used).toBe(5_000);
    expect(getSale(db, saleId)?.total).toBe(5_000);
  });

  it('больше, чем на счету, списать нельзя', () => {
    const customerId = bonusClient(1_000);
    const saleId = sell({ customerId, bonusUsed: 5_000 });

    expect(getSale(db, saleId)?.bonus_used).toBe(1_000);
    expect(getCounterparty(db, customerId)?.bonus_balance).toBe(0 + 270);
  });

  it('розничному покупателю бонусы не начисляются: счёта нет', () => {
    const saleId = sell();
    expect(getSale(db, saleId)?.bonus_earned).toBe(0);
  });

  it('покупателю на скидке бонусы не начисляются', () => {
    const customerId = createCounterparty(db, {
      kind: 'customer',
      name: 'Скидочный',
      loyalty_type: 'discount',
      discount_bp: 1_000,
    });

    const saleId = sell({ customerId });
    expect(getSale(db, saleId)?.bonus_earned).toBe(0);
  });

  it('выключенная программа не начисляет ничего', () => {
    saveSettings(db, { ...getSettings(db), bonusOn: false });

    const customerId = bonusClient(16_450);
    const saleId = sell({ customerId, bonusUsed: 4_000 });

    const sale = getSale(db, saleId);
    expect(sale?.bonus_earned).toBe(0);
    expect(sale?.bonus_used).toBe(0);
    expect(getCounterparty(db, customerId)?.bonus_balance).toBe(16_450);
  });
});
