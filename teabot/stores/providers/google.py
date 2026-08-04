"""Google — Places API (New) и Business Profile API.

Два уровня доступа:

* **Публичный** (ключ GOOGLE_PLACES_KEY): карточка по place_id — адрес, телефон,
  график, рейтинг, количество оценок и до 5 отзывов. Ответы на отзывы недоступны.
* **Владельческий** (OAuth Business Profile): полный список отзывов и ответы на
  них от имени компании. Включается, когда заданы GOOGLE_GBP_CLIENT_ID/SECRET/
  REFRESH_TOKEN и у точки указан owner_id вида «accounts/123/locations/456».

Владельческий доступ используется автоматически, когда настроен; иначе
провайдер работает в публичном режиме.
"""
import logging
import time
from typing import Optional

import aiohttp

from ...config import STORES_TIMEOUT
from ..models import GOOGLE, Review, Store, StoreCard
from .base import ActionNotSupported, MapsProvider, ReplyNotSupported

logger = logging.getLogger(__name__)

PLACES_URL = "https://places.googleapis.com/v1/places/{place_id}"
PLACES_FIELD_MASK = ",".join([
    "id", "displayName", "formattedAddress", "nationalPhoneNumber",
    "rating", "userRatingCount", "googleMapsUri",
    "currentOpeningHours.weekdayDescriptions", "reviews",
])
TOKEN_URL = "https://oauth2.googleapis.com/token"
GBP_URL = "https://mybusiness.googleapis.com/v4"
BUSINESS_INFO_URL = "https://mybusinessbusinessinformation.googleapis.com/v1"
OWNER_CONSOLE = "https://business.google.com/locations"

# Какие поля карточки умеем править и куда они кладутся в Business Information API
EDITABLE_FIELDS = {
    "description": ("profile.description", lambda v: {"profile": {"description": v}}),
    "website": ("websiteUri", lambda v: {"websiteUri": v}),
    "phone": ("phoneNumbers.primaryPhone",
              lambda v: {"phoneNumbers": {"primaryPhone": v}}),
}

# Запас, чтобы не использовать токен на грани истечения
TOKEN_LEEWAY = 60


class GoogleBusinessProvider(MapsProvider):
    platform = GOOGLE
    title = "Google Maps"
    supports_reviews = True
    owner_console_url = OWNER_CONSOLE

    def __init__(self, places_key: str, session: aiohttp.ClientSession,
                 client_id: str = "", client_secret: str = "", refresh_token: str = ""):
        super().__init__(session)
        self.places_key = places_key
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self._token: str = ""
        self._token_expires_at: float = 0.0

    def configured(self) -> bool:
        return bool(self.places_key) or self.owner_access

    @property
    def owner_access(self) -> bool:
        """Настроен ли доступ владельца (Business Profile)."""
        return bool(self.client_id and self.client_secret and self.refresh_token)

    @property
    def supports_replies(self) -> bool:  # type: ignore[override]
        return self.owner_access

    @property
    def supports_editing(self) -> bool:  # type: ignore[override]
        return self.owner_access

    # --- публичный уровень: Places API -------------------------------------

    async def _place(self, place_id: str) -> dict:
        headers = {
            "X-Goog-Api-Key": self.places_key,
            "X-Goog-FieldMask": PLACES_FIELD_MASK,
        }
        async with self.session.get(
            PLACES_URL.format(place_id=place_id),
            headers=headers, params={"languageCode": "ru"},
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            return await r.json()

    async def fetch_card(self, store: Store) -> StoreCard:
        ref = store.ref(self.platform)
        if ref is None or not ref.external_id:
            return self._empty_card(store, "не указан place_id")
        if not self.places_key:
            return self._empty_card(store, "GOOGLE_PLACES_KEY не задан")

        try:
            data = await self._place(ref.external_id)
        except Exception as e:
            logger.warning(f"Google Places, {store.slug}: {e}")
            return self._empty_card(store, str(e)[:80])

        hours = (data.get("currentOpeningHours") or {}).get("weekdayDescriptions") or []
        return StoreCard(
            platform=self.platform,
            store_slug=store.slug,
            name=(data.get("displayName") or {}).get("text", store.name),
            address=data.get("formattedAddress", store.address),
            url=data.get("googleMapsUri") or ref.public_url(),
            phone=data.get("nationalPhoneNumber", ""),
            hours=", ".join(hours),
            rating=data.get("rating"),
            reviews_count=data.get("userRatingCount"),
        )

    # --- владельческий уровень: Business Profile ---------------------------

    async def _access_token(self) -> str:
        """Обновляет access token по refresh token; кэширует до истечения."""
        if self._token and time.time() < self._token_expires_at - TOKEN_LEEWAY:
            return self._token
        async with self.session.post(
            TOKEN_URL,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"обновление токена: HTTP {r.status}")
            data = await r.json()
        self._token = data.get("access_token", "")
        self._token_expires_at = time.time() + float(data.get("expires_in", 3600))
        return self._token

    async def _gbp_reviews(self, store: Store, owner_id: str, limit: int) -> list[Review]:
        token = await self._access_token()
        async with self.session.get(
            f"{GBP_URL}/{owner_id}/reviews",
            headers={"Authorization": f"Bearer {token}"},
            params={"pageSize": min(limit, 50), "orderBy": "updateTime desc"},
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            data = await r.json()

        ref = store.ref(self.platform)
        out = []
        for item in (data.get("reviews") or [])[:limit]:
            out.append(Review(
                platform=self.platform,
                store_slug=store.slug,
                review_id=item.get("reviewId", ""),
                author=(item.get("reviewer") or {}).get("displayName", ""),
                rating=_star_rating(item.get("starRating", "")),
                text=item.get("comment", ""),
                created_at=item.get("createTime", ""),
                reply_text=(item.get("reviewReply") or {}).get("comment", ""),
                url=ref.public_url() if ref else "",
            ))
        return out

    async def _places_reviews(self, store: Store, limit: int) -> list[Review]:
        ref = store.ref(self.platform)
        if ref is None or not ref.external_id or not self.places_key:
            return []
        data = await self._place(ref.external_id)
        out = []
        for item in (data.get("reviews") or [])[:limit]:
            out.append(Review(
                platform=self.platform,
                store_slug=store.slug,
                # у Places API имя отзыва — полный ресурс, короткий id — его хвост
                review_id=item.get("name", "").rsplit("/", 1)[-1],
                author=(item.get("authorAttribution") or {}).get("displayName", ""),
                rating=item.get("rating"),
                text=(item.get("text") or {}).get("text", ""),
                created_at=item.get("publishTime", ""),
                url=ref.public_url(),
            ))
        return out

    async def fetch_reviews(self, store: Store, limit: int = 10) -> list[Review]:
        ref = store.ref(self.platform)
        if ref is None:
            return []
        if self.owner_access and ref.owner_id:
            try:
                return await self._gbp_reviews(store, ref.owner_id, limit)
            except Exception as e:
                logger.warning(f"Google Business Profile, {store.slug}: {e}")
        try:
            return await self._places_reviews(store, limit)
        except Exception as e:
            logger.warning(f"Google отзывы, {store.slug}: {e}")
            return []

    async def reply_to_review(self, store: Store, review_id: str, text: str) -> None:
        ref = store.ref(self.platform)
        if not self.owner_access or ref is None or not ref.owner_id:
            raise ReplyNotSupported(
                "Google: ответы на отзывы требуют доступа Business Profile "
                f"(OAuth и owner_id точки). Кабинет: {OWNER_CONSOLE}"
            )
        token = await self._access_token()
        async with self.session.put(
            f"{GBP_URL}/{ref.owner_id}/reviews/{review_id}/reply",
            headers={"Authorization": f"Bearer {token}"},
            json={"comment": text},
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"ответ на отзыв: HTTP {r.status} {await r.text()}"[:200])

    def _owner_id(self, store: Store, action: str) -> str:
        ref = store.ref(self.platform)
        if not self.owner_access or ref is None or not ref.owner_id:
            raise ActionNotSupported(
                f"Google: {action} требует доступа Business Profile "
                f"(OAuth и owner_id точки). Кабинет: {OWNER_CONSOLE}"
            )
        return ref.owner_id

    async def upload_photo(self, store: Store, image_url: str,
                           category: str = "ADDITIONAL") -> None:
        """Добавляет фото в карточку по публичной ссылке на изображение."""
        owner_id = self._owner_id(store, "загрузка фото")
        token = await self._access_token()
        async with self.session.post(
            f"{GBP_URL}/{owner_id}/media",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "mediaFormat": "PHOTO",
                "locationAssociation": {"category": category},
                "sourceUrl": image_url,
            },
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status not in (200, 201):
                raise RuntimeError(f"загрузка фото: HTTP {r.status} {await r.text()}"[:200])

    async def update_info(self, store: Store, fields: dict[str, str]) -> None:
        """Правит описание, сайт и телефон точки (Business Information API)."""
        owner_id = self._owner_id(store, "правка карточки")
        unknown = set(fields) - set(EDITABLE_FIELDS)
        if unknown:
            raise ValueError(
                f"неизвестные поля: {', '.join(sorted(unknown))}. "
                f"Доступны: {', '.join(EDITABLE_FIELDS)}"
            )

        body: dict = {}
        mask: list[str] = []
        for key, value in fields.items():
            path, builder = EDITABLE_FIELDS[key]
            mask.append(path)
            _deep_merge(body, builder(value))

        # Business Information API адресует точку как «locations/{id}»
        location_name = "locations/" + owner_id.rsplit("/", 1)[-1]
        token = await self._access_token()
        async with self.session.patch(
            f"{BUSINESS_INFO_URL}/{location_name}",
            headers={"Authorization": f"Bearer {token}"},
            params={"updateMask": ",".join(mask)},
            json=body,
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"правка карточки: HTTP {r.status} {await r.text()}"[:200])

    async def health_check(self) -> str:
        parts = []
        if self.places_key:
            try:
                # Точка-эталон Google: Sydney Opera House — проверяем только доступ к API
                await self._place("ChIJ3S-JXmauEmsRUcIaWtf4MzE")
                parts.append("✅ Places API")
            except Exception as e:
                parts.append(f"❌ Places API: {str(e)[:40]}")
        else:
            parts.append("⚠️ Places-ключ не задан")

        if self.owner_access:
            try:
                await self._access_token()
                parts.append("✅ Business Profile (ответы на отзывы)")
            except Exception as e:
                parts.append(f"❌ Business Profile: {str(e)[:40]}")
        else:
            parts.append("⚠️ Business Profile не подключён")
        return "; ".join(parts)


def _deep_merge(target: dict, extra: dict) -> None:
    """Складывает вложенные словари полей: profile.description + phoneNumbers."""
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_merge(target[key], value)
        else:
            target[key] = value


def _star_rating(value: str) -> Optional[float]:
    """«FIVE» → 5.0. Business Profile отдаёт оценку словом."""
    return {
        "ONE": 1.0, "TWO": 2.0, "THREE": 3.0, "FOUR": 4.0, "FIVE": 5.0,
    }.get(value)
