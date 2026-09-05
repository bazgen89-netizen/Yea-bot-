#!/usr/bin/env python3
"""
Собирает выгрузку из MODX в один файл bundle.json для импорта в WordPress.

На вход берёт то, что сняли с менеджера:
    resources/<id>.json  — ресурсы (процессор Resource/Get)
    tvs/<id>.json        — значения TV (разобранная форма редактирования)

На выходе — bundle.json со списком страниц в порядке «родитель раньше
ребёнка» и картой медиафайлов, которые нужно перенести.

Запуск:  python3 build_bundle.py --src <папка выгрузки> --out bundle.json
"""

import argparse
import json
import os
import re
import sys

# Шаблон MODX -> тип записи WordPress
TEMPLATE_MAP = {
    2: 'page',      # Главная страница
    1: 'page',      # Начальный шаблон (разделы)
    6: 'page',      # Стандартная страница
    3: 'cottage',   # Номерной фонд
    5: 'service',   # Услуги
    4: 'event',     # Страница событий
}

# Ресурсы, которые в WordPress не нужны: их заменяет сама CMS или тема.
SKIP_MODX_IDS = {
    2,   # req.html — обработчик форм, теперь inc/forms.php
    40,  # sitemap.xml — теперь SEO-плагин
}

# Статические чанки MODX, которые вставлялись прямо в текст страниц.
# В WordPress они становятся записями типа «Блок» и правятся в админке.
STATIC_CHUNKS = ['mesblock', 'otzyv', 'banprogram', 'promoblock', 'subscribe', 'interesting']

# TV, которые переносятся как есть: тема выводит их сама (inc/seo.php,
# карта сайта), а если позже поставят SEO-плагин — он их перекроет.
# Ничего не отбрасываем: правило индексации и приоритеты уже настроены
# по страницам, и терять эту работу при переносе нельзя.
SKIP_TVS = set()

# Флажки MODX хранят строку 'en'; в WordPress это обычная единица.
CHECKBOX_TVS = {'all_footer_mode', 'pg_nobg', 'ev_main'}

# Поля-повторители: MIGX хранит JSON-массив строк.
REPEATER_TVS = {'pg_topslider', 'nomera_topslider'}

# Базовый путь медиаисточника MODX (id -> префикс пути от корня сайта).
SOURCE_PREFIX = {'1': '', '2': 'content/'}


def load_dir(path, key='object'):
    out = {}
    for name in os.listdir(path):
        if not name.endswith('.json'):
            continue
        data = json.load(open(os.path.join(path, name), encoding='utf-8'))
        obj = data.get(key, data) if isinstance(data, dict) else data
        out[int(name[:-5])] = obj
    return out


def media_path(value, source='1'):
    """Приводит путь картинки к адресу от корня сайта."""
    if not value:
        return ''
    value = value.replace('\\/', '/').lstrip('/')
    if re.match(r'^https?://', value):
        return value
    prefix = SOURCE_PREFIX.get(str(source), '')
    if prefix and not value.startswith(prefix):
        value = prefix + value
    return value


def convert_tvs(raw, media):
    """Переводит значения TV в поля темы."""
    out = {}
    for name, value in (raw or {}).items():
        if name in SKIP_TVS or value in ('', None, [], {}):
            continue

        if name in CHECKBOX_TVS:
            out[name] = '1'

        elif name in REPEATER_TVS:
            try:
                rows = json.loads(value) if isinstance(value, str) else value
            except (ValueError, TypeError):
                continue
            slides = []
            for row in rows or []:
                # у MIGX флажок en отмечает показ слайда
                if str(row.get('en', 'en')) != 'en':
                    continue
                path = media_path(row.get('img', ''), '2')
                if path:
                    slides.append({'img': path})
                    media.add(path)
            if slides:
                out[name] = slides

        elif isinstance(value, dict):           # картинка
            path = media_path(value.get('path', ''), value.get('source', '1'))
            if path:
                out[name] = path
                media.add(path)

        else:
            out[name] = value
    return out


def parse_home_slider(html, media):
    """
    Разбирает чанк sliderHome на слайды.

    В MODX слайдер главной правился прямо в коде чанка. В теме это
    поле-повторитель, поэтому разбираем разметку на составляющие —
    иначе слайды остались бы недоступны для редактирования.
    """
    # Закомментированные слайды в чанке есть — их не переносим.
    html = re.sub(r'<!--.*?-->', '', html or '', flags=re.S)

    slides = []
    for block in re.findall(r'<div class="swiper-slide">(.*?)</div>\s*</div>\s*</div>', html, re.S):
        img = re.search(r'background-image:url\(([^)]+)\)', block)
        title = re.search(r'<p class="h1">(.*?)</p>', block, re.S)
        text = re.search(r'</p>\s*<p>(.*?)</p>', block, re.S)
        link = re.search(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.S)
        if not img:
            continue
        path = media_path(img.group(1).strip('\'" '), '1')
        media.add(path)
        slides.append({
            'img':   path,
            'title': re.sub(r'\s+', ' ', title.group(1)).strip() if title else '',
            'text':  re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', text.group(1))).strip() if text else '',
            'url':   link.group(1).strip() if link else '',
            'btn':   re.sub(r'<[^>]+>', '', link.group(2)).strip() if link else '',
        })
    return slides


def parse_menus(head, footer):
    """
    Разбирает меню, зашитые в чанки `head` и `footer`.

    В MODX пункты меню были прописаны прямо в разметке. В WordPress это
    обычные меню, которые правятся в админке, поэтому вытаскиваем их
    из чанков, а не заводим заново руками — так ничего не потеряется.
    """
    # Закомментированные пункты в чанках есть — их не переносим.
    head = re.sub(r'<!--.*?-->', '', head or '', flags=re.S)
    footer = re.sub(r'<!--.*?-->', '', footer or '', flags=re.S)

    def links(fragment):
        out = []
        for m in re.finditer(r'<li[^>]*>\s*<a([^>]*)>(.*?)</a>', fragment or '', re.S):
            attrs, label = m.group(1), re.sub(r'<[^>]+>', '', m.group(2)).strip()
            href = re.search(r'href="([^"]*)"', attrs)
            if label and href:
                out.append({'title': label, 'url': href.group(1).strip()})
        return out

    menus = []

    # Верхнее меню — блок .menuwr в шапке
    top = re.search(r'<div class="menuwr">(.*?)</div>', head or '', re.S)
    if top:
        menus.append({'location': 'primary', 'name': 'Верхнее меню', 'items': links(top.group(1))})

    # Мобильное меню — три колонки .menublock
    locations = ['mobile_guest', 'mobile_usl', 'mobile_park']
    blocks = re.findall(r'<div class="menublock">\s*<p>(.*?)</p>(.*?)</div>', head or '', re.S)
    for i, (title, body) in enumerate(blocks[:3]):
        menus.append({
            'location': locations[i],
            'name': 'Мобильное меню — ' + re.sub(r'<[^>]+>', '', title).strip(),
            'items': links(body),
        })

    # Подвал
    bottom = re.search(r'<div class="menuwr">(.*?)</div>', footer or '', re.S)
    if bottom:
        menus.append({'location': 'footer', 'name': 'Меню в подвале', 'items': links(bottom.group(1))})

    # Правовые ссылки в подвале лежат вне списка
    legal = re.search(r'<a href="\[\[~42\]\]">(.*?)</a>\s*<a href="\[\[~51\]\]">(.*?)</a>', footer or '', re.S)
    if legal:
        menus.append({'location': 'legal', 'name': 'Правовые ссылки', 'items': [
            {'title': legal.group(1).strip(), 'url': '[[~42]]'},
            {'title': legal.group(2).strip(), 'url': '[[~51]]'},
        ]})

    return [m for m in menus if m['items']]


def collect_media(html, media):
    """Собирает пути к файлам, на которые ссылается текст страницы."""
    for m in re.finditer(r'(?:content|assets)/[A-Za-z0-9._/-]+\.'
                         r'(?:jpg|jpeg|png|gif|webp|svg|pdf|docx?|xlsx?)', html or ''):
        media.add(m.group(0).lstrip('/'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='папка с resources/ и tvs/')
    ap.add_argument('--out', default='bundle.json')
    args = ap.parse_args()

    resources = load_dir(os.path.join(args.src, 'resources'))
    tvs = {}
    tv_dir = os.path.join(args.src, 'tvs')
    if os.path.isdir(tv_dir):
        tvs = load_dir(tv_dir, key=None)

    media = set()
    pages = {}

    # Статические чанки -> блоки
    blocks = []
    home_slider = []
    chunk_html = {}
    chunk_dir = os.path.join(args.src, 'src', 'chunks')
    if os.path.isdir(chunk_dir):
        for name in os.listdir(chunk_dir):
            if not name.endswith('.json'):
                continue
            obj = json.load(open(os.path.join(chunk_dir, name), encoding='utf-8')).get('object', {})
            chunk_html[obj.get('name')] = obj.get('snippet') or ''
            if obj.get('name') == 'sliderHome':
                home_slider = parse_home_slider(obj.get('snippet') or '', media)
            if obj.get('name') in STATIC_CHUNKS:
                html = obj.get('snippet') or ''
                collect_media(html, media)
                blocks.append({
                    'slug':    obj['name'],
                    'title':   obj.get('description') or obj['name'],
                    'content': html,
                })

    for rid, r in resources.items():
        if rid in SKIP_MODX_IDS:
            continue
        template = int(r.get('template') or 0)
        post_type = TEMPLATE_MAP.get(template, 'page')
        content = r.get('content') or ''
        collect_media(content, media)

        pages[rid] = {
            'modx_id':   rid,
            'parent':    int(r.get('parent') or 0),
            'post_type': post_type,
            'title':     r.get('pagetitle') or '',
            'longtitle': r.get('longtitle') or '',
            'excerpt':   r.get('introtext') or '',
            'content':   content,
            'uri':       (r.get('uri') or '').lstrip('/'),
            'alias':     r.get('alias') or '',
            'menuindex': int(r.get('menuindex') or 0),
            'published': bool(int(r.get('published') or 0)),
            'hidemenu':  bool(int(r.get('hidemenu') or 0)),
            'created':   r.get('createdon') or '',
            'edited':    r.get('editedon') or '',
            'description': r.get('description') or '',
            'tvs':       convert_tvs(tvs.get(rid), media),
        }

    # Слайдер главной жил в чанке, а не в поле ресурса.
    front = int(1)
    if home_slider and front in pages:
        pages[front]['tvs']['home_slider'] = home_slider

    # Родитель обязан импортироваться раньше ребёнка.
    ordered, placed = [], set()

    def place(rid, seen=()):
        if rid in placed or rid not in pages:
            return
        if rid in seen:          # защита от цикла в дереве
            return
        parent = pages[rid]['parent']
        if parent and parent in pages:
            place(parent, seen + (rid,))
        placed.add(rid)
        ordered.append(pages[rid])

    for rid in sorted(pages):
        place(rid)

    bundle = {
        'site':  'ecopark33.ru',
        'source': 'MODX Revolution 3.0.3-pl',
        'front_page': 1,          # id ресурса MODX, который станет главной
        'blocks': blocks,
        'menus': parse_menus(chunk_html.get('head'), chunk_html.get('footer')),
        'pages': ordered,
        'media': sorted(media),
    }
    json.dump(bundle, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    by_type = {}
    for p in ordered:
        by_type[p['post_type']] = by_type.get(p['post_type'], 0) + 1
    print(f'страниц: {len(ordered)}  {by_type}')
    print(f'блоков: {len(blocks)}, слайдов на главной: {len(home_slider)}')
    print(f'меню: {len(bundle["menus"])} '
          f'({sum(len(m["items"]) for m in bundle["menus"])} пунктов)')
    print(f'медиафайлов: {len(media)}')
    print(f'записано: {args.out}')


if __name__ == '__main__':
    sys.exit(main())
