"""Чистые помощники VPN-обработчиков и генератор QR (без Telegram)."""
import io

import pytest

from teabot.handlers.vpn import _format_key, _is_admin, _sub_url
from teabot.services import qr


class _Ctx:
    def __init__(self, **bot_data):
        self.bot_data = bot_data


@pytest.mark.parametrize("base,token,expected", [
    ("https://bot.example.com", "abc123", "https://bot.example.com/sub/abc123"),
    ("https://bot.example.com/", "abc123", "https://bot.example.com/sub/abc123"),
    ("", "abc123", ""),           # публичный URL не задан
    ("https://bot.example.com", "", ""),  # у ключа ещё нет токена
])
def test_sub_url(base, token, expected):
    assert _sub_url(_Ctx(vpn_sub_base=base), token) == expected


def test_is_admin():
    ctx = _Ctx(vpn_admins={1, 2})
    assert _is_admin(ctx, 1)
    assert not _is_admin(ctx, 3)
    assert not _is_admin(_Ctx(), 1)


def test_format_key_escapes_html_in_label():
    text = _format_key("vless://x", "<b>злой</b>", "https://e.com/sub/t")
    assert "&lt;b&gt;злой&lt;/b&gt;" in text
    assert "<b>злой</b>" not in text


def test_format_key_without_subscription_still_shows_direct_link():
    text = _format_key("vless://x", "ключ", "")
    assert "vless://x" in text
    assert "подписки" not in text


def test_qr_png_is_a_png():
    png = qr.qr_png("https://example.com/sub/abc")
    if not qr.available():
        pytest.skip("qrcode не установлен")
    assert png is not None
    assert png.startswith(b"\x89PNG\r\n\x1a\n")


def test_qr_png_returns_none_without_library(monkeypatch):
    monkeypatch.setattr(qr, "qrcode", None)
    assert qr.qr_png("https://example.com") is None
