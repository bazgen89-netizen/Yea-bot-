"""Хранилище рабочих данных.

Диск на Render эфемерный — при передеплое файлы пропадают, поэтому боевое
хранилище это Google Sheets. JsonStorage нужен для локальной разработки и
тестов, а также как аварийный режим, если таблица недоступна.
"""
import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# Листы таблицы и порядок колонок в них
SHEETS: dict[str, list[str]] = {
    "Смены": ["date", "tg_id", "name", "point", "opened_at", "opened_lat", "opened_lon",
              "geo_ok", "photo_id", "closed_at", "hours"],
    "Задачи": ["id", "date", "tg_id", "name", "title", "source", "proof", "due", "status",
               "taken_at", "done_at", "comment", "photo_id", "created_at"],
    "Чек-листы": ["date", "tg_id", "name", "point", "regulation", "item", "done_at",
                  "photo_id", "comment"],
    "Дегустации": ["date", "tg_id", "name", "tea", "notes", "created_at"],
    "Викторина": ["date", "tg_id", "name", "card", "question", "answer", "correct", "asked_at"],
    "Чай дня": ["date", "tg_id", "name", "point", "tea", "brewed_at", "treats", "feedback"],
}


class Storage(Protocol):
    async def append(self, sheet: str, row: dict[str, Any]) -> None: ...
    async def rows(self, sheet: str) -> list[dict[str, Any]]: ...
    async def update_where(self, sheet: str, key: str, value: Any, patch: dict[str, Any]) -> bool: ...


class JsonStorage:
    """Простое файловое хранилище. Один JSON на всё, блокировка на запись."""

    def __init__(self, path: str = "work_data.json"):
        self._path = Path(path)
        self._lock = asyncio.Lock()

    def _read(self) -> dict[str, list[dict]]:
        if not self._path.exists():
            return {name: [] for name in SHEETS}
        data = json.loads(self._path.read_text(encoding="utf-8"))
        for name in SHEETS:
            data.setdefault(name, [])
        return data

    def _write(self, data: dict) -> None:
        self._path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    async def append(self, sheet: str, row: dict[str, Any]) -> None:
        async with self._lock:
            data = self._read()
            data[sheet].append(row)
            self._write(data)

    async def rows(self, sheet: str) -> list[dict[str, Any]]:
        async with self._lock:
            return list(self._read().get(sheet, []))

    async def update_where(self, sheet: str, key: str, value: Any, patch: dict[str, Any]) -> bool:
        async with self._lock:
            data = self._read()
            for row in data.get(sheet, []):
                if str(row.get(key)) == str(value):
                    row.update(patch)
                    self._write(data)
                    return True
            return False


class SheetsStorage:
    """Google Sheets через gspread. Синхронная библиотека, поэтому всё в to_thread."""

    def __init__(self, spreadsheet_id: str, credentials_json: str):
        import gspread
        from google.oauth2.service_account import Credentials

        creds = Credentials.from_service_account_info(
            json.loads(credentials_json),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        self._client = gspread.authorize(creds)
        self._book = self._client.open_by_key(spreadsheet_id)
        self._lock = asyncio.Lock()

    def _worksheet(self, sheet: str):
        """Возвращает лист, создавая его с шапкой при первом обращении."""
        columns = SHEETS[sheet]
        try:
            return self._book.worksheet(sheet)
        except Exception:
            ws = self._book.add_worksheet(title=sheet, rows=1000, cols=len(columns))
            ws.append_row(columns)
            return ws

    async def append(self, sheet: str, row: dict[str, Any]) -> None:
        columns = SHEETS[sheet]
        values = [str(row.get(col, "")) for col in columns]
        async with self._lock:
            await asyncio.to_thread(lambda: self._worksheet(sheet).append_row(values))

    async def rows(self, sheet: str) -> list[dict[str, Any]]:
        async with self._lock:
            return await asyncio.to_thread(lambda: self._worksheet(sheet).get_all_records())

    async def update_where(self, sheet: str, key: str, value: Any, patch: dict[str, Any]) -> bool:
        columns = SHEETS[sheet]

        def _do() -> bool:
            ws = self._worksheet(sheet)
            records = ws.get_all_records()
            for index, record in enumerate(records, start=2):  # строка 1 — шапка
                if str(record.get(key)) == str(value):
                    record.update(patch)
                    ws.update(
                        f"A{index}",
                        [[str(record.get(col, "")) for col in columns]],
                        value_input_option="USER_ENTERED",
                    )
                    return True
            return False

        async with self._lock:
            return await asyncio.to_thread(_do)


def create_storage(spreadsheet_id: str, credentials_json: str, fallback_path: str = "work_data.json") -> Storage:
    """Sheets, если заданы креды; иначе файл — чтобы бот поднялся в любом случае."""
    if spreadsheet_id and credentials_json:
        try:
            storage = SheetsStorage(spreadsheet_id, credentials_json)
            logger.info("📊 Хранилище: Google Sheets %s", spreadsheet_id)
            return storage
        except Exception as e:
            logger.error("❌ Google Sheets недоступны (%s) — перехожу на файл %s", e, fallback_path)
    else:
        logger.warning("⚠️ GOOGLE_SHEET_ID/GOOGLE_CREDENTIALS не заданы — хранилище в файле %s", fallback_path)
    return JsonStorage(fallback_path)
