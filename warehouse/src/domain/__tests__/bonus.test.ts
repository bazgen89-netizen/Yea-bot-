import { bonusEarned, bonusForDiscount, maxBonusSpend, type BonusRates } from '../bonus';

const rates: BonusRates = {
  on: true,
  // 3 % — та ставка, что стоит у большинства его карточек.
  cashbackRateBp: 300,
  // Один бонус = один рубль.
  redemptionRateBp: 10000,
  // Половиной чека платить бонусами можно.
  limitBp: 5000,
};

describe('начисление бонусов', () => {
  it('считает процент от того, что заплатили деньгами', () => {
    expect(bonusEarned(25_000, rates)).toBe(750);
  });

  it('своя ставка покупателя важнее общей', () => {
    // Карточки из CloudShop приезжают со своей ставкой, и она у половины
    // отличается от общей. Начислять им по общей — обмануть.
    expect(bonusEarned(25_000, rates, 500)).toBe(1250);
    expect(bonusEarned(25_000, rates, 0)).toBe(750);
    expect(bonusEarned(25_000, rates, null)).toBe(750);
  });

  it('выключенная программа не начисляет ничего', () => {
    expect(bonusEarned(25_000, { ...rates, on: false })).toBe(0);
  });

  it('за часть, оплаченную бонусами, бонусы не начисляются', () => {
    // Чек на 250,00, из них 100,00 бонусами: начисляем с полутора сотен.
    expect(bonusEarned(15_000, rates)).toBe(450);
  });
});

describe('списание бонусов', () => {
  it('не больше того, что на счету', () => {
    expect(maxBonusSpend(100_000, 16_450, rates)).toBe(16_450);
  });

  it('не больше предела компании', () => {
    // Половина чека на 100,00 — это 50,00, даже если на счету больше.
    expect(maxBonusSpend(10_000, 90_000, rates)).toBe(5_000);
  });

  it('не больше самого чека', () => {
    expect(maxBonusSpend(3_000, 90_000, { ...rates, limitBp: 0 })).toBe(3_000);
  });

  it('нулевой предел значит «без предела», а не «нельзя»', () => {
    expect(maxBonusSpend(10_000, 90_000, { ...rates, limitBp: 0 })).toBe(10_000);
  });

  it('курс списания учитывается', () => {
    // Бонус даёт полтинник скидки: 164,50 бонусов = 82,25 скидки.
    expect(maxBonusSpend(100_000, 16_450, { ...rates, redemptionRateBp: 5000 })).toBe(8_225);
  });

  it('пустой счёт и выключенная программа не дают ничего', () => {
    expect(maxBonusSpend(10_000, 0, rates)).toBe(0);
    expect(maxBonusSpend(10_000, 90_000, { ...rates, on: false })).toBe(0);
  });

  it('обратный счёт: сколько бонусов стоит такая скидка', () => {
    expect(bonusForDiscount(5_000, rates)).toBe(5_000);
    expect(bonusForDiscount(8_225, { ...rates, redemptionRateBp: 5000 })).toBe(16_450);
    expect(bonusForDiscount(0, rates)).toBe(0);
  });
});
