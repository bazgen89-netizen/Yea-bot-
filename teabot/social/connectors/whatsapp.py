"""WhatsApp Business Cloud API: исходящие сообщения и ответы.

Входящие приходят на webhook Meta, а не по запросу, поэтому опроса здесь
нет: события принимает `/social/meta` (см. teabot/social/webhooks.py) и
кладёт их в общий поток хаба. Отвечаем на элемент, у которого thread_id —
номер клиента в международном формате (WA_PHONE_ID, WA_TOKEN).
"""
from ..base import CAP_REPLY, ConnectorError, HttpConnector
from ..models import PublishResult

GRAPH = "https://graph.facebook.com/v21.0"


class WhatsAppConnector(HttpConnector):
    network = "whatsapp"
    title = "WhatsApp Business"
    capabilities = frozenset({CAP_REPLY})
    required_env = ("WA_PHONE_ID", "WA_TOKEN")

    async def _send(self, to: str, text: str) -> dict:
        data = await self._post(
            f"{GRAPH}/{self.creds['phone_id']}/messages",
            headers={"Authorization": f"Bearer {self.creds['token']}"},
            json={
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": text[:4000]},
            },
        )
        if isinstance(data, dict) and "error" in data:
            raise ConnectorError(str(data["error"].get("message", ""))[:100])
        return data if isinstance(data, dict) else {}

    async def reply(self, item, text: str) -> PublishResult:
        if not item.reply_to:
            return PublishResult(self.network, False, error="неизвестен номер получателя")
        await self._send(item.reply_to, text)
        return PublishResult(self.network, True)

    async def send_to(self, phone: str, text: str) -> PublishResult:
        """Прямая отправка на номер — используется командой /wa."""
        await self._send(phone, text)
        return PublishResult(self.network, True)

    async def _probe(self) -> str:
        data = await self._get(
            f"{GRAPH}/{self.creds['phone_id']}",
            headers={"Authorization": f"Bearer {self.creds['token']}"},
            params={"fields": "display_phone_number,verified_name"},
        )
        if isinstance(data, dict) and data.get("display_phone_number"):
            return f"✅ {data.get('verified_name', '')} {data['display_phone_number']}".strip()
        return "✅ номер подключён"
