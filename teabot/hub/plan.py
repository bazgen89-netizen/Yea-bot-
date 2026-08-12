"""План работ: задача, план и разбор JSON-ответа роутера.

Модуль ничего не знает ни о LLM, ни о Telegram — только структуры данных
и защита от того, что модель вернёт неполный или битый JSON.
"""
import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

MAX_TASKS = 8

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class Task:
    """Одна задача плана: кто делает, что делает и чего ждёт на входе."""
    id: int
    worker: str
    goal: str
    depends_on: Tuple[int, ...] = ()


@dataclass(frozen=True)
class Plan:
    """Разобранное сообщение: задачи + короткий комментарий роутера."""
    tasks: Tuple[Task, ...] = ()
    note: str = ""

    def __bool__(self) -> bool:
        return bool(self.tasks)

    def by_id(self) -> Dict[int, Task]:
        return {t.id: t for t in self.tasks}


def extract_json(raw: str) -> dict:
    """Достаёт JSON-объект из ответа LLM: с ```-обрамлением или без него."""
    text = raw.strip()
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    else:
        obj = _OBJECT.search(text)
        if obj:
            text = obj.group(0)

    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("ожидался JSON-объект")
    return data


def _clean_deps(raw, own_id: int, seen: Sequence[int]) -> Tuple[int, ...]:
    """Оставляет только зависимости на уже объявленные задачи.

    Ссылка вперёд или на саму себя — почти всегда галлюцинация модели,
    и именно из неё получаются неисполнимые циклы.
    """
    if not isinstance(raw, list):
        return ()
    deps = []
    for dep in raw:
        try:
            dep_id = int(dep)
        except (TypeError, ValueError):
            continue
        if dep_id != own_id and dep_id in seen and dep_id not in deps:
            deps.append(dep_id)
    return tuple(deps)


def parse_plan(raw: str, allowed: Sequence[str]) -> Plan:
    """Превращает ответ роутера в план, отбрасывая всё, что бот не сможет выполнить.

    Битый JSON — это ValueError; а вот отдельная кривая задача просто
    выбрасывается, чтобы остальной план всё-таки поехал.
    """
    data = extract_json(raw)
    note = str(data.get("note", "")).strip()

    tasks: List[Task] = []
    seen: List[int] = []
    for item in data.get("tasks", []) or []:
        if not isinstance(item, dict) or len(tasks) >= MAX_TASKS:
            continue

        worker = str(item.get("worker", "")).strip().lower()
        goal = str(item.get("goal", "")).strip()
        if worker not in allowed or not goal:
            continue

        try:
            task_id = int(item.get("id", len(tasks) + 1))
        except (TypeError, ValueError):
            task_id = len(tasks) + 1
        if task_id in seen:
            continue

        tasks.append(Task(
            id=task_id,
            worker=worker,
            goal=goal,
            depends_on=_clean_deps(item.get("depends_on"), task_id, seen),
        ))
        seen.append(task_id)

    return Plan(tasks=tuple(tasks), note=note)
