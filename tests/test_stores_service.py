import pytest

from teabot.cache import TTLCache
from teabot.stores import StoreRegistry, StoresService
from teabot.stores.models import TWOGIS, YANDEX, Review, Store, StoreCard
from teabot.stores.providers.base import MapsProvider, ReplyNotSupported

REGISTRY = StoreRegistry.from_dict({
    "stores": [{
        "slug": "msk", "name": "Waystea", "city": "Москва",
        "platforms": {"yandex": {"id": "111"}, "2gis": {"id": "222"}},
    }]
})


class FakeProvider(MapsProvider):
    """Провайдер без сети: отдаёт заготовленные данные или падает по требованию."""

    def __init__(self, platform, *, reviews=(), fail=False, ready=True,
                 supports_reviews=False):
        super().__init__(session=None)
        self.platform = platform
        self.title = platform
        self.supports_reviews = supports_reviews
        self._reviews = list(reviews)
        self._fail = fail
        self._ready = ready
        self.calls = 0

    def configured(self):
        return self._ready

    async def fetch_card(self, store):
        self.calls += 1
        if self._fail:
            raise RuntimeError("площадка недоступна")
        return StoreCard(platform=self.platform, store_slug=store.slug,
                         name=store.name, rating=4.8)

    async def fetch_reviews(self, store, limit=10):
        if self._fail:
            raise RuntimeError("отзывы недоступны")
        return self._reviews[:limit]

    async def health_check(self):
        return "✅"


def build(providers):
    return StoresService(REGISTRY, providers, TTLCache(ttl=60, max_size=10))


def review(platform, review_id, created_at):
    return Review(platform=platform, store_slug="msk", review_id=review_id,
                  text="текст", created_at=created_at)


@pytest.mark.asyncio
async def test_cards_collected_from_all_platforms():
    service = build([FakeProvider(YANDEX), FakeProvider(TWOGIS)])

    cards = await service.cards_for(REGISTRY.get("msk"))

    assert {c.platform for c in cards} == {YANDEX, TWOGIS}
    assert all(c.ok for c in cards)


@pytest.mark.asyncio
async def test_failing_platform_becomes_card_with_error():
    service = build([FakeProvider(YANDEX, fail=True), FakeProvider(TWOGIS)])

    cards = {c.platform: c for c in await service.cards_for(REGISTRY.get("msk"))}

    assert cards[YANDEX].error is not None
    assert cards[TWOGIS].ok  # сбой одной площадки не ломает остальные


@pytest.mark.asyncio
async def test_cards_are_cached():
    provider = FakeProvider(YANDEX)
    service = build([provider])
    store = REGISTRY.get("msk")

    await service.cards_for(store)
    await service.cards_for(store)

    assert provider.calls == 1


@pytest.mark.asyncio
async def test_reviews_merged_and_sorted_by_date():
    service = build([
        FakeProvider(YANDEX, supports_reviews=True,
                     reviews=[review(YANDEX, "a", "2026-01-01")]),
        FakeProvider(TWOGIS, supports_reviews=True,
                     reviews=[review(TWOGIS, "b", "2026-03-01")]),
    ])

    reviews = await service.reviews_for(REGISTRY.get("msk"))

    assert [r.review_id for r in reviews] == ["b", "a"]


@pytest.mark.asyncio
async def test_reviews_skip_unconfigured_and_failing_platforms():
    service = build([
        FakeProvider(YANDEX, supports_reviews=True, ready=False,
                     reviews=[review(YANDEX, "a", "2026-01-01")]),
        FakeProvider(TWOGIS, supports_reviews=True, fail=True),
    ])

    assert await service.reviews_for(REGISTRY.get("msk")) == []


@pytest.mark.asyncio
async def test_reply_falls_back_to_not_supported():
    service = build([FakeProvider(YANDEX)])

    with pytest.raises(ReplyNotSupported):
        await service.reply_to_review("msk", YANDEX, "1", "спасибо")


@pytest.mark.asyncio
async def test_reply_validates_store_and_platform():
    service = build([FakeProvider(YANDEX)])

    with pytest.raises(ValueError):
        await service.reply_to_review("нет-такого", YANDEX, "1", "текст")
    with pytest.raises(ValueError):
        await service.reply_to_review("msk", "нет-такой", "1", "текст")


def test_enabled_requires_store_and_configured_provider():
    assert build([FakeProvider(YANDEX)]).enabled
    assert not build([FakeProvider(YANDEX, ready=False)]).enabled
    assert not StoresService(
        StoreRegistry(), [FakeProvider(YANDEX)], TTLCache()
    ).enabled


@pytest.mark.asyncio
async def test_store_without_platform_ref_gets_no_card():
    registry = StoreRegistry.from_dict(
        {"stores": [{"slug": "spb", "name": "Waystea", "platforms": {"2gis": {"id": "9"}}}]}
    )
    service = StoresService(registry, [FakeProvider(YANDEX)], TTLCache())

    cards = await service.cards_for(registry.get("spb"))

    assert cards == []  # у 2ГИС нет провайдера, Яндекса нет у точки


def test_store_title_without_city():
    assert Store(slug="s", name="Waystea").title == "Waystea"


# --- подстановка данных из реестра -------------------------------------------

REGISTRY_WITH_INFO = StoreRegistry.from_dict({
    "stores": [{
        "slug": "msk", "name": "Waystea", "city": "Москва",
        "address": "ул. Примерная, 1",
        "info": {"phone": "+7 900 000-00-00", "hours": "ежедневно 10:00–20:00"},
        "platforms": {"yandex": {"id": "111"}},
    }]
})


@pytest.mark.asyncio
async def test_registry_info_replaces_failed_card():
    """Яндекс без платного API организаций: карточка живёт на данных реестра."""
    service = StoresService(
        REGISTRY_WITH_INFO, [FakeProvider(YANDEX, fail=True)], TTLCache()
    )

    card = (await service.cards_for(REGISTRY_WITH_INFO.get("msk")))[0]

    assert card.ok and card.from_registry
    assert card.phone == "+7 900 000-00-00"
    assert card.hours == "ежедневно 10:00–20:00"
    assert card.url == "https://yandex.ru/maps/org/111/"


@pytest.mark.asyncio
async def test_registry_info_not_used_when_platform_answers():
    service = StoresService(REGISTRY_WITH_INFO, [FakeProvider(YANDEX)], TTLCache())

    card = (await service.cards_for(REGISTRY_WITH_INFO.get("msk")))[0]

    assert not card.from_registry and card.rating == 4.8


@pytest.mark.asyncio
async def test_error_kept_when_registry_has_nothing_to_show():
    registry = StoreRegistry.from_dict(
        {"stores": [{"slug": "msk", "name": "Waystea", "platforms": {"yandex": {"id": "1"}}}]}
    )
    service = StoresService(registry, [FakeProvider(YANDEX, fail=True)], TTLCache())

    card = (await service.cards_for(registry.get("msk")))[0]

    assert not card.ok


def test_editable_platforms_lists_only_writable():
    писатель = FakeProvider(TWOGIS)
    писатель.supports_editing = True
    service = build([FakeProvider(YANDEX), писатель])

    assert service.editable_platforms() == [TWOGIS]
