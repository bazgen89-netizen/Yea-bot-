"""Сборка приложения: Telegram-бот (PTB) + aiohttp-сервер webhook."""
import logging

from aiohttp import web
from telegram import Update
from telegram.ext import Application

from .cache import TTLCache
from .config import Settings, CACHE_TTL, CACHE_MAX_SIZE, VPN_MAX_KEYS_PER_USER
from .handlers import register_handlers, SEARCH_KEY, AI_KEY, VPN_KEY
from .http import create_session, close_session
from .subscription import ROUTING_KEY, build_routing_link, handle_subscription
from .services import GroqClient, SerperClient, VpnManager, VpnServer

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

    # VPN-модуль поднимается только если задан сервер; иначе команды отвечают,
    # что он не настроен, и остальной бот работает как раньше.
    vpn_server = VpnServer.from_env()
    if vpn_server.configured:
        ptb.bot_data[VPN_KEY] = VpnManager(
            vpn_server, settings.vpn_users_path,
            reload_cmd=settings.vpn_reload_cmd,
            max_keys_per_user=VPN_MAX_KEYS_PER_USER,
        )
        try:
            app[ROUTING_KEY] = build_routing_link(settings.vpn_profile)
        except (ValueError, OSError) as e:
            # Без правил подписка всё равно отдаст ключи, только без whitelist.
            app[ROUTING_KEY] = ""
            logger.error(f"Не собрать routing-профиль Happ: {e}")
        logger.info(f"VPN: {vpn_server.host}:{vpn_server.port}, "
                    f"админов: {len(settings.vpn_admins)}")
    ptb.bot_data["vpn_admins"] = set(settings.vpn_admins)
    ptb.bot_data["vpn_profile"] = settings.vpn_profile
    # Базовый адрес подписки — тот же публичный URL, на котором висит webhook.
    ptb.bot_data["vpn_sub_base"] = settings.webhook_url

    await ptb.initialize()
    await ptb.start()
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
    web_app.router.add_get('/sub/{token}', handle_subscription)
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
