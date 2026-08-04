"""Сборка приложения: Telegram-бот (PTB) + aiohttp-сервер webhook."""
import logging

from aiohttp import web
from telegram import Update
from telegram.ext import Application

from .cache import TTLCache
from .config import (
    Settings, CACHE_TTL, CACHE_MAX_SIZE,
    REVIEWS_PER_STORE, STORES_CACHE_MAX_SIZE, STORES_CACHE_TTL,
)
from .handlers import register_handlers, ADMIN_KEY, SEARCH_KEY, AI_KEY, STORES_KEY
from .http import create_session, close_session
from .services import GroqClient, SerperClient
from .stores import ReviewMonitor, StoreRegistry, StoresService, notify_new_reviews
from .stores.formatting import format_review
from .stores.providers import GoogleBusinessProvider, TwoGisProvider, YandexMapsProvider

logger = logging.getLogger(__name__)

MONITOR_KEY = "review_monitor"


async def handle_webhook(request: web.Request) -> web.Response:
    try:
        upd = Update.de_json(await request.json(), request.app['bot'])
        await request.app['ptb_app'].process_update(upd)
        return web.Response(text="OK")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return web.Response(text="Error", status=500)


def build_stores_service(settings: Settings, session) -> StoresService:
    """Собирает сервис магазинов: реестр точек + провайдеры трёх площадок."""
    registry = StoreRegistry.from_file(settings.stores_file)
    providers = [
        YandexMapsProvider(settings.yandex_maps_key, session),
        TwoGisProvider(settings.twogis_key, session, settings.twogis_reviews_key),
        GoogleBusinessProvider(
            settings.google_places_key, session,
            client_id=settings.google_gbp_client_id,
            client_secret=settings.google_gbp_client_secret,
            refresh_token=settings.google_gbp_refresh_token,
        ),
    ]
    return StoresService(
        registry, providers,
        TTLCache(ttl=STORES_CACHE_TTL, max_size=STORES_CACHE_MAX_SIZE),
    )


async def reviews_job(context) -> None:
    """Периодическая проверка новых отзывов с уведомлением владельца."""
    monitor: ReviewMonitor = context.bot_data[MONITOR_KEY]
    titles = {s.slug: s.title for s in monitor.service.registry}
    try:
        sent = await notify_new_reviews(
            monitor, context.bot, context.bot_data.get(ADMIN_KEY, 0),
            format_review, titles,
        )
    except Exception as e:
        logger.warning(f"Мониторинг отзывов: {e}")
        return
    if sent:
        logger.info(f"Мониторинг отзывов: отправлено {sent} новых")


def setup_reviews_monitor(ptb: Application, settings: Settings,
                          stores: StoresService) -> None:
    """Ставит периодическую задачу проверки отзывов, если есть кому слать."""
    if not settings.admin_chat_id:
        logger.info("ADMIN_CHAT_ID не задан — мониторинг отзывов выключен")
        return
    if not stores.enabled:
        logger.info("Магазины не настроены — мониторинг отзывов выключен")
        return
    if ptb.job_queue is None:
        logger.warning("JobQueue недоступен — мониторинг отзывов выключен")
        return

    ptb.bot_data[MONITOR_KEY] = ReviewMonitor(
        stores, settings.reviews_state_file, limit_per_store=REVIEWS_PER_STORE,
    )
    ptb.job_queue.run_repeating(
        reviews_job,
        interval=settings.reviews_poll_interval,
        first=60,
        name="reviews_monitor",
    )
    logger.info(
        f"🔔 Мониторинг отзывов включён: каждые {settings.reviews_poll_interval} с"
    )


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

    stores = build_stores_service(settings, session)
    ptb.bot_data[STORES_KEY] = stores
    ptb.bot_data[ADMIN_KEY] = settings.admin_chat_id

    await ptb.initialize()
    await ptb.start()
    # После start(): планировщик JobQueue уже запущен и сразу принимает задачу
    setup_reviews_monitor(ptb, settings, stores)
    full_url = f"{settings.webhook_url.rstrip('/')}/webhook"
    await ptb.bot.set_webhook(full_url)
    logger.info(f"✅ Бот запущен! @{ptb.bot.username}")
    logger.info(f"🔗 Webhook: {full_url}")
    logger.info(f"🤖 AI: Groq {settings.groq_model}")


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
