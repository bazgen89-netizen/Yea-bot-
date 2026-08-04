import json

import pytest

from teabot.stores.models import Review
from teabot.stores.monitor import ReviewMonitor, notify_new_reviews


class FakeService:
    """Подменяет StoresService: отдаёт заранее заданные списки отзывов."""

    def __init__(self, batches):
        self._batches = list(batches)
        self.registry = []

    async def all_reviews(self, limit_per_store=10):
        return self._batches.pop(0) if self._batches else []


def review(review_id, text="текст"):
    return Review(platform="2gis", store_slug="msk", review_id=review_id, text=text)


@pytest.mark.asyncio
async def test_first_check_primes_without_notifications(tmp_path):
    service = FakeService([[review("1"), review("2")]])
    monitor = ReviewMonitor(service, tmp_path / "state.json")

    assert await monitor.check() == []


@pytest.mark.asyncio
async def test_only_new_reviews_returned(tmp_path):
    service = FakeService([
        [review("1")],
        [review("2"), review("1")],
        [review("2"), review("1")],
    ])
    monitor = ReviewMonitor(service, tmp_path / "state.json")

    await monitor.check()  # прогрев
    fresh = await monitor.check()
    assert [r.review_id for r in fresh] == ["2"]

    assert await monitor.check() == []  # повторно те же не приходят


@pytest.mark.asyncio
async def test_state_survives_restart(tmp_path):
    state = tmp_path / "state.json"
    first = ReviewMonitor(FakeService([[review("1")]]), state)
    await first.check()

    restarted = ReviewMonitor(FakeService([[review("1"), review("2")]]), state)
    fresh = await restarted.check()

    assert [r.review_id for r in fresh] == ["2"]  # «1» помним с прошлого запуска


@pytest.mark.asyncio
async def test_broken_state_file_does_not_crash(tmp_path):
    state = tmp_path / "state.json"
    state.write_text("{сломано", encoding="utf-8")
    monitor = ReviewMonitor(FakeService([[review("1")]]), state)

    assert await monitor.check() == []  # считается первым запуском


@pytest.mark.asyncio
async def test_state_file_written(tmp_path):
    state = tmp_path / "sub" / "state.json"
    monitor = ReviewMonitor(FakeService([[review("1")]]), state)
    await monitor.check()

    saved = json.loads(state.read_text(encoding="utf-8"))
    assert saved["primed"] is True
    assert "2gis:msk:1" in saved["seen"]


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append((chat_id, text))


@pytest.mark.asyncio
async def test_notify_sends_new_reviews(tmp_path):
    service = FakeService([[review("1")], [review("1"), review("2", "новый")]])
    monitor = ReviewMonitor(service, tmp_path / "state.json")
    bot = FakeBot()

    await notify_new_reviews(monitor, bot, 42, lambda r, t: r.text, {})
    assert bot.sent == []  # прогрев молчит

    sent = await notify_new_reviews(monitor, bot, 42, lambda r, t: r.text, {})
    assert sent == 1
    assert bot.sent[0][0] == 42
    assert "новый" in bot.sent[0][1]


@pytest.mark.asyncio
async def test_notify_skipped_without_admin_chat(tmp_path):
    monitor = ReviewMonitor(FakeService([[review("1")]]), tmp_path / "state.json")
    bot = FakeBot()

    assert await notify_new_reviews(monitor, bot, 0, lambda r, t: r.text, {}) is None
    assert bot.sent == []
