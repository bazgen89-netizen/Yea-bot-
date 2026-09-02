import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _load(name: str):
    path = ROOT / "vpn" / "tools" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gen_client = _load("gen_client_config")
gen_server = _load("gen_server_config")

LINK = ("vless://11111111-2222-3333-4444-555555555555@203.0.113.10:443"
        "?type=tcp&security=reality&sni=www.microsoft.com&fp=chrome"
        "&pbk=PUBKEY&sid=ab12cd34&flow=xtls-rprx-vision#ключ")


def test_parse_vless_link():
    s = gen_client.parse_vless_link(LINK)
    assert s["uuid"] == "11111111-2222-3333-4444-555555555555"
    assert s["host"] == "203.0.113.10" and s["port"] == 443
    assert s["public_key"] == "PUBKEY" and s["short_id"] == "ab12cd34"
    assert s["label"] == "ключ"


def test_parse_link_rejects_other_schemes():
    with pytest.raises(SystemExit):
        gen_client.parse_vless_link("https://example.com")


@pytest.mark.parametrize("profile", ["ru", "ir", "by", "cn", "global"])
def test_all_profiles_produce_valid_xray_config(profile):
    services = gen_client.load_services()
    prof = gen_client.load_profile(profile)
    domains, geosite = gen_client.collect_domains(prof, services)
    cfg = gen_client.xray_config(prof, domains, geosite,
                                 gen_client.parse_vless_link(LINK), 10808, 10809)
    json.dumps(cfg)  # сериализуется без ошибок

    rules = cfg["routing"]["rules"]
    tags = [r["outboundTag"] for r in rules]
    # Whitelist: правило proxy стоит раньше всех direct-правил
    assert "proxy" in tags
    assert tags.index("proxy") < len(tags) - 1
    # Последнее правило — «всё остальное напрямую»
    assert rules[-1]["outboundTag"] == "direct"


def test_local_domains_are_direct_for_ru():
    services = gen_client.load_services()
    prof = gen_client.load_profile("ru")
    domains, geosite = gen_client.collect_domains(prof, services)
    cfg = gen_client.xray_config(prof, domains, geosite, None, 10808, 10809)
    direct_rule = next(r for r in cfg["routing"]["rules"]
                       if r.get("outboundTag") == "direct" and "domain" in r)
    assert "domain:ru" in direct_rule["domain"]
    assert "domain:gosuslugi.ru" in direct_rule["domain"]

    proxy_rule = next(r for r in cfg["routing"]["rules"] if r["outboundTag"] == "proxy")
    assert "domain:openai.com" in proxy_rule["domain"]
    assert "domain:youtube.com" in proxy_rule["domain"]


def test_geosite_tags_only_with_flag():
    services = gen_client.load_services()
    prof = gen_client.load_profile("ru")
    _, without = gen_client.collect_domains(prof, services, with_geosite=False)
    _, with_tags = gen_client.collect_domains(prof, services, with_geosite=True)
    assert without == []
    assert "openai" in with_tags


def test_unknown_group_fails_loudly():
    services = gen_client.load_services()
    with pytest.raises(ValueError):
        gen_client.collect_domains({}, services, groups=["нет-такой"])


def test_unknown_profile_fails_loudly():
    with pytest.raises(ValueError):
        gen_client.load_profile("нет-такого")


def test_cli_turns_bad_profile_into_exit_code():
    with pytest.raises(SystemExit):
        gen_client.main(["--profile", "нет-такого"])


def test_happ_format_is_produced():
    files = gen_client.main.__globals__["build"](
        _Args(profile="ru", groups=None, link=LINK, format="happ",
              with_geosite=False, socks_port=10808, http_port=10809,
              happ_name="Тест", out=None))
    assert "happ-routing-ru.json" in files
    profile = json.loads(files["happ-routing-ru.json"])
    assert profile["Name"] == "Тест" and profile["GlobalProxy"] == "false"
    assert files["happ-routing-ru.link.txt"].startswith("happ://routing/onadd/")


class _Args:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_singbox_config_declares_rulesets_for_geosite():
    services = gen_client.load_services()
    prof = gen_client.load_profile("ru")
    domains, geosite = gen_client.collect_domains(prof, services, with_geosite=True)
    cfg = gen_client.singbox_config(prof, domains, geosite,
                                    gen_client.parse_vless_link(LINK), 10808)
    tags = {rs["tag"] for rs in cfg["route"]["rule_set"]}
    used = {t for rule in cfg["route"]["rules"] for t in rule.get("rule_set", [])}
    assert used and used <= tags  # каждая ссылка на rule_set объявлена
    assert cfg["route"]["final"] == "direct"


def test_server_config_lists_only_active_users():
    users = [
        {"uuid": "u1", "label": "a"},
        {"uuid": "u2", "label": "b", "revoked": True},
    ]
    cfg = gen_server.server_config(
        [u for u in users if not u.get("revoked")],
        port=443, private_key="PRIV", sni="www.microsoft.com",
        short_ids=["ab12"], dest="www.microsoft.com:443",
    )
    clients = cfg["inbounds"][0]["settings"]["clients"]
    assert [c["id"] for c in clients] == ["u1"]
    reality = cfg["inbounds"][0]["streamSettings"]["realitySettings"]
    assert reality["privateKey"] == "PRIV" and reality["serverNames"] == ["www.microsoft.com"]
    # Сервер не должен работать прокси во внутреннюю сеть
    assert {"type": "field", "ip": ["geoip:private"], "outboundTag": "block"} \
        in cfg["routing"]["rules"]


def test_load_users_skips_revoked(tmp_path):
    path = tmp_path / "users.json"
    path.write_text(json.dumps({"users": [
        {"uuid": "a"}, {"uuid": "b", "revoked": True},
    ]}), encoding="utf-8")
    assert [u["uuid"] for u in gen_server.load_users(path)] == ["a"]
