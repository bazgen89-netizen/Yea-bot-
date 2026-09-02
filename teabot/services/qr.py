"""QR-код для ссылки — самый быстрый способ добавить конфиг на телефон.

Библиотека qrcode опциональна: если её нет в окружении, бот продолжает
работать и просто не прикладывает картинку.
"""
import io
import logging

logger = logging.getLogger(__name__)

try:
    import qrcode
except ImportError:  # pragma: no cover — зависит от окружения
    qrcode = None


def available() -> bool:
    return qrcode is not None


def qr_png(data: str, box_size: int = 8, border: int = 2) -> bytes | None:
    """PNG с QR-кодом или None, если библиотека недоступна."""
    if qrcode is None:
        return None
    try:
        img = qrcode.make(data, box_size=box_size, border=border)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:  # некорректные данные, слишком длинная строка
        logger.error(f"QR не сгенерирован: {e}")
        return None
