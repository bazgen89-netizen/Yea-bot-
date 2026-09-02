import asyncio
import json

import pytest

from teabot.config import parse_admin_ids
from teabot.services.vpn import VpnManager, VpnServer

SERVER = VpnServer(
    host="203.0.113.10", port=443, public_key="PUBKEY",
    short_id="ab12cd34", sni="www.microsoft.com",
)


@pytest.fixture
def manager(tmp_path):
    return VpnManager(SERVER, tmp_path / "users.json")


def test_link_contains_reality_parameters():
    link = SERVER.link("11111111-2222-3333-4444-555555555555", "домашний")
    assert link.startswith("vless://11111111-2222-3333-4444-555555555555@203.0.113.10:443")
    for part in ("security=reality", "pbk=PUBKEY", "sid=ab12cd34",
                 "sni=www.microsoft.com", "flow=xtls-rprx-vision"):
        assert part in link
    # Кириллица в названии не должна ломать ссылку
    assert " " not in link and link.endswith("#%D0%B4%D0%BE%D0%BC%D0%B0%D1%88%D0%BD%D0%B8%D0%B9")


def test_server_configured_requires_host_and_key():
    assert SERVER.configured
    assert not VpnServer(host="", port=443, public_key="k", short_id="", sni="s").configured
    assert not VpnServer(host="h", port=443, public_key="", short_id="", sni="s").configured


def test_issue_creates_unique_keys(manager, tmp_path):
    first, _ = asyncio.run(manager.issue(1, "ноут"))
    second, _ = asyncio.run(manager.issue(2, "телефон"))
    assert first["uuid"] != second["uuid"]

    stored = json.loads((tmp_path / "users.json").read_text(encoding="utf-8"))["users"]
    assert [u["tg_id"] for u in stored] == [1, 2]


def test_issue_respects_per_user_limit(tmp_path):
    manager = VpnManager(SERVER, tmp_path / "users.json", max_keys_per_user=2)
    asyncio.run(manager.issue(7, "a"))
    asyncio.run(manager.issue(7, "b"))
    user, status = asyncio.run(manager.issue(7, "c"))
    assert user is None
    assert "лимит" in status
    # Лимит на пользователя, а не на сервер
    other, _ = asyncio.run(manager.issue(8, "d"))
    assert other is not None


def test_revoke_hides_key_but_keeps_history(manager, tmp_path):
    user, _ = asyncio.run(manager.issue(5, "старый"))
    ok, _ = asyncio.run(manager.revoke(user["uuid"]))
    assert ok
    assert asyncio.run(manager.list_keys(5)) == []

    stored = json.loads((tmp_path / "users.json").read_text(encoding="utf-8"))["users"]
    assert stored[0]["revoked"] is True and stored[0]["revoked_at"]


def test_revoke_by_owner_only(manager):
    user, _ = asyncio.run(manager.issue(5, "чужой"))
    ok, status = asyncio.run(manager.revoke(user["uuid"], tg_id=6))
    assert not ok and "не найден" in status
    assert asyncio.run(manager.list_keys(5))  # ключ на месте


def test_revoke_unknown_uuid(manager):
    ok, status = asyncio.run(manager.revoke("нет-такого"))
    assert not ok and "не найден" in status


def test_list_keys_without_filter_returns_all(manager):
    asyncio.run(manager.issue(1, "a"))
    asyncio.run(manager.issue(2, "b"))
    assert len(asyncio.run(manager.list_keys())) == 2


def test_missing_users_file_is_empty(tmp_path):
    manager = VpnManager(SERVER, tmp_path / "нет" / "users.json")
    assert asyncio.run(manager.list_keys()) == []


def test_reload_command_runs(tmp_path):
    marker = tmp_path / "reloaded"
    manager = VpnManager(SERVER, tmp_path / "users.json",
                         reload_cmd=f"touch {marker}")
    _, status = asyncio.run(manager.issue(1, "a"))
    assert marker.exists()
    assert status.startswith("✅")


def test_reload_failure_is_reported(tmp_path):
    manager = VpnManager(SERVER, tmp_path / "users.json", reload_cmd="exit 3")
    user, status = asyncio.run(manager.issue(1, "a"))
    assert user is not None  # ключ выдан, даже если рестарт не удался
    assert "код 3" in status


@pytest.mark.parametrize("raw,expected", [
    ("", set()),
    ("123", {123}),
    ("123, 456", {123, 456}),
    ("123,,мусор,456", {123, 456}),
    ("  789  ", {789}),
])
def test_parse_admin_ids(raw, expected):
    assert parse_admin_ids(raw) == expected
