#!/usr/bin/env python3
"""
Сверяет старый сайт с новым страница за страницей.

Главная проверка при переносе: совпадают ли заголовок, описание,
правило индексации и H1. Расхождение в них — это просевшие позиции,
поэтому сверяем все страницы разом, а не выборочно глазами.

Запуск:
    python3 compare.py --bundle bundle.json \\
        --old https://ecopark33.ru --new http://127.0.0.1:8765
"""

import argparse
import html
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

TAGS = {
    'title':       r'<title>(.*?)</title>',
    'description': r'<meta\s+name="description"\s+content="(.*?)"',
    'robots':      r'<meta\s+name="robots"\s+content="(.*?)"',
    'h1':          r'<h1[^>]*>(.*?)</h1>',
    'canonical':   r'<link\s+rel="canonical"\s+href="(.*?)"',
}

local = threading.local()


def session():
    if not hasattr(local, 's'):
        local.s = requests.Session()
        # Заголовки HTTP кодируются latin-1 — только ASCII.
        local.s.headers['User-Agent'] = 'Mozilla/5.0 (migration check)'
    return local.s


def clean(value):
    value = re.sub(r'<[^>]+>', '', value or '')
    value = html.unescape(value)
    return re.sub(r'\s+', ' ', value).strip()


def extract(url, proxies=None):
    try:
        r = session().get(url, timeout=45, proxies=proxies)
    except Exception as exc:
        return {'error': type(exc).__name__}
    if r.status_code != 200:
        return {'error': f'HTTP {r.status_code}'}
    out = {}
    for key, pattern in TAGS.items():
        m = re.search(pattern, r.text, re.S | re.I)
        out[key] = clean(m.group(1)) if m else ''
    # путь канонического адреса — домены у сайтов разные
    out['canonical'] = re.sub(r'^https?://[^/]+', '', out['canonical'])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', default='bundle.json')
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', required=True)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    bundle = json.load(open(args.bundle, encoding='utf-8'))
    pages = [p for p in bundle['pages'] if p['published']]

    # Новый сайт обычно локальный — его тянем мимо прокси.
    no_proxy = {'http': None, 'https': None} if '127.0.0.1' in args.new or 'localhost' in args.new else None

    def check(page):
        uri = page['uri']
        old = extract(args.old.rstrip('/') + '/' + uri)
        new = extract(args.new.rstrip('/') + '/' + uri, proxies=no_proxy)
        diffs = []
        if 'error' in old or 'error' in new:
            diffs.append(('доступность', old.get('error', 'ok'), new.get('error', 'ok')))
        else:
            for key in TAGS:
                if old[key] != new[key]:
                    diffs.append((key, old[key], new[key]))
        return uri, diffs

    with ThreadPoolExecutor(args.workers) as ex:
        results = list(ex.map(check, pages))

    clean_pages = [u for u, d in results if not d]
    print(f'сверено страниц: {len(results)}, совпали полностью: {len(clean_pages)}')

    by_field = {}
    for uri, diffs in results:
        for field, _, _ in diffs:
            by_field[field] = by_field.get(field, 0) + 1
    if by_field:
        print('\nрасхождения по полям:')
        for field, count in sorted(by_field.items(), key=lambda x: -x[1]):
            print(f'  {field:<14} {count}')

    shown = 0
    for uri, diffs in results:
        if not diffs:
            continue
        if not args.verbose and shown >= 12:
            print(f'\n… и ещё {len([1 for _, d in results if d]) - shown} страниц с расхождениями '
                  f'(запустите с --verbose)')
            break
        print(f'\n/{uri}')
        for field, old_v, new_v in diffs:
            print(f'  {field}:')
            print(f'    было:  {old_v[:150]}')
            print(f'    стало: {new_v[:150]}')
        shown += 1

    return 0 if len(clean_pages) == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
