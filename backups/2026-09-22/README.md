# Снимок 22.09.2026 — описания посуды перед заменой

`ware-before.json` — оба поля описания всех 139 непищевых карточек до правки.

Откат:

```
python3 - <<'PY'
import json,requests
auth=('admin','<пароль приложения из Google Drive>')
for p in json.load(open('backups/2026-09-22/ware-before.json')):
    r=requests.put(f"https://waystea.ru/wp-json/wc/v3/products/{p['id']}",auth=auth,
        json={'description':p['description'],'short_description':p['short_description']})
    print(p['id'], r.status_code)
PY
```

Генератор текстов — `ware_text.py`, `ware_extra.py`, `ware_build.py`,
`ware_final.py` (запускать `ware_final.py`).
