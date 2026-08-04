"""Модели данных для карточек магазинов на картографических площадках."""
from dataclasses import dataclass, field
from typing import Optional

# Поддерживаемые площадки
YANDEX = "yandex"
TWOGIS = "2gis"
GOOGLE = "google"

PLATFORM_TITLES = {
    YANDEX: "Яндекс Карты",
    TWOGIS: "2ГИС",
    GOOGLE: "Google Maps",
}


@dataclass(frozen=True)
class PlatformRef:
    """Привязка магазина к карточке на конкретной площадке.

    external_id — идентификатор организации на площадке (Яндекс: id организации,
    2ГИС: id филиала, Google: place_id).
    owner_id — идентификатор точки в кабинете владельца, если он отличается от
    публичного (Google Business Profile: «accounts/{id}/locations/{id}»).
    query — резервный текстовый запрос для Яндекса, у которого нет выдачи по id.
    url — прямая ссылка на карточку; если пустая, собирается автоматически.
    """
    platform: str
    external_id: str = ""
    owner_id: str = ""
    query: str = ""
    url: str = ""

    def public_url(self) -> str:
        if self.url:
            return self.url
        if self.platform == YANDEX and self.external_id:
            return f"https://yandex.ru/maps/org/{self.external_id}/"
        if self.platform == TWOGIS and self.external_id:
            return f"https://2gis.ru/firm/{self.external_id}"
        if self.platform == GOOGLE and self.external_id:
            return f"https://www.google.com/maps/place/?q=place_id:{self.external_id}"
        return ""


@dataclass(frozen=True)
class Store:
    """Один магазин (точка) со всеми его карточками на площадках.

    info — данные из реестра (телефон, график): подставляются, когда площадка
    не отдала карточку. У Яндекса, например, API организаций стоит от 195 000 ₽
    в год, и для двух своих точек его покупать незачем — достаточно вписать
    актуальные данные сюда.
    """
    slug: str
    name: str
    city: str = ""
    address: str = ""
    refs: dict[str, PlatformRef] = field(default_factory=dict)
    info: dict[str, str] = field(default_factory=dict)

    def ref(self, platform: str) -> Optional[PlatformRef]:
        return self.refs.get(platform)

    @property
    def title(self) -> str:
        return f"{self.name} — {self.city}" if self.city else self.name

    def search_text(self, platform: str) -> str:
        """Текст для поиска организации там, где выдача по id недоступна."""
        ref = self.ref(platform)
        if ref and ref.query:
            return ref.query
        return " ".join(p for p in (self.name, self.city, self.address) if p)


@dataclass
class StoreCard:
    """Данные карточки, полученные с площадки (или ошибка запроса)."""
    platform: str
    store_slug: str
    name: str = ""
    address: str = ""
    url: str = ""
    phone: str = ""
    hours: str = ""
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    error: Optional[str] = None
    #: данные взяты из stores.json, а не с площадки
    from_registry: bool = False

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass(frozen=True)
class Review:
    """Отзыв о магазине на одной из площадок."""
    platform: str
    store_slug: str
    review_id: str
    author: str = ""
    rating: Optional[float] = None
    text: str = ""
    created_at: str = ""
    reply_text: str = ""
    url: str = ""

    @property
    def key(self) -> str:
        """Стабильный ключ для дедупликации между запусками."""
        return f"{self.platform}:{self.store_slug}:{self.review_id}"

    @property
    def answered(self) -> bool:
        return bool(self.reply_text)
