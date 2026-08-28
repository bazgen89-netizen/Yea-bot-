#!/usr/bin/env python3
"""
Скачивает медиафайлы со старого сайта, сохраняя пути.

Картинки остаются по прежним адресам (/content/...), поэтому ссылки
в тексте страниц и в полях менять не нужно, а поисковики не теряют
уже проиндексированные изображения.

Запуск:
    python3 fetch_media.py --bundle bundle.json --base https://ecopark33.ru/ --out ./media

Дальше содержимое ./media кладётся в корень нового сайта.
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', default='bundle.json')
    ap.add_argument('--base', default='https://ecopark33.ru/')
    ap.add_argument('--out', default='./media')
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()

    bundle = json.load(open(args.bundle, encoding='utf-8'))
    files = bundle.get('media', [])
    base = args.base.rstrip('/') + '/'

    session = requests.Session()
    session.headers['User-Agent'] = 'Mozilla/5.0 (миграция сайта)'

    ok, skipped, missing, failed = [], [], [], []

    def grab(rel):
        dst = os.path.join(args.out, rel)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            skipped.append(rel)
            return
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        for attempt in range(3):
            try:
                r = session.get(base + rel, timeout=60)
                if r.status_code == 200:
                    with open(dst, 'wb') as f:
                        f.write(r.content)
                    ok.append(rel)
                    return
                if r.status_code == 404:
                    missing.append(rel)
                    return
            except Exception:
                time.sleep(2 * (attempt + 1))
        failed.append(rel)

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(grab, files))

    total = sum(os.path.getsize(os.path.join(dp, f))
                for dp, _, fs in os.walk(args.out) for f in fs)
    print(f'скачано: {len(ok)}, уже было: {len(skipped)}')
    print(f'нет на сервере (404): {len(missing)}')
    print(f'не удалось: {len(failed)}')
    print(f'объём: {total / 1024 / 1024:.1f} МБ, папка: {args.out}')

    if missing:
        print('\nОтсутствуют на старом сайте — ссылки битые уже сейчас:')
        for rel in missing[:20]:
            print('  ' + rel)
    if failed:
        print('\nНе скачались, повторите запуск:')
        for rel in failed[:20]:
            print('  ' + rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
