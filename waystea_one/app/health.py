"""Minimal HTTP server so this can run as a Render free-tier Web Service
(which requires something answering on $PORT) even though the bot itself
talks to Telegram via polling, not incoming HTTP. Not part of any docs/
module — purely a hosting-platform accommodation.
"""
from aiohttp import web


async def _health(request: web.Request) -> web.Response:
    return web.Response(text="WAYSTEA ONE is running")


def build_health_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", _health)
    return app


async def run_health_server(port: int) -> None:
    app = build_health_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()
