"""Хостинг картинок: проверки до загрузки и разговор с медиатекой сайта."""
import asyncio

import pytest

from teabot.social.media import MediaError, WordPressMedia, check_for_instagram


def run(coro):
    return asyncio.run(coro)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status

    async def json(self, content_type=None):
        return self.payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(self.payload, self.status)


def media(session, **over):
    creds = {"site_url": "https://waystea.ru/", "user": "ways",
             "app_password": "pass word", "session": session}
    creds.update(over)
    return WordPressMedia(**creds)


# --------------------------------------------------- проверки до загрузки

def test_instagram_accepts_only_jpeg():
    assert "JPEG" in check_for_instagram(b"x", "image/png")
    assert check_for_instagram(b"x", "image/jpeg") == ""


def test_instagram_size_limit():
    assert "8 МБ" in check_for_instagram(b"x" * (9 * 1024 * 1024), "image/jpeg")


def test_filename_is_made_safe():
    assert WordPressMedia._safe_name("фото поста") == "фото-поста.jpg"
    assert WordPressMedia._safe_name("../../etc/passwd") == "etc-passwd.jpg"
    assert WordPressMedia._safe_name("a.JPG") == "a.JPG"


# --------------------------------------------------------------- загрузка

def test_upload_returns_public_link():
    session = FakeSession({"source_url": "https://waystea.ru/wp-content/foto.jpg"})
    url = run(media(session).upload(b"data", "foto.jpg"))

    assert url == "https://waystea.ru/wp-content/foto.jpg"
    call = session.calls[0]
    assert call["url"] == "https://waystea.ru/wp-json/wp/v2/media"
    assert call["headers"]["Authorization"].startswith("Basic ")
    assert 'filename="foto.jpg"' in call["headers"]["Content-Disposition"]


def test_upload_without_settings_says_what_to_set():
    with pytest.raises(MediaError) as e:
        run(media(FakeSession({}), user="", app_password="").upload(b"data"))
    assert "WP_URL" in str(e.value)


def test_site_error_is_reported():
    session = FakeSession({"message": "Извините, вам нельзя загружать файлы"}, status=401)
    with pytest.raises(MediaError) as e:
        run(media(session).upload(b"data"))
    assert "401" in str(e.value)


def test_missing_link_in_answer_is_an_error():
    with pytest.raises(MediaError) as e:
        run(media(FakeSession({"id": 5})).upload(b"data"))
    assert "ссылку" in str(e.value)


def test_availability_depends_on_settings():
    assert media(FakeSession({})).available
    assert not media(FakeSession({}), app_password="").available
