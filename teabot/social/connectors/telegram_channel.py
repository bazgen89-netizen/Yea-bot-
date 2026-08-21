"""Собственный Telegram-канал: публикация постов от имени бота.

Бот должен быть администратором канала (TELEGRAM_CHANNEL_ID: @username или -100...).
Комментарии из чата обсуждений приходят обычными апдейтами, поэтому
чтение входящих здесь не нужно.
"""
from ..base import CAP_PUBLISH, ConnectorError, HttpConnector
from ..models import PublishResult

API = "https://api.telegram.org/bot{token}/{method}"


class TelegramChannelConnector(HttpConnector):
    network = "tg_channel"
    title = "Telegram-канал"
    capabilities = frozenset({CAP_PUBLISH})
    required_env = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID")

    async def _call(self, method: str, **payload) -> dict:
        data = await self._post(
            API.format(token=self.creds["token"], method=method), json=payload
        )
        if isinstance(data, dict) and not data.get("ok", False):
            raise ConnectorError(str(data.get("description", "ошибка Telegram"))[:100])
        return data.get("result", {}) if isinstance(data, dict) else {}

    async def publish(self, text: str, link: str = "") -> PublishResult:
        body = text if not link else f"{text}\n\n{link}"
        res = await self._call(
            "sendMessage",
            chat_id=self.creds["channel_id"],
            text=body[:4000],
            parse_mode="HTML",
            disable_web_page_preview=False,
        )
        chat = res.get("chat", {}) or {}
        username = chat.get("username")
        msg_id = res.get("message_id")
        return PublishResult(
            self.network, True,
            url=f"https://t.me/{username}/{msg_id}" if username and msg_id else "",
        )

    async def _probe(self) -> str:
        chat = await self._call("getChat", chat_id=self.creds["channel_id"])
        return f"✅ {chat.get('title') or self.creds['channel_id']}"
