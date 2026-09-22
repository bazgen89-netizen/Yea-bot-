"""Помощник подключения Google: сборка ссылки и сопоставление точек."""
import importlib.util
import pathlib

spec = importlib.util.spec_from_file_location(
    "google_setup", pathlib.Path(__file__).resolve().parent.parent / "scripts/google_setup.py")
gs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gs)


def test_auth_url_asks_for_offline_access():
    url = gs.auth_url("client-123")
    assert "client_id=client-123" in url
    assert "access_type=offline" in url      # без этого refresh-токена не будет
    assert "prompt=consent" in url           # иначе токен придёт только в первый раз
    assert "business.manage" in url


def test_auth_returns_to_local_port():
    # Способ с кодом из браузера Google заблокировал в 2022 году —
    # ответ должен возвращаться на localhost
    assert gs.REDIRECT.startswith("http://localhost:")
    assert "oob" not in gs.auth_url("client-123")
    assert "localhost" in gs.auth_url("client-123")


def test_branch_is_guessed_by_address():
    assert gs.guess_branch("Waystea", "г. Владимир, ул. Гагарина, 5А") == "gagarina"
    assert gs.guess_branch("Waystea", "Дворянская улица, 27Ак1") == "gastromarket"
    assert gs.guess_branch("Waystea", "проспект Строителей, 9Б") == "cheryomushki"


def test_unknown_address_is_left_for_a_human():
    assert gs.guess_branch("Waystea", "Москва, Тверская, 1") == ""
    line = gs.locations_line([("accounts/1/locations/99", "Waystea", "Тверская, 1")])
    assert line == "?:accounts/1/locations/99"


def test_locations_line_matches_env_format():
    line = gs.locations_line([
        ("accounts/1/locations/11", "Waystea", "ул. Гагарина, 5А"),
        ("accounts/1/locations/33", "Waystea", "пр-т Строителей, 9Б"),
    ])
    assert line == "gagarina:accounts/1/locations/11,cheryomushki:accounts/1/locations/33"
