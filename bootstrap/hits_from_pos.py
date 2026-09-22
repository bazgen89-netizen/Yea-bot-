# -*- coding: utf-8 -*-
"""Хиты продаж из кассы: резервная копия приложения → блок на waystea.ru.

Зачем. Блок «Хиты продаж» на главной считался по заказам интернет-магазина —
83 заказа за четыре года. Настоящая торговля идёт в трёх точках во Владимире,
и её видит только приложение «WAYSTEA · склад и касса». База приложения лежит
SQLite в браузере владельца, снаружи её не прочитать: сервера у программы нет.
Зато есть кнопка «Скачать резервную копию» — файл `waystea-<дата>.sqlite`.

Этот скрипт берёт такой файл, считает топ и кладёт его в опцию WordPress
`waystea_hits_pos`. Сниппет Code Snippets 193 читает эту опцию раньше, чем
свой расчёт по заказам сайта, так что правок в коде сайта не требуется.

    python3 bootstrap/hits_from_pos.py waystea-2026-09-22.sqlite

Схема базы взята из `warehouse/src/db/schema.ts` ветки
`claude/warehouse-management-app-i7jnvr`:

    sales(id, discount, total, cost_total, payment, created_at)
    sale_items(id, sale_id, product_id, qty, price, cost_price)
    products(id, name, sku, barcode, category_id, unit, ..., archived)

Считаем **в скольких чеках встретился товар**, а не сколько единиц ушло:
у чая единица — грамм, и складывать граммы с штуками нельзя. Это же правило
действует в расчёте по заказам сайта, см. `knowledge/waystea/Хиты продаж.md`.
"""
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.request

WP = 'https://waystea.ru/wp-json'
LIMIT = 24          # столько выводит блок на главной: три ряда по восемь
MONTHS = 12         # за какой срок считать; 0 — за всё время


def norm(s):
    """Название к виду, по которому можно сравнивать касcу и сайт."""
    s = unicodedata.normalize('NFKD', (s or '').lower())
    s = s.replace('ё', 'е')
    s = re.sub(r'[^0-9a-zа-я]+', ' ', s)
    # навеска и год к сравнению отношения не имеют
    s = re.sub(r'\b\d+\s*(г|гр|грамм|кг|мл|шт)\b', ' ', s)
    s = re.sub(r'\b(19|20)\d\d\b', ' ', s)
    return ' '.join(s.split())


def top_from_db(path, limit, months):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    where = ''
    if months:
        where = "WHERE s.created_at >= date('now', '-%d months')" % months
    rows = con.execute("""
        SELECT p.id, p.name, p.unit,
               COUNT(DISTINCT si.sale_id) AS cheks,
               SUM(si.qty * si.price) / 1000.0 AS vyruchka
          FROM sale_items si
          JOIN sales s    ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          %s
         GROUP BY p.id
         ORDER BY cheks DESC, vyruchka DESC
         LIMIT ?
    """ % where, (limit * 4,)).fetchall()
    con.close()
    return rows


def site_products(auth):
    """Опубликованные товары сайта: id, имя, категории."""
    out = []
    for page in range(1, 6):
        url = ('%s/wc/v3/products?per_page=100&page=%d&status=publish'
               '&_fields=id,name,categories,stock_status' % (WP, page))
        req = urllib.request.Request(url)
        req.add_header('Authorization', 'Basic ' + auth)
        with urllib.request.urlopen(req, timeout=90) as r:
            part = json.loads(r.read())
        if not part:
            break
        out += part
    return out


def match(pos_rows, site, limit):
    """Сопоставление по нормализованному названию, затем по вхождению."""
    by_name = {}
    for p in site:
        if p.get('stock_status') != 'instock':
            continue
        if any(c['slug'] == 'posuda' for c in p.get('categories', [])):
            continue          # блок про чай
        by_name.setdefault(norm(p['name']), p['id'])

    ids, seen, misses = [], set(), []
    for row in pos_rows:
        n = norm(row['name'])
        pid = by_name.get(n)
        if pid is None:
            for k, v in by_name.items():
                if n and (n in k or k in n):
                    pid = v
                    break
        if pid is None:
            misses.append(row['name'])
            continue
        if pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
        print('  %3d чеков  %9.0f ₽  %-46s -> %d'
              % (row['cheks'], row['vyruchka'], row['name'][:46], pid))
        if len(ids) >= limit:
            break
    return ids, misses


def push(ids, auth):
    """Кладём список в опцию через временный сниппет? Нет — через WP REST.

    Опция пишется отдельным маршрутом, который поднимает сниппет 193:
    у него есть POST /waystea/v1/hits с проверкой прав администратора.
    Если маршрута нет — печатаем список, его можно вставить руками.
    """
    body = json.dumps({'ids': ids}).encode()
    req = urllib.request.Request(WP + '/waystea/v1/hits', data=body, method='POST')
    req.add_header('Authorization', 'Basic ' + auth)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Укажите файл: python3 bootstrap/hits_from_pos.py waystea-*.sqlite')
    auth = os.environ.get('WP_BASIC')
    rows = top_from_db(sys.argv[1], LIMIT, MONTHS)
    print('позиций в кассе за период: %d' % len(rows))
    site = site_products(auth)
    print('опубликованных товаров на сайте: %d\n' % len(site))
    ids, misses = match(rows, site, LIMIT)
    print('\nсопоставлено: %d' % len(ids))
    if misses:
        print('не нашлось на сайте (%d): %s' % (len(misses), ', '.join(misses[:10])))
    if auth:
        print(push(ids, auth))
    else:
        print('WP_BASIC не задан — список для ручной вставки:')
        print(ids)
