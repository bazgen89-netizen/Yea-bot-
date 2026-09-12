import type { Kopecks } from './money';

/**
 * Бонусы: сколько начислить за чек и сколько с него можно списать.
 *
 * Здесь нет ни базы, ни экрана — только счёт. Он один и тот же на кассе, в
 * карточке клиента и в отчётах, и ошибиться в нём нельзя: бонусы — это
 * обещание, данное покупателю, и «пересчитаем завтра» тут не работает.
 *
 * Три ставки компании (`Компания → Лояльность`):
 *   • курс начисления — сколько процентов чека возвращается бонусами;
 *   • курс списания — сколько рублей скидки даёт один бонус;
 *   • предел — каким процентом чека можно платить бонусами.
 *
 * У покупателя может быть своя ставка начисления: она приезжает из CloudShop
 * (`cashback_rate`) и у половины карточек отличается от общей. Своя ставка
 * важнее общей — иначе перенесённые карточки начали бы копить не по тем
 * правилам, по которым им обещали.
 */
export interface BonusRates {
  /** Включена ли бонусная программа вовсе. */
  on: boolean;
  /** Общий курс начисления, сотые доли процента. */
  cashbackRateBp: number;
  /** Курс списания: сколько процентов рубля даёт один бонус. 10000 = один к одному. */
  redemptionRateBp: number;
  /** Каким процентом чека можно платить бонусами, сотые доли процента. */
  limitBp: number;
}

/**
 * Сколько бонусов начислить за чек.
 *
 * Считается от суммы, которую покупатель **заплатил деньгами**: за часть,
 * оплаченную бонусами, бонусы не начисляются. Иначе счёт рос бы сам из себя,
 * и на десятом чеке покупатель платил бы одними бонусами вечно.
 */
export function bonusEarned(
  paidWithMoney: Kopecks,
  rates: BonusRates,
  personalRateBp?: number | null,
): Kopecks {
  if (!rates.on) return 0;

  const rate = personalRateBp && personalRateBp > 0 ? personalRateBp : rates.cashbackRateBp;
  if (rate <= 0 || paidWithMoney <= 0) return 0;

  return Math.round((paidWithMoney * rate) / 10000);
}

/**
 * Сколько бонусов можно списать с этого чека.
 *
 * Ограничений три, и берётся самое строгое: счёт покупателя, предел компании
 * и сама сумма чека. Возвращается **сумма скидки в копейках** — то, на
 * сколько уменьшится чек, — а не количество бонусов: на кассе платят рублями,
 * и курс списания уже учтён.
 */
export function maxBonusSpend(
  total: Kopecks,
  balance: Kopecks,
  rates: BonusRates,
): Kopecks {
  if (!rates.on || total <= 0 || balance <= 0) return 0;

  const rate = rates.redemptionRateBp > 0 ? rates.redemptionRateBp : 10000;
  // Что дадут все бонусы со счёта, если пустить их в дело.
  const worth = Math.floor((balance * rate) / 10000);

  // Предел компании: ноль значит «без предела», а не «нельзя ничего».
  const limit = rates.limitBp > 0 ? Math.floor((total * rates.limitBp) / 10000) : total;

  return Math.max(0, Math.min(worth, limit, total));
}

/**
 * Сколько бонусов спишется со счёта, чтобы дать такую скидку.
 *
 * Обратная к `maxBonusSpend`: на кассе выбирают сумму скидки, а со счёта
 * уходит столько бонусов, сколько эта скидка стоит по курсу списания.
 */
export function bonusForDiscount(discount: Kopecks, rates: BonusRates): Kopecks {
  if (discount <= 0) return 0;

  const rate = rates.redemptionRateBp > 0 ? rates.redemptionRateBp : 10000;
  return Math.round((discount * 10000) / rate);
}
