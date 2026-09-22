# -*- coding: utf-8 -*-
"""Что плагин СДЭК посчитает для разных корзин.

Алгоритм воспроизведён построчно по исходнику плагина,
`cdekdelivery/src/Actions/CalculateDeliveryAction.php`, метод getPackagesData:

    для каждой позиции:
        dims = [длина, ширина, высота] как целые
        sort(dims)                       # по возрастанию
        если количество > 1:
            dims[0] *= количество        # умножается САМАЯ КОРОТКАЯ сторона
            sort(dims)
        lengthList[] = dims[0]           # самая короткая
        heightList[] = dims[1]
        widthList[]  = dims[2]           # самая длинная
        totalWeight += количество * (вес или 1 г, если пусто)

    в каждый список добавляются габариты по умолчанию (10, 10, 10)
    берётся МАКСИМУМ по каждому списку

Проверено отдельно: product_package_default_toggle = false,
то есть вычисленные габариты не отбрасываются.

Оплачиваемый вес у СДЭК = max(фактический, объём_см³ / 5000).
"""

DEFAULT_DIMS = (10, 10, 10)
FALLBACK_WEIGHT_G = 1


def pack(items):
    """items: список (название, вес_г, (д, ш, в), количество)."""
    total_w = 0
    length_list, width_list, height_list = [], [], []
    for _, w, dims, qty in items:
        d = sorted(int(x) for x in dims)
        if qty > 1:
            d[0] = qty * d[0]
            d = sorted(d)
        length_list.append(d[0])
        height_list.append(d[1])
        width_list.append(d[2])
        total_w += qty * (w if w else FALLBACK_WEIGHT_G)
    pre = sorted(DEFAULT_DIMS)
    length_list.append(pre[0])
    height_list.append(pre[1])
    width_list.append(pre[2])
    box = (max(length_list), max(width_list), max(height_list))
    return total_w, box


def paid(total_w_g, box):
    vol = box[0] * box[1] * box[2] / 5000.0
    return max(total_w_g / 1000.0, vol)


def show(title, items, before_items=None):
    w, box = pack(items)
    p = paid(w, box)
    print(f"\n{title}")
    for n, ww, d, q in items:
        print(f"    {q} × {n[:40]:<42} {ww} г, {d[0]}×{d[1]}×{d[2]} см")
    print(f"    → посылка {box[0]}×{box[1]}×{box[2]} см, вес {w} г, "
          f"объёмный {box[0]*box[1]*box[2]/5000:.2f} кг")
    print(f"    → ОПЛАЧИВАЕМЫЙ ВЕС: {p:.2f} кг")
    if before_items:
        wb, bb = pack(before_items)
        pb = paid(wb, bb)
        print(f"    (было до правки: {pb:.2f} кг — разница {p - pb:+.2f} кг)")
    return p


if __name__ == '__main__':
    # реальные данные с сайта
    tea100 = ('Гао Шань Бай Ча, 100 г', 100, DEFAULT_DIMS, 1)
    tea25 = ('Гао Шань Бай Ча, 25 г', 25, DEFAULT_DIMS, 1)
    piala = ('Пиала фарфор 55 мл', 500, (11, 11, 9), 1)
    piala_before = ('Пиала фарфор 55 мл', 0, (0, 0, 0), 1)
    gaiwan = ('Гайвань фарфор 110 мл', 500, (15, 15, 11), 1)
    gaiwan_before = ('Гайвань фарфор 110 мл', 0, (0, 0, 0), 1)
    board = ('Бамбуковая доска 40×26 см', 3000, (44, 30, 10), 1)
    board_before = ('Бамбуковая доска 40×26 см', 0, (0, 0, 0), 1)
    rosewood = ('Доска палисандр 57×35 см', 5985, (61, 39, 10), 1)
    rosewood_before = ('Доска палисандр 57×35 см', 0, (0, 0, 0), 1)
    teapot = ('Чайник исин 180 мл', 500, (19, 16, 13), 1)
    teapot_before = ('Чайник исин 180 мл', 0, (0, 0, 0), 1)

    print('=' * 72)
    print('ЧТО СЧИТАЕТ СДЭК ДЛЯ РАЗНЫХ КОРЗИН')
    print('=' * 72)

    show('Только чай: одна пачка 25 г', [tea25])
    show('Только чай: одна пачка 100 г', [tea100])
    show('Только чай: четыре разных по 100 г',
         [(f'Чай №{i}, 100 г', 100, DEFAULT_DIMS, 1) for i in range(1, 5)])
    show('Чай: одна позиция, количество 4 × 100 г',
         [('Чай, 100 г', 100, DEFAULT_DIMS, 4)])
    show('Одна пиала', [piala], [piala_before])
    show('Шесть одинаковых пиал',
         [('Пиала фарфор 55 мл', 500, (11, 11, 9), 6)],
         [('Пиала фарфор 55 мл', 0, (0, 0, 0), 6)])
    show('Гайвань + 2 пиалы + чай 100 г',
         [gaiwan, ('Пиала фарфор 55 мл', 500, (11, 11, 9), 2), tea100],
         [gaiwan_before, ('Пиала фарфор 55 мл', 0, (0, 0, 0), 2), tea100])
    show('Бамбуковая чайная доска', [board], [board_before])
    show('Доска палисандр — самая тяжёлая позиция', [rosewood], [rosewood_before])
    show('Чайный стол: доска + чайник + 4 пиалы + 2 чая',
         [board, teapot, ('Пиала фарфор 55 мл', 500, (11, 11, 9), 4),
          ('Чай, 100 г', 100, DEFAULT_DIMS, 2)],
         [board_before, teapot_before, ('Пиала фарфор 55 мл', 0, (0, 0, 0), 4),
          ('Чай, 100 г', 100, DEFAULT_DIMS, 2)])
