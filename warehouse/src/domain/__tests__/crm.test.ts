import {
  birthdayParts,
  cadence,
  daysSince,
  daysToBirthday,
  shopCadence,
  standingOf,
  vipThreshold,
  whatsappLink,
  сроком,
  type ClientFacts,
} from '../crm';

/**
 * Разбиение клиентов на группы.
 *
 * Числа в тестах взяты из настоящей базы Вазгена: 3 270 клиентов и 46 358
 * чеков. Постоянный покупатель приходит раз в 60 дней, 61 % клиентов купили
 * один раз и не вернулись, 474 человека с двумя и более покупками пропали на
 * срок от 60 до 365 дней. Всё, что здесь проверяется, должно совпадать с этой
 * картиной, а не с удобной выдумкой.
 */

const NOW = Date.parse('2026-09-07T12:00:00Z');
const дней = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function клиент(facts: Partial<ClientFacts>): ClientFacts {
  return {
    receipts: 0,
    purchases: 0,
    first_sale_at: null,
    last_sale_at: null,
    ...facts,
  };
}

describe('свой срок между покупками', () => {
  it('до третьей покупки берётся общий по магазину', () => {
    expect(cadence(клиент({ receipts: 1, first_sale_at: дней(10), last_sale_at: дней(10) }), 60))
      .toBe(60);
    // Два захода за неделю — ещё не значит «ходит раз в три дня».
    expect(cadence(клиент({ receipts: 2, first_sale_at: дней(97), last_sale_at: дней(90) }), 60))
      .toBe(60);
  });

  it('с третьей — считается по нему самому', () => {
    // Пять покупок за 120 дней — это четыре промежутка по 30.
    const он = клиент({ receipts: 5, first_sale_at: дней(130), last_sale_at: дней(10) });
    expect(cadence(он, 60)).toBe(30);
  });

  it('короче недели срока не бывает', () => {
    // Бар: тридцать покупок за месяц. Звонить назавтра после пропуска — перебор.
    const завсегдатай = клиент({ receipts: 31, first_sale_at: дней(31), last_sale_at: дней(1) });
    expect(cadence(завсегдатай, 60)).toBe(7);
  });

  it('медиана по магазину, а не среднее', () => {
    // Оптовик раз в год не должен сдвигать срок для всех остальных.
    const все = [
      клиент({ receipts: 5, first_sale_at: дней(220), last_sale_at: дней(20) }), // 50
      клиент({ receipts: 5, first_sale_at: дней(260), last_sale_at: дней(20) }), // 60
      клиент({ receipts: 5, first_sale_at: дней(300), last_sale_at: дней(20) }), // 70
      клиент({ receipts: 3, first_sale_at: дней(1500), last_sale_at: дней(20) }), // 740
    ];
    expect(shopCadence(все)).toBe(65);
  });

  it('пустая база не ломает счёт', () => {
    expect(shopCadence([])).toBe(60);
    expect(shopCadence([клиент({ receipts: 1 })])).toBe(60);
  });
});

describe('группы клиентов', () => {
  it('карточка без чеков — без покупок', () => {
    const он = standingOf(клиент({ receipts: 0 }), NOW, 60);
    expect(он.segment).toBe('none');
    expect(он.idle).toBeNull();
  });

  it('одна покупка — новый, пока не прошёл год', () => {
    const свежий = клиент({ receipts: 1, first_sale_at: дней(5), last_sale_at: дней(5) });
    expect(standingOf(свежий, NOW, 60).segment).toBe('new');

    // Через сто дней он всё ещё «новый»: он не обещал возвращаться, и звать
    // его тем же письмом, что и пропавшего постоянного, — разные разговоры.
    const давний = клиент({ receipts: 1, first_sale_at: дней(100), last_sale_at: дней(100) });
    expect(standingOf(давний, NOW, 60).segment).toBe('new');
  });

  it('приходит в свой срок — постоянный', () => {
    const он = клиент({ receipts: 6, first_sale_at: дней(150), last_sale_at: дней(20) });
    expect(standingOf(он, NOW, 60).segment).toBe('regular');
  });

  it('задержался в пределах запаса — ещё постоянный', () => {
    // Срок 30 дней, ждём 45. На 40-м дне тревожить рано.
    const он = клиент({ receipts: 5, first_sale_at: дней(160), last_sale_at: дней(40) });
    expect(cadence(он, 60)).toBe(30);
    expect(standingOf(он, NOW, 60).segment).toBe('regular');
  });

  it('перешёл запас — пропал, и видно на сколько', () => {
    const он = клиент({ receipts: 5, first_sale_at: дней(190), last_sale_at: дней(70) });
    const где = standingOf(он, NOW, 60);
    expect(cadence(он, 60)).toBe(30);
    expect(где.segment).toBe('sleeping');
    expect(где.idle).toBe(70);
    expect(где.overdue).toBe(70 - 45);
  });

  it('больше года — потерян, сколько бы ни покупал', () => {
    const он = клиент({ receipts: 40, first_sale_at: дней(1200), last_sale_at: дней(400) });
    expect(standingOf(он, NOW, 60).segment).toBe('lost');
    const разовый = клиент({ receipts: 1, first_sale_at: дней(400), last_sale_at: дней(400) });
    expect(standingOf(разовый, NOW, 60).segment).toBe('lost');
  });

  it('группы не пересекаются — каждый ровно в одной', () => {
    const все = [0, 1, 2, 5, 40].flatMap((receipts) =>
      [1, 20, 70, 200, 400, 900].map((idle) =>
        клиент({
          receipts,
          first_sale_at: receipts ? дней(idle + 300) : null,
          last_sale_at: receipts ? дней(idle) : null,
        }),
      ),
    );

    const по = new Map<string, number>();
    for (const один of все) {
      const где = standingOf(один, NOW, 60).segment;
      по.set(где, (по.get(где) ?? 0) + 1);
    }

    expect([...по.values()].reduce((a, b) => a + b, 0)).toBe(все.length);
  });

  it('«пришёл раньше срока» — не опоздание, а ноль', () => {
    const он = клиент({ receipts: 5, first_sale_at: дней(160), last_sale_at: дней(1) });
    expect(standingOf(он, NOW, 60).overdue).toBe(0);
  });
});

describe('крупные клиенты', () => {
  it('граница верхних десяти процентов', () => {
    const все = Array.from({ length: 100 }, (_, i) =>
      клиент({ receipts: 1, purchases: (i + 1) * 1000, last_sale_at: дней(1) }),
    );
    // Сверху 100 000, 99 000 … десятый сверху — 91 000.
    expect(vipThreshold(все, 0.1)).toBe(91_000);
  });

  it('пустая база не даёт крупных', () => {
    expect(vipThreshold([])).toBe(Infinity);
    expect(vipThreshold([клиент({ receipts: 0, purchases: 500 })])).toBe(Infinity);
  });
});

describe('дни рождения', () => {
  it('понимает все три записи — CloudShop, рукописную и обратную', () => {
    expect(birthdayParts('30/12/2026')).toEqual({ day: 30, month: 12 });
    expect(birthdayParts('12.07.1990')).toEqual({ day: 12, month: 7 });
    // Год впереди узнаётся по четырём цифрам, иначе днём рождения стало бы
    // число 1990, и человека не поздравили бы никогда.
    expect(birthdayParts('1990-07-12')).toEqual({ day: 12, month: 7 });
  });

  it('мусор не превращает в дату', () => {
    for (const плохо of [null, '', 'скоро', '45.13.1990', '0.5.1990']) {
      expect(birthdayParts(плохо)).toBeNull();
    }
  });

  it('считает, сколько дней осталось', () => {
    // Сегодня 7 сентября 2026.
    expect(daysToBirthday('07/09/1990', NOW)).toBe(0);
    expect(daysToBirthday('08/09/1990', NOW)).toBe(1);
    expect(daysToBirthday('14/09/1990', NOW)).toBe(7);
  });

  it('через новый год — не «минус триста», а «через шестьдесят»', () => {
    expect(daysToBirthday('01/01/1990', NOW)).toBe(116);
  });

  it('29 февраля в невисокосный год поздравляем 28-го', () => {
    const января = Date.parse('2027-01-10T12:00:00Z');
    expect(daysToBirthday('29/02/1988', января)).toBe(49); // 28 февраля 2027
  });
});

describe('ссылка в WhatsApp', () => {
  it('переводит восьмёрку в семёрку — иначе номер не откроется', () => {
    expect(whatsappLink('89005832929')).toBe('https://wa.me/79005832929');
    expect(whatsappLink('+7 (900) 583-29-29')).toBe('https://wa.me/79005832929');
  });

  it('короткий или пустой номер ссылкой не становится', () => {
    for (const плохо of [null, '', '123', 'нет телефона']) {
      expect(whatsappLink(плохо)).toBeNull();
    }
  });

  it('текст письма уезжает в ссылку', () => {
    expect(whatsappLink('89005832929', 'Здравствуйте!')).toBe(
      'https://wa.me/79005832929?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5!',
    );
  });
});

describe('срок словами', () => {
  it('говорит по-человечески', () => {
    expect(сроком(null)).toBe('никогда');
    expect(сроком(0)).toBe('сегодня');
    expect(сроком(1)).toBe('вчера');
    expect(сроком(14)).toBe('14 дн. назад');
    expect(сроком(70)).toBe('2 мес. назад');
    expect(сроком(400)).toBe('больше года назад');
    expect(сроком(900)).toBe('2 г. назад');
  });
});

describe('сколько дней прошло', () => {
  it('считает от переданного «сейчас»', () => {
    expect(daysSince(дней(3), NOW)).toBe(3);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('не дата', NOW)).toBeNull();
  });

  it('дата из будущего — это ноль, а не минус', () => {
    expect(daysSince(new Date(NOW + 5 * 86_400_000).toISOString(), NOW)).toBe(0);
  });
});
