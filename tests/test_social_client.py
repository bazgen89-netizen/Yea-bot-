"""Тесты MetricoolClient на подставной HTTP-сессии (без реальных запросов)."""
import asyncio
from datetime import datetime

from teabot.services.social import MetricoolClient, format_report, publish_time


class FakeResponse:
    def __init__(self, status: int, body: str = "{}"):
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Отдаёт заранее заданные ответы и запоминает параметры вызовов."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)

    def get(self, url, **kwargs):
        return self.post(url, **kwargs)


def client(session, **overrides) -> MetricoolClient:
    args = dict(
        user_token="tok", user_id="4951550", blog_id="6427175",
        timezone="Europe/Moscow",
    )
    args.update(overrides)
    return MetricoolClient(session=session, **args)


def run(coro):
    return asyncio.run(coro)


def test_publish_sends_one_request_per_network():
    session = FakeSession([FakeResponse(200), FakeResponse(200)])
    results = run(client(session).publish("Новый пуэр", ["facebook", "pinterest"]))

    assert len(session.calls) == 2
    assert [r.network for r in results] == ["facebook", "pinterest"]
    assert all(r.ok for r in results)

    networks = [c["json"]["providers"][0]["network"] for c in session.calls]
    assert networks == ["facebook", "pinterest"]


def test_publish_isolates_failure_of_one_network():
    session = FakeSession([FakeResponse(200), FakeResponse(400, "media required")])
    results = run(client(session).publish("Текст", ["facebook", "instagram"]))

    ok = {r.network: r.ok for r in results}
    assert ok == {"facebook": True, "instagram": False}
    assert "400" in [r for r in results if not r.ok][0].detail


def test_publish_reports_auth_error_clearly():
    session = FakeSession([FakeResponse(401, "unauthorized")])
    result = run(client(session).publish("Текст", ["facebook"]))[0]
    assert not result.ok
    assert "токен" in result.detail


def test_publish_without_credentials_makes_no_requests():
    session = FakeSession([])
    results = run(client(session, user_token="").publish("Текст", ["facebook"]))
    assert session.calls == []
    assert results and not results[0].ok


def test_payload_carries_auth_media_and_timezone():
    session = FakeSession([FakeResponse(200)])
    when = datetime(2026, 8, 12, 18, 30)
    run(client(session).publish(
        "Текст", ["instagram"], ["https://cdn/img.jpg"], when=when,
    ))

    call = session.calls[0]
    assert call["params"]["blogId"] == "6427175"
    assert call["headers"]["X-Mc-Auth"] == "tok"
    assert call["json"]["media"] == ["https://cdn/img.jpg"]
    assert call["json"]["publicationDate"] == {
        "dateTime": "2026-08-12T18:30:00", "timezone": "Europe/Moscow",
    }


def test_draft_disables_autopublish():
    session = FakeSession([FakeResponse(200)])
    results = run(client(session).publish("Текст", ["facebook"], draft=True))

    payload = session.calls[0]["json"]
    assert payload["draft"] is True and payload["autoPublish"] is False
    assert "черновик" in results[0].detail


def test_publish_time_is_in_the_future():
    assert publish_time("Europe/Moscow").timestamp() > datetime.now().timestamp()


def test_publish_time_survives_unknown_timezone():
    assert publish_time("Nowhere/Nothing") is not None


def test_format_report_counts_successes():
    session = FakeSession([FakeResponse(200), FakeResponse(500, "boom")])
    results = run(client(session).publish("Текст", ["facebook", "pinterest"]))

    report = format_report(results)
    assert "1 из 2 сетей" in report
    assert "✅" in report and "❌" in report
