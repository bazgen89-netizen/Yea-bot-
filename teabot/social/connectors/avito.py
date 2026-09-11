"""Авито — переписка с покупателями через Messenger API.

Нужны AVITO_CLIENT_ID, AVITO_CLIENT_SECRET и AVITO_USER_ID (числовой id
профиля). Токен получается по client_credentials и кэшируется.
"""
import time

from ..base import CAP_INBOX, CAP_REPLY, ConnectorError, HttpConnector
from ..models import KIND_MESSAGE, PublishResult, SocialItem

API = "https://api.avito.ru"


class AvitoConnector(HttpConnector):
    network = "avito"
    title = "Авито"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY})
    required_env = ("AVITO_CLIENT_ID", "AVITO_CLIENT_SECRET", "AVITO_USER_ID")

    def __init__(self, session, **creds):
        super().__init__(session, **creds)
        self._token = ""
        self._token_expires = 0.0

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        data = await self._post(f"{API}/token/", data={
            "grant_type": "client_credentials",
            "client_id": self.creds["client_id"],
            "client_secret": self.creds["client_secret"],
        })
        token = (data or {}).get("access_token") if isinstance(data, dict) else None
        if not token:
            raise ConnectorError("Авито не выдал токен — проверьте client_id/secret")
        self._token = token
        self._token_expires = time.time() + int(data.get("expires_in", 86400)) - 60
        return token

    async def _headers(self) -> dict:
        return {"Authorization": f"Bearer {await self._access_token()}"}

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        user_id = self.creds["user_id"]
        data = await self._get(
            f"{API}/messenger/v2/accounts/{user_id}/chats",
            headers=await self._headers(),
            params={"unread_only": "true", "limit": limit},
        )
        items = []
        for chat in (data or {}).get("chats", []):
            msg = chat.get("last_message") or {}
            author_id = str(msg.get("author_id", ""))
            if author_id == str(user_id):
                continue  # наш собственный ответ
            content = msg.get("content") or {}
            title = ((chat.get("context") or {}).get("value") or {}).get("title", "")
            items.append(SocialItem(
                network=self.network,
                kind=KIND_MESSAGE,
                item_id=str(msg.get("id") or chat.get("id")),
                author=next(
                    (u.get("name", "покупатель") for u in chat.get("users", [])
                     if str(u.get("id")) != str(user_id)),
                    "покупатель",
                ),
                text=content.get("text") or f"[{msg.get('type', 'вложение')}]",
                created_at=float(msg.get("created", time.time())),
                thread_id=str(chat.get("id", "")),
                url=f"https://www.avito.ru/profile/messenger/channel/{chat.get('id', '')}",
                raw={"chat_title": title, **msg},
            ))
        return items

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        user_id = self.creds["user_id"]
        await self._post(
            f"{API}/messenger/v1/accounts/{user_id}/chats/{item.reply_to}/messages",
            headers=await self._headers(),
            json={"message": {"text": text[:2000]}, "type": "text"},
        )
        return PublishResult(self.network, True, url=item.url)

    async def _probe(self) -> str:
        await self._access_token()
        return "✅ профиль подключён"
