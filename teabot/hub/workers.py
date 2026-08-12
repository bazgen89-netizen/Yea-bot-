"""Реестр исполнителей: кто что умеет и как это выполняется.

Роутер видит только поля `code` и `can` — описания попадают в промпт,
поэтому новый исполнитель подключается добавлением одного объекта Worker,
без правок роутера и обработчиков.
"""
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional, Sequence

from .plan import Task

logger = logging.getLogger(__name__)


@dataclass
class Deps:
    """Клиенты внешних сервисов, доступные исполнителям."""
    ai: object
    search: object
    social: object
    networks: Sequence[str] = ()


Runner = Callable[[Deps, Task, Sequence[str]], Awaitable[str]]


@dataclass(frozen=True)
class Worker:
    code: str
    title: str
    can: str
    run: Runner
    # Исполнитель без своих доступов не попадает ни в промпт, ни в план
    ready: Callable[[Deps], bool] = lambda deps: True


def _context(inputs: Sequence[str]) -> str:
    """Результаты задач-предшественников, которые нужно учесть."""
    if not inputs:
        return ""
    joined = "\n\n".join(inputs)
    return f"\n\nРезультаты предыдущих шагов, опирайся на них:\n{joined}"


COPYWRITER = (
    "Ты SMM-копирайтер чайного магазина Waystea. Пишешь живо, конкретно и "
    "по-русски, без канцелярита и без выдуманных фактов. "
    "Возвращай только готовый текст, без пояснений и заголовков вроде «Вот пост»."
)

ANALYST = (
    "Ты аналитик. Отвечаешь кратко и по делу на русском языке, "
    "только фактами из предоставленных данных. Максимум 10 строк."
)


async def _run_content(deps: Deps, task: Task, inputs: Sequence[str]) -> str:
    return await deps.ai.ask(
        f"Задача: {task.goal}{_context(inputs)}",
        system=COPYWRITER,
        temperature=0.7,
    )


async def _run_research(deps: Deps, task: Task, inputs: Sequence[str]) -> str:
    data = await deps.search.search_china(task.goal)
    if not data:
        return await deps.ai.ask(
            f"Поиск ничего не дал. Ответь по своим знаниям: {task.goal}",
            system=ANALYST,
        )
    return await deps.ai.ask(
        f"Вопрос: {task.goal}\n\nДанные поиска (китайский переведи на русский):\n{data}",
        system=ANALYST,
    )


async def _run_smm(deps: Deps, task: Task, inputs: Sequence[str]) -> str:
    """Кладёт пост в черновики Metricool.

    Именно черновик, а не публикация: текст, собранный автоматически по одной
    фразе в чате, должен пройти через глаза человека. Прямая публикация —
    это команда /post с предпросмотром и кнопкой.
    """
    text = (inputs[0] if inputs else task.goal).strip()
    results = await deps.social.publish(text, list(deps.networks), draft=True)
    ok = [r.network for r in results if r.ok]
    bad = [f"{r.network} ({r.detail})" for r in results if not r.ok]

    lines = [f"черновик в {len(ok)} из {len(results)} сетей"]
    if bad:
        lines.append("не прошли: " + ", ".join(bad))
    lines.append("проверьте и опубликуйте в Metricool или командой /post")
    return "; ".join(lines)


ALL_WORKERS: Dict[str, Worker] = {
    w.code: w for w in (
        Worker(
            code="content",
            title="✍️ Копирайтер",
            can="пишет тексты: посты, описания товаров, письма, сценарии",
            run=_run_content,
            ready=lambda deps: bool(getattr(deps.ai, "api_key", "")),
        ),
        Worker(
            code="research",
            title="🔍 Аналитик",
            can="ищет факты и цифры в китайских и российских источниках",
            run=_run_research,
            ready=lambda deps: bool(getattr(deps.search, "api_key", "")),
        ),
        Worker(
            code="smm",
            title="📡 SMM",
            can="кладёт готовый текст черновиком во все соцсети бренда",
            run=_run_smm,
            ready=lambda deps: bool(getattr(deps.social, "enabled", False)) and bool(deps.networks),
        ),
    )
}


def available(deps: Deps) -> List[Worker]:
    """Исполнители, у которых есть все нужные доступы."""
    return [w for w in ALL_WORKERS.values() if w.ready(deps)]


def get(code: str) -> Optional[Worker]:
    return ALL_WORKERS.get(code)


def title(code: str) -> str:
    worker = ALL_WORKERS.get(code)
    return worker.title if worker else code
