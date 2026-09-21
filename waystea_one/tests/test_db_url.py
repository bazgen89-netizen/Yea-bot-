"""Приведение строки подключения к виду, который понимает asyncpg
(app/db.py). Строку копируют из панели хостинга как есть — руками её
править никто не должен."""
from app.db import normalize_database_url


def test_render_internal_url():
    assert normalize_database_url(
        "postgresql://waystea:pass@dpg-abc123-a/waystea"
    ) == "postgresql+asyncpg://waystea:pass@dpg-abc123-a/waystea"


def test_heroku_style_postgres_scheme():
    assert normalize_database_url(
        "postgres://user:pass@host:5432/db"
    ) == "postgresql+asyncpg://user:pass@host:5432/db"


def test_neon_url_with_sslmode_and_channel_binding():
    """Neon отдаёт libpq-строку: asyncpg падает и на sslmode, и на channel_binding."""
    result = normalize_database_url(
        "postgresql://user:pass@ep-cool-123.eu-central-1.aws.neon.tech/waystea"
        "?sslmode=require&channel_binding=require"
    )
    assert result.startswith("postgresql+asyncpg://")
    assert "channel_binding" not in result
    assert "sslmode" not in result
    assert result.endswith("?ssl=require")


def test_sslmode_disable_is_dropped_not_translated():
    result = normalize_database_url("postgresql://u:p@host/db?sslmode=disable")
    assert "ssl" not in result.split("?")[-1]


def test_already_correct_url_is_left_alone():
    url = "postgresql+asyncpg://waystea:waystea@db:5432/waystea"
    assert normalize_database_url(url) == url


def test_unknown_params_survive():
    result = normalize_database_url("postgresql://u:p@host/db?application_name=waystea")
    assert "application_name=waystea" in result


def test_empty_url_is_not_an_error():
    assert normalize_database_url("") == ""
