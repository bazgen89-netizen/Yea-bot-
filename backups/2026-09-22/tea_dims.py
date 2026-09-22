# -*- coding: utf-8 -*-
"""Габариты упаковки чая — чтобы количество в корзине не завышало цену доставки.

Зачем. Плагин СДЭК при количестве больше одного умножает САМУЮ КОРОТКУЮ
сторону коробки на количество (исходник getPackagesData, строка 267).
У чая габариты пустые, плагин подставляет 10×10×10, и четыре пачки одного
чая превращаются в «коробку» 10×40×10 — объёмный вес 0,8 кг при
фактических 400 граммах. Те же четыре пачки, но разных сортов, дают 0,4 кг.
Покупатель платит вдвое за одно и то же.

Лечится тем, что у чая появляются настоящие размеры пакета: тогда
даже умноженная на количество короткая сторона даёт объём меньше
фактического веса, и в расчёт идёт вес — как и должно быть.

Размеры взяты как у обычного зип-пакета с фольгой под соответствующую
навеску, прессованные формы — по их собственному формату.
"""
import json, os, re

S = os.path.dirname(os.path.abspath(__file__))


def pack_dims(grams, name=''):
    """(длина, ширина, высота) в см для навески в граммах."""
    n = (name or '').lower()

    # прессованные формы — свой формат
    if re.search(r'блин|357|\bбин\b', n) and grams >= 300:
        return (21, 21, 4)          # блин в обёртке
    if 'кирпич' in n:
        # кирпичи бывают от 250 г до килограмма — размер по навеске
        return (24, 15, 8) if grams > 500 else (18, 11, 6)
    if re.search(r'точа|то ча|точа', n):
        return (12, 12, 7)
    if 'корзин' in n:
        return (24, 20, 14)         # Лю Бао в бамбуковой корзинке

    if grams <= 25:
        return (10, 7, 3)
    if grams <= 50:
        return (12, 8, 4)
    if grams <= 75:
        return (13, 9, 4)
    if grams <= 100:
        return (14, 9, 5)
    if grams <= 250:
        return (17, 12, 6)
    if grams <= 400:
        return (20, 14, 7)
    if grams <= 600:
        return (23, 16, 9)
    return (26, 19, 11)             # килограмм и больше


if __name__ == '__main__':
    api = json.load(open(S + '/allprod.json'))
    tea = set(int(x) for x in open(S + '/tea_ids.txt'))
    out = {'simple': [], 'variable_parent': []}
    for x in api:
        if x['id'] not in tea:
            continue
        w = (x.get('weight') or '').strip()
        if x.get('type') == 'simple' and w not in ('', '0'):
            d = pack_dims(float(w), x['name'])
            out['simple'].append({'id': x['id'], 'name': x['name'],
                                  'weight': w, 'dims': d})
        elif x.get('type') == 'variable':
            out['variable_parent'].append({'id': x['id'], 'name': x['name']})
    json.dump(out, open(S + '/tea_dims.json', 'w'), ensure_ascii=False)
    print('простых чаёв с весом:', len(out['simple']))
    print('вариативных родителей:', len(out['variable_parent']))
    print('\nпримеры простых:')
    for r in out['simple'][:10]:
        print(f"   {r['weight']:>6} г -> {r['dims'][0]}×{r['dims'][1]}×{r['dims'][2]} см   {r['name'][:46]}")
