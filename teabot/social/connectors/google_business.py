"""Google Business Profile — отзывы на Google Картах и ответы на них.

Нужны OAuth-креды приложения и refresh-токен владельца карточки
(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)
и имя локации вида accounts/123/locations/456 (GOOGLE_LOCATION).
"""
import time
from datetime import datetime

from ..base import CAP_INBOX, CAP_REPLY, ConnectorError, HttpConnector
from ..models import KIND_REVIEW, PublishResult, SocialItem

TOKEN_URL = "https://oauth2.googleapis.com/token"
MYBUSINESS = "https://mybusiness.googleapis.com/v4"

STARS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


class GoogleBusinessConnector(HttpConnector):
    network = "google_maps"
    title = "Google Карты"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY})
    required_env = ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
                    "GOOGLE_REFRESH_TOKEN", "GOOGLE_LOCATION")

    def __init__(self, session, **creds):
        super().__init__(session, **creds)
        self._token = ""
        self._token_expires = 0.0

    async def _access_token(self) -> str:
        """Обменивает refresh-токен на access-токен, кэшируя его до истечения."""
        if self._token and time.time() < self._token_expires:
            return self._token
        data = await self._post(TOKEN_URL, data={
            "client_id": self.creds["client_id"],
            "client_secret": self.creds["client_secret"],
            "refresh_token": self.creds["refresh_token"],
            "grant_type": "refresh_token",
        })
        token = (data or {}).get("access_token") if isinstance(data, dict) else None
        if not token:
            raise ConnectorError("Google не выдал access_token — проверьте refresh-токен")
        self._token = token
        self._token_expires = time.time() + int(data.get("expires_in", 3600)) - 60
        return token

    async def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {await self._access_token()}"}

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        location = self.creds["location"].strip("/")
        data = await self._get(
            f"{MYBUSINESS}/{location}/reviews",
            headers=await self._auth_headers(),
            params={"pageSize": limit, "orderBy": "updateTime desc"},
        )
        items = []
        for r in (data or {}).get("reviews", []):
            if r.get("reviewReply"):
                continue  # уже отвечено
            reviewer = (r.get("reviewer") or {}).get("displayName", "гость")
            created = r.get("createTime", "")
            try:
                ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
            except (ValueError, AttributeError):
                ts = time.time()
            items.append(SocialItem(
                network=self.network,
                kind=KIND_REVIEW,
                item_id=str(r.get("reviewId") or r.get("name", "")),
                author=reviewer,
                text=r.get("comment", ""),
                created_at=ts,
                thread_id=r.get("name", ""),
                url="https://business.google.com/reviews",
                rating=STARS.get(r.get("starRating", "")),
                raw=r,
            ))
        return items

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        name = item.reply_to
        if not name:
            return PublishResult(self.network, False, error="не найден идентификатор отзыва")
        status, body = await self._request(
            "PUT", f"{MYBUSINESS}/{name}/reply",
            headers=await self._auth_headers(), json={"comment": text[:4000]},
        )
        self._unwrap(status, body)
        return PublishResult(self.network, True, url=item.url)

    async def _probe(self) -> str:
        location = self.creds["location"].strip("/")
        await self._get(
            f"{MYBUSINESS}/{location}/reviews",
            headers=await self._auth_headers(), params={"pageSize": 1},
        )
        return "✅ карточка подключена"
