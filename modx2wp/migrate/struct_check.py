"""
Структурная сверка страниц: старый сайт против нового.

Сравнивает не текст, а скелет разметки — набор узлов с классами.
Так видно пропавшие и лишние блоки, чего проверка мета-тегов
(compare.py) не ловит: заголовки могут совпадать, а целого блока
на странице не быть.

Служебные классы WordPress на body и пунктах меню не считаются:
они неизбежны и на вид не влияют.

Запуск:
    python3 struct_check.py                 # набор типовых страниц
    python3 struct_check.py uslugi/spa/     # конкретные адреса
"""
import re, sys, threading
from html.parser import HTMLParser
import requests

local = threading.local()
def sess(local_site):
    key = 's_local' if local_site else 's_live'
    if not hasattr(local, key):
        s = requests.Session(); s.headers['User-Agent']='Mozilla/5.0 (structure check)'
        if local_site: s.trust_env = False
        setattr(local, key, s)
    return getattr(local, key)

class S(HTMLParser):
    def __init__(self):
        super().__init__(); self.o=[]
        self.skip={'script','style','noscript','meta','link','br','path','svg','g','use','defs'}
    def handle_starttag(self, tag, attrs):
        if tag in self.skip: return
        c=dict(attrs).get('class','').strip()
        if c: self.o.append(f"{tag}.{' '.join(sorted(c.split()))}")

def skel(html):
    s=S(); s.feed(re.sub(r'<!--.*?-->','',html,flags=re.S))
    # служебные классы WordPress на body и пунктах меню не сравниваем
    return {re.sub(r'menu-item-\d+\s*','',x).strip() for x in s.o if not x.startswith('body.')}

pages = sys.argv[1:] or ['', 'komfort-otdyh/', 'komfort-otdyh/sosnovyi/', 'uslugi/spa/',
                         'publication/ob-esoparke.html', 'contacts.html', 'russkaya-banya/']
for uri in pages:
    try:
        live = skel(sess(False).get('https://ecopark33.ru/'+uri, timeout=45).text)
        new  = skel(sess(True).get('http://127.0.0.1:8765/'+uri, timeout=45).text)
    except Exception as e:
        print(f"/{uri}: ошибка {type(e).__name__}"); continue
    miss, extra = sorted(live-new), sorted(new-live)
    mark = 'OK ' if not miss and not extra else '!! '
    print(f"{mark}/{uri or ''}  совпало {len(live&new)}/{len(live|new)}")
    for x in miss[:6]:  print("      нет в теме:", x)
    for x in extra[:6]: print("      лишнее:    ", x)
