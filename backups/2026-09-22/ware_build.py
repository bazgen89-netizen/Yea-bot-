# -*- coding: utf-8 -*-
"""Сборка описаний посуды. Формат тот же, что у чая: 🫖-заголовок, вводный
абзац, характеристики списком, разделы по существу, уход, FAQ."""
import json, re, os, hashlib, collections
from ware_text import (volume, dims, material, maker, decor,
                       gaiwan_body, bowl_body, pot_body, chahai_body,
                       TYPE_BODY, CARE)
from ware_extra import pairing, peers, price_note

S = os.path.dirname(os.path.abspath(__file__))
ware = {x['id']: x for x in json.load(open(S + '/ware.json'))}
groups = json.load(open(S + '/ware_groups.json'))

GROUP_OF = {}
for g, ids in groups.items():
    for i in ids:
        GROUP_OF[i] = g

# человеческое название типа для заголовка и текста
KIND = {
    'гайвань': 'гайвань', 'пиала/чашка': 'пиала', 'чайник глина': 'чайник',
    'чайник фарфор/керамика': 'чайник', 'чахай/сливник': 'чахай', 'чахэ': 'чахэ',
    'чабань/доска': 'чайная доска', 'сито/ситечко': 'сито',
    'щипцы/инструменты': 'инструменты', 'венчик/матча': 'венчик',
    'термос/колба': 'термос', 'фигурка/чайная игрушка': 'чайная фигурка',
    'чайная пара/набор': 'набор', 'хранение': 'хранение',
    'подставка/салфетка': 'подставка', 'прочее': 'предмет',
}


VOLUMES_BY_GROUP = {}
for _g, _ids in groups.items():
    VOLUMES_BY_GROUP[_g] = [volume(ware[i]['name']) for i in _ids if i in ware]


def clean_title(name):
    """Название без служебных пометок — для заголовка."""
    t = re.sub(r'\s*[\(\[]?\s*(арт\.?\s*\d+|партия\s*\d+)\s*[\)\]]?\s*$', '', name, flags=re.I)
    t = re.sub(r'\s*[—–-]\s*(арт\.?\s*\d+|партия\s*\d+)\s*$', '', t, flags=re.I)
    return t.strip().strip('"«»')


def lead(x, kind, v, mat, mk, dec):
    """Вводный абзац — только из фактов карточки."""
    name = clean_title(x['name'])
    parts = []
    if mat:
        parts.append({'исин': 'исинская глина', 'глина': 'глина', 'фарфор': 'фарфор',
                      'керамика': 'керамика', 'стекло': 'стекло', 'бамбук': 'бамбук',
                      'дерево': 'дерево', 'серебро': 'серебро',
                      'металл': 'металл'}[mat])
    if v:
        parts.append(f'{v} мл')
    d = dims(x['name'])
    if d and not v:
        parts.append(' × '.join(d) + ' см')
    spec = ', '.join(parts)

    s = f'<p><strong>{name}</strong>'
    if spec:
        s += f' — {kind}, {spec}.'
    else:
        s += f' — {kind}.'
    if dec:
        s += ' ' + ('Оформление: ' + ', '.join(dec) + '.')
    if mk:
        s += f' Производитель указан на карточке: {mk}.'
    s += ' Купить с доставкой по России — в нашем магазине во Владимире.</p>'
    return s


def specs(x, kind, v, mat, mk, dec):
    rows = [f'<li><strong>Назначение:</strong> {kind}</li>']
    if mat:
        rows.append('<li><strong>Материал:</strong> ' +
                    {'исин': 'исинская глина (цзыша)', 'глина': 'глина', 'фарфор': 'фарфор',
                     'керамика': 'керамика, глазурь', 'стекло': 'термостойкое стекло',
                     'бамбук': 'бамбук', 'дерево': 'дерево', 'серебро': 'серебро',
                     'металл': 'металл'}[mat] + '</li>')
    if v:
        rows.append(f'<li><strong>Объём:</strong> {v} мл</li>')
    d = dims(x['name'])
    if d:
        rows.append('<li><strong>Размеры:</strong> ' + ' × '.join(d) + ' см</li>')
    if dec:
        rows.append('<li><strong>Оформление:</strong> ' + ', '.join(dec) + '</li>')
    if mk:
        rows.append(f'<li><strong>Производитель:</strong> {mk}</li>')
    if x.get('price'):
        rows.append(f"<li><strong>Цена:</strong> {x['price']} ₽</li>")
    return '<h2>📌 Характеристики</h2>\n<ul>\n' + '\n'.join(rows) + '\n</ul>'


def body(x, g, v, mat):
    if g == 'гайвань':
        return gaiwan_body(v)
    if g == 'пиала/чашка':
        if re.search(r'набор|сервиз', x['name'], re.I):
            return TYPE_BODY['набор'] + '\n' + bowl_body(v)
        return bowl_body(v)
    if g in ('чайник глина', 'чайник фарфор/керамика'):
        return pot_body(v, mat)
    if g == 'чахай/сливник':
        return chahai_body(v)
    if g == 'чахэ':
        return TYPE_BODY['чахэ']
    if g == 'сито/ситечко':
        return TYPE_BODY['сито']
    if g == 'щипцы/инструменты':
        return TYPE_BODY['щипцы']
    if g == 'чабань/доска':
        return TYPE_BODY['чабань']
    if g == 'фигурка/чайная игрушка':
        if re.search(r'сервиз|набор', x['name'], re.I):
            return TYPE_BODY['набор']
        return TYPE_BODY['фигурка']
    if g == 'термос/колба':
        return TYPE_BODY['термос']
    if g == 'венчик/матча':
        return TYPE_BODY['венчик']
    if g == 'чайная пара/набор':
        return TYPE_BODY['набор']
    n = x['name'].lower()
    if 'нож' in n:
        return TYPE_BODY['нож']
    if 'полотенц' in n:
        return TYPE_BODY['полотенце']
    return TYPE_BODY['набор'] if 'набор' in n else ''


def faq(x, g, v, mat, dec):
    """Вопросы подбираются под конкретный предмет, а не одни на всех."""
    q = []
    if g == 'гайвань':
        q.append(('Не обожгусь ли я при сливе?',
                  'Первые разы — вероятно. Держат гайвань за край крышки и за борт '
                  'чаши, а не за бока: борт остаётся холоднее. Наливайте воду, '
                  'не доходя сантиметра до края, и навык придёт за несколько чаепитий.'))
        q.append(('Гайвань или чайник — что брать первым?',
                  'Гайвань. Она не впитывает аромат, годится под любой чай и стоит '
                  'дешевле. Чайник имеет смысл брать, когда уже понятно, какой '
                  'чай вы пьёте постоянно.'))
    if g == 'пиала/чашка' and v and v <= 60:
        q.append(('Почему такая маленькая?',
                  'Так устроено гунфу-заваривание: чай раскрывается за много коротких '
                  'проливов, и каждый пьётся горячим. Большая пиала успевает остыть, '
                  'и половина аромата теряется.'))
    if g == 'пиала/чашка':
        q.append(('Можно пить из неё обычный чай из пакетика?',
                  'Можно, посуда не запрещает. Но тонкий край и малый объём сделаны '
                  'под листовой чай: именно на нём разница с кружкой заметна.'))
    if mat == 'исин':
        q.append(('Правда ли, что исин нельзя мыть?',
                  'Нельзя мыть с моющим средством. Горячей водой — нужно, после каждого '
                  'чаепития, иначе останется спитой лист и появится затхлость.'))
        q.append(('Под какой чай его закрепить?',
                  'Под тот, который вы пьёте чаще всего. Плотные тёмные чаи — шу пуэр, '
                  'тёмный улун — дают патину быстрее. Смешивать зелёный и пуэр в одном '
                  'чайнике не стоит: глина запомнит оба.'))
    if mat in ('керамика', 'фарфор') and any('роспись' in d for d in dec):
        q.append(('Не сотрётся ли роспись?',
                  'Ручная роспись под глазурью держится годами. Стирают её абразивные '
                  'порошки и жёсткие губки — мойте мягкой стороной и тёплой водой.'))
    if mat == 'стекло':
        q.append(('Не лопнет ли от кипятка?',
                  'Термостойкое стекло рассчитано на кипяток. Опасен не жар, '
                  'а перепад: не ставьте горячее на холодный камень и не наливайте '
                  'кипяток в посуду из холодильника.'))
    if g == 'чахай/сливник' and v:
        q.append(('Какого объёма брать чахай?',
                  f'Не меньше заварочного сосуда. Этот — на {v} мл, то есть подойдёт '
                  f'к гайвани или чайнику до {v} мл включительно. Если чахай меньше, '
                  'часть настоя останется на листе и передержится.'))
    if g == 'чабань/доска':
        q.append(('Сколько воды помещается в поддон?',
                  'Зависит от модели, но правило одно: выливать после каждого чаепития. '
                  'Переполненный поддон легко расплескать, а застоявшаяся вода пахнет.'))
    if g == 'термос/колба':
        q.append(('Чай не перестоит за день?',
                  'Перестоит, если лист останется в воде. Пользуйтесь фильтром или '
                  'заваривайте отдельно и переливайте готовый настой.'))
    if re.search(r'набор|сервиз', x['name'], re.I):
        q.append(('Что докупать к набору?',
                  'Обычно чабань — доску со сливом: без неё воду от прогрева посуды '
                  'девать некуда. И щипцы, если в наборе их нет.'))
    q.append(('Как отмыть чайный налёт?',
              'Пищевая сода на влажной мягкой губке, затем тёплая вода. '
              'Абразивные порошки и металлические мочалки оставляют царапины, '
              'в которых налёт потом задерживается ещё сильнее.'))
    out = ['<h2>Часто задаваемые вопросы</h2>']
    for a, b in q:
        out.append(f'<p><strong>{a}</strong><br />{b}</p>')
    return '\n'.join(out)


def build(x):
    g = GROUP_OF.get(x['id'], 'прочее')
    kind = KIND.get(g, 'предмет')
    v = volume(x['name'])
    mat = material(x['name'])
    mk = maker(x['name'])
    dec = decor(x['name'])
    title = clean_title(x['name'])

    blocks = [f'<h2>🫖 {title}</h2>',
              lead(x, kind, v, mat, mk, dec),
              '<hr />',
              specs(x, kind, v, mat, mk, dec),
              '<hr />']
    b = body(x, g, v, mat)
    if b:
        blocks += [b, '<hr />']
    pr = pairing(kind, v, mat)
    if pr:
        blocks += [pr, '<hr />']
    pe = peers(x, kind, v, VOLUMES_BY_GROUP.get(g, []))
    if pe:
        blocks += [pe, '<hr />']
    pn = price_note(kind, x.get('price'), mat, dec)
    if pn:
        blocks += [pn, '<hr />']
    if mat and CARE.get(mat):
        blocks += ['<h2>Уход</h2>', CARE[mat], '<hr />']
    blocks.append(faq(x, g, v, mat, dec))
    return '\n'.join(blocks)


if __name__ == '__main__':
    out = {}
    for i, x in ware.items():
        out[i] = build(x)
    json.dump(out, open(S + '/ware_texts.json', 'w'), ensure_ascii=False)

    wc = lambda h: len(re.sub(r'<[^>]+>', ' ', h).split())
    lens = sorted(wc(t) for t in out.values())
    print('собрано описаний:', len(out))
    print(f'слов: мин {lens[0]}, медиана {lens[len(lens)//2]}, макс {lens[-1]}')

    norm = lambda h: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h)).strip().lower()
    gsets = collections.defaultdict(list)
    for i, t in out.items():
        gsets[hashlib.md5(norm(t).encode()).hexdigest()].append(i)
    dups = [v for v in gsets.values() if len(v) > 1]
    print('групп полностью одинаковых текстов:', len(dups))
    for d in dups:
        print('   ', [(i, ware[i]['name'][:38]) for i in d])
