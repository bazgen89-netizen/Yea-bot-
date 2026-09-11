"""Яндекс Бизнес — отзывы на Яндекс Картах и ответы на них.

Доступ к API отзывов выдаётся владельцу организации; базовый адрес
вынесен в YANDEX_API_URL, чтобы подстроить его под выданную вам версию
API без правки кода. Нужны YANDEX_BUSINESS_TOKEN и YANDEX_COMPANY_ID.

У сети несколько магазинов, и карточка у каждого своя. Коннектор
обслуживает одну карточку и помнит, какая это точка, — отзыв уходит на
разбор с её профилем (teabot/branches.py), поэтому ответ звучит от имени
нужного магазина, а не «от сети вообще».
"""
import time
from datetime import datetime

from ... import branches
from ..base import CAP_INBOX, CAP_REPLY, HttpConnector
from ..models import KIND_REVIEW, PublishResult, SocialItem

DEFAULT_API_URL = "https://api.business.yandex.ru/v1"


class YandexBusinessConnector(HttpConnector):
    network = "yandex_maps"
    title = "Яндекс Карты"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY})
    required_env = ("YANDEX_BUSINESS_TOKEN", "YANDEX_COMPANY_ID")

    def __init__(self, session, **creds):
        super().__init__(session, **creds)
        code = (self.creds.get("branch") or "").strip().lower()
        if not code:
            return
        # Каждая точка — отдельная площадка в хабе: свой статус, свои ответы.
        # Имя строим из кода, даже если профиль точки ещё не описан, — иначе
        # две карточки столкнутся под одним network.
        self.network = f"{type(self).network}_{code}"
        branch = branches.find(code)
        self.title = f"Яндекс Карты — {branch.title if branch else code}"

    def _cred_keys(self):
        return ("token", "company_id")

    @property
    def _base(self) -> str:
        return (self.creds.get("api_url") or DEFAULT_API_URL).rstrip("/")

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"OAuth {self.creds['token']}"}

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        data = await self._get(
            f"{self._base}/companies/{self.creds['company_id']}/reviews",
            headers=self._headers, params={"limit": limit, "unanswered": "true"},
        )
        raw_items = (data or {}).get("reviews") or (data or {}).get("items") or []
        items = []
        for r in raw_items:
            if r.get("answer") or r.get("business_answer"):
                continue
            created = r.get("created_at") or r.get("updated_at") or ""
            try:
                ts = datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp()
            except ValueError:
                ts = time.time()
            items.append(SocialItem(
                network=self.network,
                kind=KIND_REVIEW,
                item_id=str(r.get("id") or r.get("review_id", "")),
                author=(r.get("author") or {}).get("name", "гость")
                if isinstance(r.get("author"), dict) else str(r.get("author", "гость")),
                text=r.get("text", ""),
                created_at=ts,
                thread_id=str(r.get("id") or r.get("review_id", "")),
                url=f"https://yandex.ru/maps/org/{self.creds['company_id']}/reviews/",
                rating=r.get("rating"),
                branch=self.creds.get("branch", ""),
                raw=r,
            ))
        return items

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        await self._post(
            f"{self._base}/companies/{self.creds['company_id']}/reviews/{item.reply_to}/answer",
            headers=self._headers, json={"text": text[:4000]},
        )
        return PublishResult(self.network, True, url=item.url)

    async def _probe(self) -> str:
        await self._get(
            f"{self._base}/companies/{self.creds['company_id']}/reviews",
            headers=self._headers, params={"limit": 1},
        )
        return "✅ организация подключена"
