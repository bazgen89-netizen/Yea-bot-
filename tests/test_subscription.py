import asyncio
import base64
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from teabot.config import Settings
from teabot.handlers import VPN_KEY
from teabot.services.happ import build_routing_profile, routing_deeplink, subscription_body
from teabot.services.vpn import VpnManager, VpnServer
from teabot.subscription import ROUTING_KEY, build_routing_link, handle_subscription

SERVER = VpnServer(host="203.0.113.10", port=443, public_key="PUBKEY",
                   short_id="ab12cd34", sni="www.microsoft.com")


class _FakePTB:
    def __init__(self, manager):
        self.bot_data = {VPN_KEY: manager} if manager else {}


def make_app(tmp_path, manager=None, routing_link="happ://routing/onadd/AAA"):
    """Приложение только с эндпоинтом подписки — без Telegram и сети."""
    manager = manager if manager is not None else VpnManager(SERVER, tmp_path / "users.json")
    app = web.Application()
    app["ptb_app"] = _FakePTB(manager)
    app["settings"] = Settings(
        telegram_bot_token="", groq_api_key="", serper_key="", webhook_url="",
        port=8080, vpn_admins=frozenset(), vpn_profile="ru",
        vpn_users_path=str(tmp_path / "users.json"), vpn_reload_cmd="",
        vpn_sub_title="Мой VPN",
    )
    app[ROUTING_KEY] = routing_link
    app.router.add_get("/sub/{token}", handle_subscription)
    return app, manager


def request_sub(tmp_path, token, **kwargs):
    async def go():
        app, manager = make_app(tmp_path, **kwargs)
        user, _ = await manager.issue(1, "телефон")
        async with TestClient(TestServer(app)) as client:
            resp = await client.get(f"/sub/{token or user['sub_token']}")
            return resp.status, resp.headers, await resp.text(), user
    return asyncio.run(go())


def test_subscription_returns_key_and_happ_headers(tmp_path):
    status, headers, body, user = request_sub(tmp_path, None)
    assert status == 200
    assert headers["content-type"].startswith("text/plain")

    # Заголовки, которые читает Happ
    assert base64.b64decode(headers["profile-title"].removeprefix("base64:")).decode() == "Мой VPN"
    assert headers["profile-update-interval"] == "12"
    assert headers["routing"].startswith("happ://routing/onadd/")
    assert "expire=" in headers["subscription-userinfo"]

    # Те же параметры продублированы в теле, плюс сам ключ
    lines = body.strip().splitlines()
    assert lines[0].startswith("#profile-title: base64:")
    assert any(line.startswith("happ://routing/onadd/") for line in lines)
    assert lines[-1] == f"vless://{user['uuid']}@203.0.113.10:443?type=tcp&security=reality" \
                        f"&sni=www.microsoft.com&fp=chrome&pbk=PUBKEY&sid=ab12cd34" \
                        f"&flow=xtls-rprx-vision#%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD"


def test_unknown_token_is_404(tmp_path):
    status, _, _, _ = request_sub(tmp_path, "нет-такого-токена")
    assert status == 404


def test_revoked_key_stops_being_served(tmp_path):
    async def go():
        app, manager = make_app(tmp_path)
        user, _ = await manager.issue(1, "старый")
        async with TestClient(TestServer(app)) as client:
            before = await client.get(f"/sub/{user['sub_token']}")
            await manager.revoke(user["uuid"])
            after = await client.get(f"/sub/{user['sub_token']}")
            return before.status, after.status
    assert asyncio.run(go()) == (200, 404)


def test_subscription_without_routing_still_serves_keys(tmp_path):
    status, headers, body, user = request_sub(tmp_path, None, routing_link="")
    assert status == 200
    assert "routing" not in headers
    assert "happ://" not in body
    assert user["uuid"] in body


def test_missing_vpn_manager_is_404(tmp_path):
    async def go():
        app, _ = make_app(tmp_path)
        app["ptb_app"] = _FakePTB(None)
        async with TestClient(TestServer(app)) as client:
            return (await client.get("/sub/любой")).status
    assert asyncio.run(go()) == 404


# --- формат Happ ---------------------------------------------------------- #

def test_routing_profile_is_whitelist():
    profile = build_routing_profile("Whitelist RU", ["openai.com"], ["openai"],
                                    ["domain:ru"], ["geoip:ru"])
    # Выход по умолчанию — direct, в туннель уходит только перечисленное
    assert profile["GlobalProxy"] == "false"
    assert profile["ProxySites"] == ["domain:openai.com", "geosite:openai"]
    assert "domain:ru" in profile["DirectSites"]
    assert "geoip:ru" in profile["DirectIp"]
    # Приватные сети всегда мимо туннеля
    assert "192.168.0.0/16" in profile["DirectIp"]


def test_routing_deeplink_roundtrip():
    profile = build_routing_profile("test", ["example.com"], last_updated=1700000000)
    link = routing_deeplink(profile)
    assert link.startswith("happ://routing/onadd/")
    decoded = json.loads(base64.b64decode(link.split("/onadd/", 1)[1]))
    assert decoded == profile
    assert routing_deeplink(profile, activate=False).startswith("happ://routing/add/")


def test_profile_title_is_truncated_to_happ_limit():
    body = subscription_body([], "а" * 40, "")
    title = base64.b64decode(body.splitlines()[0].split("base64:", 1)[1]).decode()
    assert len(title) == 25


def test_build_routing_link_for_every_profile():
    for name in ("ru", "ir", "by", "cn", "global"):
        link = build_routing_link(name)
        profile = json.loads(base64.b64decode(link.split("/onadd/", 1)[1]))
        assert profile["Name"].startswith("Whitelist")
        assert profile["GlobalProxy"] == "false"
        assert profile["ProxySites"], "белый список не может быть пустым"
        assert "geoip:private" not in profile["DirectIp"]  # приватные сети заданы CIDR


def test_build_routing_link_rejects_unknown_profile():
    with pytest.raises(ValueError):
        build_routing_link("нет-такого")
