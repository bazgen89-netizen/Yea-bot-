"""Minimal HTTP server so this can run as a Render free-tier Web Service
(which requires something answering on $PORT) even though the bot itself
talks to Telegram via polling, not incoming HTTP. Not part of any docs/
module — purely a hosting-platform accommodation.

Two routes, deliberately different:

- `/` always answers 200. This is what the keep-alive workflow pings, and
  its only job is to stop Render's free tier from spinning the service
  down for inactivity — it must not start failing just because the bot
  is paused or wedged, or the service would be allowed to sleep exactly
  when someone is trying to diagnose it.
- `/health` reports whether the bot is actually *working*: a process that
  is up but has stopped polling Telegram looks identical from the
  outside, which is the failure the watchdog workflow exists to catch. It
  answers 503 when the heartbeat has gone stale.
"""
import datetime
import json

from aiohttp import web

# Updated by a scheduler job in app/main.py. `paused` short-circuits the
# staleness check: BOT_PAUSED is a deliberate state, not an outage, and the
# watchdog shouldn't page the owner about a pause they set themselves.
_state: dict = {"last_heartbeat": None, "paused": False, "started_at": None}

# How long without a heartbeat before /health calls the bot dead. The
# heartbeat job runs on REMINDER_POLL_SECONDS (default 300s), so this needs
# enough slack for one missed tick plus a cold start.
STALE_AFTER_SECONDS = 900


def mark_started(paused: bool = False) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    _state["started_at"] = now
    _state["paused"] = paused
    _state["last_heartbeat"] = None if paused else now


def heartbeat() -> None:
    _state["last_heartbeat"] = datetime.datetime.now(datetime.timezone.utc)


def health_snapshot(now: datetime.datetime | None = None) -> tuple[dict, int]:
    """Returns `(payload, http_status)`. Pure, so the staleness rule is
    testable without running a server or a scheduler.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    last = _state["last_heartbeat"]
    payload = {
        "paused": _state["paused"],
        "started_at": _state["started_at"].isoformat() if _state["started_at"] else None,
        "last_heartbeat": last.isoformat() if last else None,
    }

    if _state["paused"]:
        payload["status"] = "paused"
        return payload, 200
    if last is None:
        payload["status"] = "starting"
        return payload, 200

    age = (now - last).total_seconds()
    payload["seconds_since_heartbeat"] = int(age)
    if age > STALE_AFTER_SECONDS:
        payload["status"] = "stale"
        return payload, 503
    payload["status"] = "ok"
    return payload, 200


async def _root(request: web.Request) -> web.Response:
    return web.Response(text="WAYSTEA ONE is running")


async def _health(request: web.Request) -> web.Response:
    payload, status = health_snapshot()
    return web.Response(
        text=json.dumps(payload, ensure_ascii=False),
        status=status,
        content_type="application/json",
    )


def build_health_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", _root)
    app.router.add_get("/health", _health)
    return app


async def run_health_server(port: int) -> None:
    app = build_health_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()
