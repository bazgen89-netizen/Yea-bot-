# Снимок 21.09.2026 — семь карточек чая перед перезаписью описаний

`seven-cards-before.json` — состояние обоих полей описания до правки.

Карточки: 12623 Мэнхайский Кирпич Пэн Чэн разлом, 12618 Лун Цюань Хун Ча,
12590 У И Ба Сян Бай Жуй Сян, 12527 Дянь Хун Цзинь Ло,
12695 ГАБА Алишань Extra, 12684 ГАБА Алишань, 12640 ГАБА-Шэн.

Откат — вернуть `description` и `short_description` из файла:

```
python3 - <<'PY'
import json,requests
auth=('admin','<пароль приложения из Google Drive>')
for p in json.load(open('backups/2026-09-21/seven-cards-before.json')):
    r=requests.put(f"https://waystea.ru/wp-json/wc/v3/products/{p['id']}",auth=auth,
        json={'description':p['description'],'short_description':p['short_description']})
    print(p['id'], r.status_code)
PY
```
