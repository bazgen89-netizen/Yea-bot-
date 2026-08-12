"""Сборка приложения: Telegram-бот (PTB) + aiohttp-сервер webhook."""
import logging

from aiohttp import web
from telegram import Update
from telegram.ext import Application

from .cache import TTLCache
from .config import Settings, CACHE_TTL, CACHE_MAX_SIZE
from .handlers import register_handlers, SEARCH_KEY, AI_KEY, SOCIAL_KEY, SOCIAL_CFG_KEY
from .http import create_session, close_session
from .services import GroqClient, MetricoolClient, SerperClient
from .social import SocialConfig, known

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
    ptb.bot_data[AI_KEY] = GroqClient(settings.groq_api_key, settings.groq_model, session)
    ptb.bot_data[SOCIAL_KEY] = MetricoolClient(
        settings.metricool_user_token,
        settings.metricool_user_id,
        settings.metricool_blog_id,
        settings.social_timezone,
        session,
    )
    networks = known(settings.social_networks)
    ptb.bot_data[SOCIAL_CFG_KEY] = SocialConfig(
        networks=tuple(networks), admins=settings.social_admins,
    )

    await ptb.initialize()
    await ptb.start()
    full_url = f"{settings.webhook_url.rstrip('/')}/webhook"
    await ptb.bot.set_webhook(full_url)
    logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
    logger.info(f"🔗 Webhook: {full_url}")
    logger.info(f"🤖 AI: Groq {settings.groq_model}")
    if settings.social_enabled:
        logger.info(f"📡 Кросспостинг: {', '.join(networks)} (бренд {settings.metricool_blog_id})")
    else:
        logger.info("📡 Кросспостинг выключен: нет доступов Metricool")


async def on_shutdown(app: web.Application):
    ptb: Application = app['ptb_app']
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
