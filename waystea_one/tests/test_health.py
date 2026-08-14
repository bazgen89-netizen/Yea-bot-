"""The /health staleness rule (app/health.py) — what the watchdog workflow
alerts on. Worth pinning down: getting it wrong either pages the owner over
a normal cold start, or stays silent while the bot is wedged.
"""
import datetime

import pytest

from app import health


@pytest.fixture(autouse=True)
def reset_state():
    health._state.update({"last_heartbeat": None, "paused": False, "started_at": None})
    yield
    health._state.update({"last_heartbeat": None, "paused": False, "started_at": None})


def _now():
    return datetime.datetime(2026, 8, 14, 12, 0, tzinfo=datetime.timezone.utc)


def health_snapshot_at(seconds_later: int):
    """Snapshot taken `seconds_later` after the last heartbeat."""
    health._state["last_heartbeat"] = _now()
    return health.health_snapshot(_now() + datetime.timedelta(seconds=seconds_later))


def test_fresh_heartbeat_is_ok():
    health.mark_started()
    payload, status = health_snapshot_at(0)
    assert payload["status"] == "ok"
    assert status == 200


def test_stale_heartbeat_reports_503():
    health.mark_started()
    payload, status = health_snapshot_at(health.STALE_AFTER_SECONDS + 1)
    assert payload["status"] == "stale"
    assert status == 503


def test_one_missed_tick_is_not_stale_yet():
    """The heartbeat runs on REMINDER_POLL_SECONDS (300s by default), so a
    single missed tick plus a cold start must stay under the threshold —
    otherwise the watchdog cries wolf.
    """
    health.mark_started()
    _, status = health_snapshot_at(600)
    assert status == 200


def test_paused_bot_is_not_reported_as_down():
    """BOT_PAUSED is a deliberate state; the watchdog shouldn't page the owner
    about a pause they set themselves.
    """
    health.mark_started(paused=True)
    payload, status = health.health_snapshot(_now() + datetime.timedelta(days=1))
    assert payload["status"] == "paused"
    assert status == 200


def test_just_booted_bot_is_not_stale():
    health.mark_started()
    health._state["last_heartbeat"] = None
    payload, status = health.health_snapshot(_now())
    assert payload["status"] == "starting"
    assert status == 200
