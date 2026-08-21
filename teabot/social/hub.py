"""Единый хаб соцсетей: один вход для чтения, ответа и публикации.

Хаб ничего не знает про конкретные API — только про контракт коннектора.
Ошибка одной площадки не мешает остальным: сбои собираются в last_errors
и показываются в панели.
"""
import asyncio
import logging
from collections import OrderedDict
from typing import Iterable, Optional

from .base import CAP_INBOX, CAP_PUBLISH, CAP_REPLY, Connector, ConnectorError
from .models import KIND_REVIEW, PublishResult, SocialItem
from .state import SeenStore

logger = logging.getLogger(__name__)

# Сколько последних входящих держим для ответа по кнопке
ITEM_CACHE_SIZE = 300

# Оценка, ниже которой автопилот не отвечает сам, а зовёт человека
AUTOPILOT_MIN_RATING = 4

REPLY_SYSTEM_PROMPT = (
    "Ты — менеджер чайного магазина Waystea. Отвечаешь клиенту в соцсети "
    "от лица магазина: вежливо, по-русски, коротко (2–4 предложения), "
    "без канцелярита и без выдуманных фактов. "
    "Если спрашивают о наличии, цене или сроках — предложи уточнить детали "
    "и подскажи, что можно оформить заказ в Waystea. "
    "Если это отзыв — поблагодари и ответь по существу. "
    "Не обещай скидок и не называй конкретных цен, если их нет в вопросе."
)


class SocialHub:
    """Агрегатор всех подключённых площадок."""

    def __init__(self, connectors: Iterable[Connector], seen: SeenStore,
                 ai=None, autopilot: bool = False):
        self.connectors: list[Connector] = list(connectors)
        self.seen = seen
        self.ai = ai
        self.autopilot = autopilot
        self.last_errors: dict[str, str] = {}
        self._items: "OrderedDict[str, SocialItem]" = OrderedDict()
        self._counter = 0

    # ------------------------------------------------------------------ сети

    @property
    def enabled(self) -> list[Connector]:
        return [c for c in self.connectors if c.enabled]

    def by_network(self, network: str) -> Optional[Connector]:
        return next((c for c in self.enabled if c.network == network), None)

    def with_capability(self, capability: str) -> list[Connector]:
        return [c for c in self.enabled if c.can(capability)]

    # ------------------------------------------------------- кэш входящих

    def remember(self, item: SocialItem) -> str:
        """Кладёт элемент в кэш и возвращает короткий токен для callback_data."""
        self._counter += 1
        token = f"i{self._counter}"
        self._items[token] = item
        while len(self._items) > ITEM_CACHE_SIZE:
            self._items.popitem(last=False)
        return token

    def resolve(self, token: str) -> Optional[SocialItem]:
        return self._items.get(token)

    # -------------------------------------------------------------- чтение

    async def fetch_new(self, limit: int = 10) -> list[SocialItem]:
        """Свежие входящие со всех сетей, без уже показанных, новые — первыми."""
        targets = self.with_capability(CAP_INBOX)
        if not targets:
            return []

        results = await asyncio.gather(
            *(c.fetch(limit) for c in targets), return_exceptions=True
        )
        collected: list[SocialItem] = []
        for connector, result in zip(targets, results):
            if isinstance(result, Exception):
                message = str(result) if isinstance(result, ConnectorError) else repr(result)
                self.last_errors[connector.network] = message[:120]
                logger.warning("Опрос %s не удался: %s", connector.network, message)
                continue
            self.last_errors.pop(connector.network, None)
            collected.extend(result)

        fresh = self.seen.filter_new(collected)
        fresh.sort(key=lambda i: i.created_at, reverse=True)
        self.seen.save()
        return fresh

    # --------------------------------------------------------------- ответ

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        connector = self.by_network(item.network)
        if connector is None:
            return PublishResult(item.network, False, error="сеть не подключена")
        if not connector.can(CAP_REPLY):
            return PublishResult(item.network, False, error="сеть не поддерживает ответы")
        try:
            return await connector.reply(item, text)
        except ConnectorError as e:
            return PublishResult(item.network, False, error=str(e))
        except Exception as e:  # noqa: BLE001 — ответ в одной сети не должен ронять бота
            logger.error("Ответ в %s не отправлен: %s", item.network, e)
            return PublishResult(item.network, False, error=str(e)[:100])

    async def draft_reply(self, item: SocialItem) -> str:
        """Черновик ответа от AI — используется кнопкой «Ответить ИИ» и автопилотом."""
        if self.ai is None:
            return ""
        prompt = (
            f"Площадка: {item.network}. Тип: {item.kind}."
            + (f" Оценка: {item.rating}/5." if item.rating else "")
            + f"\nАвтор: {item.author}\nТекст: {item.text}\n\n"
            "Напиши готовый ответ клиенту — только текст ответа, без пояснений."
        )
        return (await self.ai.ask(prompt, system=REPLY_SYSTEM_PROMPT)).strip()

    def needs_human(self, item: SocialItem) -> bool:
        """Автопилот не отвечает сам на негатив — такие случаи уходят человеку."""
        if item.kind == KIND_REVIEW and (item.rating or 5) < AUTOPILOT_MIN_RATING:
            return True
        return False

    # ---------------------------------------------------------- публикация

    async def publish(self, text: str, link: str = "",
                      networks: Optional[Iterable[str]] = None) -> list[PublishResult]:
        """Кросспостинг во все сети, умеющие публиковать (или в выбранные)."""
        targets = self.with_capability(CAP_PUBLISH)
        if networks is not None:
            wanted = set(networks)
            targets = [c for c in targets if c.network in wanted]
        if not targets:
            return []

        results = await asyncio.gather(
            *(c.publish(text, link) for c in targets), return_exceptions=True
        )
        out: list[PublishResult] = []
        for connector, result in zip(targets, results):
            if isinstance(result, Exception):
                message = str(result) if isinstance(result, ConnectorError) else repr(result)
                self.last_errors[connector.network] = message[:120]
                out.append(PublishResult(connector.network, False, error=message[:100]))
            else:
                out.append(result)
        return out

    # ------------------------------------------------------------- статусы

    async def statuses(self) -> list[tuple[Connector, str]]:
        """Статус каждой площадки для панели /social."""
        results = await asyncio.gather(
            *(c.health_check() for c in self.connectors), return_exceptions=True
        )
        out = []
        for connector, result in zip(self.connectors, results):
            status = result if isinstance(result, str) else f"💥 {str(result)[:60]}"
            out.append((connector, status))
        return out
