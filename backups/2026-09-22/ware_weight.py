# -*- coding: utf-8 -*-
"""Оценка веса и габаритов посуды для расчёта доставки СДЭК.

Задача не косметическая. СДЭК берёт оплачиваемый вес как
max(фактический, объём_см³ / 5000). У всех 374 товаров габариты пустые,
а у 139 карточек посуды не заполнен и вес — значит, в расчёт идёт
значение по умолчанию из настроек плагина, а не реальная посылка.
Магазин доплачивает разницу из своего кармана на каждом дальнем городе.

Это ОЦЕНКИ, а не замеры, и так они и записаны в заметки. Считаются
из того, что известно: тип предмета, объём и материал из названия,
размеры, если они в названии указаны. Ошибаться лучше в большую сторону —
занижение оплачивает магазин, завышение видит покупатель и может
отказаться, но денег магазин не теряет. Поэтому коэффициенты взяты
ближе к верхней границе разумного, но без запаса «на всякий случай».

Владельцу достаточно взвесить пять-шесть образцов, чтобы откалибровать
коэффициенты: пиалу, гайвань, фарфоровый чайник, исинский чайник,
бамбуковую доску.
"""
import json, re, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ware_text import volume, dims, material

S = os.path.dirname(os.path.abspath(__file__))


def estimate(name, group, price):
    """Возвращает (вес в граммах, (длина, ширина, высота) в см, на чём основано)."""
    v = volume(name)
    mat = material(name)
    d = [float(x) for x in dims(name)] if dims(name) else []
    n = name.lower()

    # --- чайные доски: считаем из реальных размеров, если они есть в названии
    if group == 'чабань/доска':
        if len(d) >= 3:
            l, w, h = sorted(d, reverse=True)[:3]
            dens = 0.50 if mat == 'дерево' else 0.25   # палисандр плотнее бамбука
            g = int(l * w * h * dens)
            box = (round(l + 4), round(w + 4), round(h + 4))
            return max(g, 600), box, 'размеры из названия'
        g = 2500 if mat == 'дерево' else 1500
        return g, (32, 22, 9), 'типовая доска'

    # --- наборы и сервизы
    if re.search(r'набор|сервиз|чайная пара', n):
        if re.search(r'6 персон|на 6|6 пиал', n):
            return 3200, (38, 28, 18), 'сервиз на 6 персон'
        if re.search(r'5 персон|на 5', n):
            return 2600, (36, 26, 16), 'сервиз на 5 персон'
        if re.search(r'поход|дорожн|чехл|кейс', n):
            return 1400, (26, 18, 12), 'дорожный набор в чехле'
        if re.search(r'инструмент', n):
            return 400, (24, 8, 6), 'набор инструментов'
        return 2000, (34, 24, 15), 'набор посуды'

    # --- поштучные предметы
    if group == 'пиала/чашка':
        g = int(50 + 1.2 * v) if v else 120
        return g, (11, 11, 9), 'по объёму' if v else 'типовая пиала'

    if group == 'гайвань':
        g = int(90 + 1.6 * v) if v else 250
        return g, (15, 15, 11), 'по объёму' if v else 'типовая гайвань'

    if group == 'чайник глина':
        g = int(120 + 1.9 * v) if v else 500
        return g, (19, 16, 13), 'по объёму, глина' if v else 'типовой глиняный чайник'

    if group == 'чайник фарфор/керамика':
        if mat == 'стекло':
            g = int(90 + 1.1 * v) if v else 400
            return g, (19, 16, 14), 'по объёму, стекло' if v else 'стеклянный чайник'
        g = int(120 + 1.8 * v) if v else 450
        return g, (19, 16, 13), 'по объёму' if v else 'типовой чайник'

    if group == 'чахай/сливник':
        g = int(60 + 1.2 * v) if v else 250
        return g, (15, 13, 11), 'по объёму' if v else 'типовой чахай'

    if group == 'чахэ':
        return 120, (14, 10, 6), 'типовое чахэ'

    if group == 'сито/ситечко':
        if mat in ('фарфор', 'керамика'):
            return 150, (12, 11, 7), 'сито с подставкой'
        return 80, (12, 10, 5), 'металлическое сито'

    if group == 'щипцы/инструменты':
        return 60, (18, 6, 4), 'щипцы'

    if group == 'венчик/матча':
        return 60, (12, 12, 12), 'венчик'

    if group == 'термос/колба':
        if 'колба' in n:
            return 200, (10, 10, 22), 'стеклянная колба'
        g = int(350 + 0.35 * v) if v and v > 100 else 700
        return g, (13, 13, 32), 'по объёму' if v and v > 100 else 'типовой термос'

    if group == 'фигурка/чайная игрушка':
        if 'больш' in n:
            return 400, (14, 12, 12), 'крупная фигурка'
        return 180, (11, 10, 10), 'фигурка'

    # --- всё прочее
    if 'нож' in n:
        return 120, (22, 6, 4), 'нож для пуэра'
    if 'полотенц' in n:
        return 80, (16, 12, 4), 'полотенце'
    return 200, (15, 12, 10), 'оценка по умолчанию'


def paid_weight(g, box):
    """Оплачиваемый вес по правилу СДЭК: max(фактический, объём/5000)."""
    vol = box[0] * box[1] * box[2] / 5000.0   # в кг
    return max(g / 1000.0, vol)


if __name__ == '__main__':
    api = json.load(open(S + '/allprod.json'))
    groups = json.load(open(S + '/ware_groups.json'))
    group_of = {}
    for g, ids in groups.items():
        for i in ids:
            group_of[i] = g
    tea = set(int(x) for x in open(S + '/tea_ids.txt'))
    ware = [x for x in api if x['id'] not in tea]

    out = {}
    for x in ware:
        g, box, why = estimate(x['name'], group_of.get(x['id'], 'прочее'), x.get('price'))
        out[x['id']] = {'weight': g, 'box': box, 'why': why,
                        'paid': round(paid_weight(g, box), 2), 'name': x['name']}
    json.dump(out, open(S + '/ware_weights.json', 'w'), ensure_ascii=False)

    print(f'посчитано: {len(out)}')
    # как было: пустой вес + пустые габариты -> плагин подставляет своё умолчание
    print('\nсамые тяжёлые — где потери были наибольшими:')
    for i, r in sorted(out.items(), key=lambda kv: -kv[1]['paid'])[:12]:
        print(f"   {r['paid']:5.2f} кг  ({r['weight']:5} г, {r['box'][0]}×{r['box'][1]}×{r['box'][2]} см)"
              f"  {r['name'][:46]}")
    print('\nраспределение оплачиваемого веса:')
    import collections
    band = collections.Counter()
    for r in out.values():
        p = r['paid']
        band['до 0,5 кг' if p <= .5 else 'до 1 кг' if p <= 1 else
             'до 2 кг' if p <= 2 else 'до 5 кг' if p <= 5 else 'свыше 5 кг'] += 1
    for k in ('до 0,5 кг', 'до 1 кг', 'до 2 кг', 'до 5 кг', 'свыше 5 кг'):
        if band[k]:
            print(f'   {k:12} {band[k]:3} товаров')
