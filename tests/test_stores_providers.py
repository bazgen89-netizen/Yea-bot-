"""Разбор ответов площадок — без сети, на подменённой HTTP-сессии."""
import pytest

from teabot.stores.models import GOOGLE, TWOGIS, YANDEX
from teabot.stores.providers.google import GoogleBusinessProvider, _star_rating
from teabot.stores.providers.twogis import TwoGisProvider
from teabot.stores.providers.yandex import YandexMapsProvider
from teabot.stores.registry import StoreRegistry


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status = status

    async def json(self):
        return self._payload

    async def text(self):
        return str(self._payload)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Отдаёт заготовленный ответ на любой GET/POST и запоминает вызовы."""

    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.requests = []

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return FakeResponse(self.payload, self.status)

    def post(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return FakeResponse(self.payload, self.status)


def store(platform, **platform_data):
    reg = StoreRegistry.from_dict({"stores": [{
        "slug": "msk", "name": "Waystea", "city": "Москва",
        "address": "ул. Примерная, 1",
        "platforms": {platform: platform_data},
    }]})
    return reg.get("msk")


# --- Яндекс ------------------------------------------------------------------

YANDEX_PAYLOAD = {"features": [
    {"properties": {"CompanyMetaData": {
        "id": "111", "name": "Waystea", "address": "Москва, ул. Примерная, 1",
        "url": "https://waystea.ru",
        "Phones": [{"formatted": "+7 900 000-00-00"}],
        "Hours": {"text": "ежедневно, 10:00–20:00"},
    }}},
]}


@pytest.mark.asyncio
async def test_yandex_card_parsed():
    provider = YandexMapsProvider("key", FakeSession(YANDEX_PAYLOAD))

    card = await provider.fetch_card(store(YANDEX, id="111"))

    assert card.ok
    assert card.name == "Waystea"
    assert card.phone == "+7 900 000-00-00"
    assert card.hours == "ежедневно, 10:00–20:00"
    assert card.rating is None  # Яндекс не отдаёт рейтинг через API


@pytest.mark.asyncio
async def test_yandex_picks_matching_org_id():
    payload = {"features": [
        {"properties": {"CompanyMetaData": {"id": "999", "name": "Чужой"}}},
        {"properties": {"CompanyMetaData": {"id": "111", "name": "Waystea"}}},
    ]}
    provider = YandexMapsProvider("key", FakeSession(payload))

    card = await provider.fetch_card(store(YANDEX, id="111"))

    assert card.name == "Waystea"


@pytest.mark.asyncio
async def test_yandex_without_key_returns_error_card():
    provider = YandexMapsProvider("", FakeSession(YANDEX_PAYLOAD))

    card = await provider.fetch_card(store(YANDEX, id="111"))

    assert not card.ok and "YANDEX_MAPS_KEY" in card.error


@pytest.mark.asyncio
async def test_yandex_http_error_becomes_card_error():
    provider = YandexMapsProvider("key", FakeSession({}, status=403))

    card = await provider.fetch_card(store(YANDEX, id="111"))

    assert not card.ok and "403" in card.error


# --- 2ГИС --------------------------------------------------------------------

TWOGIS_PAYLOAD = {"result": {"items": [{
    "name": "Waystea",
    "full_address_name": "Москва, ул. Примерная, 1",
    "contact_groups": [{"contacts": [
        {"type": "website", "value": "waystea.ru"},
        {"type": "phone", "text": "+7 900 000-00-00", "value": "+79000000000"},
    ]}],
    "schedule": {"Mon": {"working_hours": [{"from": "10:00", "to": "20:00"}]},
                 "Sun": {"working_hours": [{"from": "11:00", "to": "18:00"}]}},
    "reviews": {"general_rating": 4.9, "general_review_count": 137},
}]}}


@pytest.mark.asyncio
async def test_twogis_card_parsed():
    provider = TwoGisProvider("key", FakeSession(TWOGIS_PAYLOAD))

    card = await provider.fetch_card(store(TWOGIS, id="222"))

    assert card.ok
    assert card.rating == 4.9 and card.reviews_count == 137
    assert card.phone == "+7 900 000-00-00"
    assert card.hours == "Пн 10:00–20:00, Вс 11:00–18:00"
    assert card.url == "https://2gis.ru/firm/222"


@pytest.mark.asyncio
async def test_twogis_empty_result_is_error_card():
    provider = TwoGisProvider("key", FakeSession({"result": {"items": []}}))

    card = await provider.fetch_card(store(TWOGIS, id="222"))

    assert not card.ok and "не найден" in card.error


@pytest.mark.asyncio
async def test_twogis_reviews_parsed():
    payload = {"reviews": [{
        "id": 555, "text": "Отличный чай", "rating": 5,
        "date_created": "2026-07-01T10:00:00",
        "user": {"name": "Иван"},
        "official_answer": {"text": "Спасибо!"},
    }]}
    provider = TwoGisProvider("key", FakeSession(payload), reviews_key="rkey")

    reviews = await provider.fetch_reviews(store(TWOGIS, id="222"))

    assert len(reviews) == 1
    assert reviews[0].author == "Иван"
    assert reviews[0].answered
    assert reviews[0].key == "2gis:msk:555"


@pytest.mark.asyncio
async def test_twogis_reviews_error_returns_empty():
    provider = TwoGisProvider("key", FakeSession({}, status=401), reviews_key="rkey")

    assert await provider.fetch_reviews(store(TWOGIS, id="222")) == []


# --- Google ------------------------------------------------------------------

GOOGLE_PAYLOAD = {
    "displayName": {"text": "Waystea"},
    "formattedAddress": "Москва, ул. Примерная, 1",
    "nationalPhoneNumber": "+7 900 000-00-00",
    "rating": 4.7,
    "userRatingCount": 88,
    "googleMapsUri": "https://maps.google.com/?cid=1",
    "currentOpeningHours": {"weekdayDescriptions": ["Понедельник: 10–20"]},
    "reviews": [{
        "name": "places/X/reviews/abc",
        "rating": 5,
        "text": {"text": "Прекрасный пуэр"},
        "authorAttribution": {"displayName": "Anna"},
        "publishTime": "2026-06-01T12:00:00Z",
    }],
}


@pytest.mark.asyncio
async def test_google_card_parsed():
    provider = GoogleBusinessProvider("key", FakeSession(GOOGLE_PAYLOAD))

    card = await provider.fetch_card(store(GOOGLE, id="ChIJ1"))

    assert card.ok
    assert card.rating == 4.7 and card.reviews_count == 88
    assert card.hours == "Понедельник: 10–20"


@pytest.mark.asyncio
async def test_google_places_reviews_used_without_owner_access():
    provider = GoogleBusinessProvider("key", FakeSession(GOOGLE_PAYLOAD))

    reviews = await provider.fetch_reviews(store(GOOGLE, id="ChIJ1"))

    assert [r.review_id for r in reviews] == ["abc"]
    assert not provider.supports_replies


def test_google_owner_access_flags():
    provider = GoogleBusinessProvider(
        "key", FakeSession({}), client_id="c", client_secret="s", refresh_token="r"
    )

    assert provider.owner_access and provider.supports_replies


@pytest.mark.asyncio
async def test_google_reply_requires_owner_id():
    from teabot.stores.providers.base import ReplyNotSupported

    provider = GoogleBusinessProvider(
        "key", FakeSession({}), client_id="c", client_secret="s", refresh_token="r"
    )

    with pytest.raises(ReplyNotSupported):
        await provider.reply_to_review(store(GOOGLE, id="ChIJ1"), "abc", "спасибо")


@pytest.mark.asyncio
async def test_google_access_token_cached():
    session = FakeSession({"access_token": "tok", "expires_in": 3600})
    provider = GoogleBusinessProvider(
        "", session, client_id="c", client_secret="s", refresh_token="r"
    )

    assert await provider._access_token() == "tok"
    await provider._access_token()

    assert len(session.requests) == 1  # второй раз токен взят из памяти


def test_star_rating_words():
    assert _star_rating("FIVE") == 5.0
    assert _star_rating("STAR_RATING_UNSPECIFIED") is None
