"""Диспетчер: разбирает сообщение из общего чата на задачи по исполнителям.

Разбор делает один вызов LLM, а не опрос всех исполнителей: так сообщение
не оплачивается N раз, две задачи не берутся дважды и ни одна не остаётся
ничьей. Роутер не выполняет работу — только раскладывает её.
"""
import logging
from typing import Sequence

from .plan import Plan, parse_plan
from .workers import Deps, Worker, available

logger = logging.getLogger(__name__)

SYSTEM = (
    "Ты диспетчер команды ИИ-исполнителей чайного магазина Waystea. "
    "Разбираешь сообщение владельца на задачи и назначаешь каждую исполнителю. "
    "Отвечаешь ТОЛЬКО JSON-объектом, без пояснений и без markdown."
)

TEMPLATE = """Исполнители:
{roster}

Сообщение владельца:
\"\"\"{message}\"\"\"

Разбери его на задачи. Правила:
- бери только то, что реально просят; не выдумывай задачи «на будущее»
- одна задача — один исполнитель из списка выше
- если задаче нужен результат другой, укажи её id в depends_on
- задача-источник должна идти в списке РАНЬШЕ той, которая от неё зависит
- если это обычный вопрос, а не поручение — верни пустой список tasks
- максимум 6 задач

Формат ответа:
{{"tasks": [{{"id": 1, "worker": "код", "goal": "что сделать", "depends_on": []}}],
 "note": "одна строка: как ты понял задачу"}}"""


def roster(workers: Sequence[Worker]) -> str:
    return "\n".join(f"- {w.code}: {w.can}" for w in workers)


class Router:
    """Превращает свободный текст в план работ."""

    def __init__(self, ai):
        self.ai = ai

    async def plan(self, message: str, deps: Deps) -> Plan:
        workers = available(deps)
        if not workers:
            return Plan(note="Нет ни одного исполнителя с доступами.")

        raw = await self.ai.ask(
            TEMPLATE.format(roster=roster(workers), message=message.strip()),
            system=SYSTEM,
            temperature=0.0,
            max_tokens=700,
        )

        try:
            return parse_plan(raw, [w.code for w in workers])
        except Exception as e:
            logger.warning(f"Роутер вернул неразбираемый ответ: {e}: {raw[:200]}")
            return Plan(note="Не удалось разобрать сообщение на задачи.")
