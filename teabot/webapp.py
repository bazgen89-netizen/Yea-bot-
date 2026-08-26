"""Сборка приложения: Telegram-бот (PTB) + aiohttp-сервер webhook."""
import logging

from aiohttp import web
from telegram import Update
from telegram.ext import Application

from .cache import TTLCache
from .config import Settings, SocialSettings, CACHE_TTL, CACHE_MAX_SIZE
from .handlers import register_handlers, SEARCH_KEY, AI_KEY
from .handlers.social import ADMIN_KEY, HUB_KEY, poll_job
from .http import create_session, close_session
from .services import AIRouter, GeminiClient, GroqClient, SerperClient
from .social import SeenStore, SocialHub, build_connectors

logger = logging.getLogger(__name__)


async def handle_webhook(request: web.Request) -> web.Response:
    try:
        upd = Update.de_json(await request.json(), request.app['bot'])
        await request.app['ptb_app'].process_update(upd)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)


async def on_startup(app: web.Application):
    settings: Settings = app['settings']
    ptb: Application = app['ptb_app']

    # Общая HTTP-сессия и клиенты внешних сервисов
    session = create_session()
    app['http_session'] = session
    ptb.bot_data[SEARCH_KEY] = SerperClient(
        settings.serper_key, session,
        TTLCache(ttl=CACHE_TTL, max_size=CACHE_MAX_SIZE),
    )
    # Два мозга: основной отвечает, второй подстраховывает при сбое
    ai = AIRouter(
        {
            "groq": GroqClient(settings.groq_api_key, settings.groq_model, session),
            "gemini": GeminiClient(settings.gemini_api_key, settings.gemini_model, session),
        },
        primary=settings.ai_primary,
    )
    ptb.bot_data[AI_KEY] = ai

    setup_social(ptb, settings, session, ai)

    await ptb.initialize()
    await ptb.start()
    full_url = f"{settings.webhook_url.rstrip('/')}/webhook"
    await ptb.bot.set_webhook(full_url)
    logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
    logger.info(f"🔗 Webhook: {full_url}")
    brains = ", ".join(
        f"{getattr(b, 'name', n)} {getattr(b, 'model', '')}"
        + ("" if getattr(b, "available", False) else " (нет ключа)")
        for n, b in ai.brains.items()
    )
    logger.info(f"🧠 Мозги: {brains} | основной: {ai.primary}")


def setup_social(ptb: Application, settings: Settings,
                 session, ai: GroqClient) -> None:
    """Собирает единый хаб соцсетей и запускает автономный опрос площадок."""
    social: SocialSettings = settings.social or SocialSettings.from_env()
    hub = SocialHub(
        connectors=build_connectors(social.env, session),
        seen=SeenStore(social.state_path),
        ai=ai,
        autopilot=social.autopilot,
    )
    ptb.bot_data[HUB_KEY] = hub
    ptb.bot_data[ADMIN_KEY] = social.admin_chat_id

    if not social.polling_enabled:
        logger.warning("⚠️ SOCIAL_ADMIN_CHAT_ID не задан — автономный опрос соцсетей выключен")
        return
    if ptb.job_queue is None:
        logger.warning("⚠️ JobQueue недоступна — автономный опрос соцсетей выключен")
        return

    ptb.job_queue.run_repeating(
        poll_job, interval=social.poll_interval, first=20, name="social_poll",
    )
    logger.info(
        "🌐 Автономный опрос соцсетей: каждые %d с → чат %s (автопилот: %s)",
        social.poll_interval, social.admin_chat_id,
        "вкл" if social.autopilot else "выкл",
    )


async def on_shutdown(app: web.Application):
    ptb: Application = app['ptb_app']
    hub = ptb.bot_data.get(HUB_KEY)
    if hub is not None:
        hub.seen.save()
    await ptb.stop()
    await ptb.shutdown()
    session = app.get('http_session')
    if session is not None:
        await close_session(session)


def create_app(settings: Settings) -> web.Application:
    """Собирает aiohttp-приложение с ботом. Вынесено отдельно для тестируемости."""
    ptb = Application.builder().token(settings.telegram_bot_token).build()
    register_handlers(ptb)

    web_app = web.Application()
    web_app['settings'] = settings
    web_app['bot'] = ptb.bot
    web_app['ptb_app'] = ptb
    web_app.router.add_post('/webhook', handle_webhook)
    web_app.on_startup.append(on_startup)
    web_app.on_shutdown.append(on_shutdown)
    return web_app


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    logger.info("🚀 Запуск Tea Expert Bot...")

    settings = Settings.from_env()
    settings.validate()

    web_app = create_app(settings)
    web.run_app(web_app, host="0.0.0.0", port=settings.port)
