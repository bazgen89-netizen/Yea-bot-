"""Исполнение плана: волнами, с учётом зависимостей между задачами.

Независимые задачи идут параллельно; задача с depends_on ждёт свои источники
и получает их результаты на вход. Если источник упал — зависимая не запускается,
чтобы не публиковать пост из текста, которого не получилось.
"""
import asyncio
import html
import logging
from dataclasses import dataclass
from typing import Dict, List, Sequence

from . import workers as roster
from .plan import Plan, Task
from .workers import Deps

logger = logging.getLogger(__name__)

OK, FAIL, SKIP = "ok", "fail", "skip"
MARKS = {OK: "✅", FAIL: "❌", SKIP: "⏭"}
OUTPUT_LIMIT = 700


@dataclass(frozen=True)
class TaskResult:
    task: Task
    status: str
    output: str

    @property
    def ok(self) -> bool:
        return self.status == OK


async def _run_task(deps: Deps, task: Task, inputs: Sequence[str]) -> TaskResult:
    worker = roster.get(task.worker)
    if worker is None:
        return TaskResult(task, FAIL, "исполнитель недоступен")
    try:
        output = await worker.run(deps, task, inputs)
        return TaskResult(task, OK, (output or "").strip() or "пустой результат")
    except Exception as e:
        logger.error(f"Задача {task.id} ({task.worker}) упала: {e}")
        return TaskResult(task, FAIL, str(e)[:200])


async def run_plan(deps: Deps, plan: Plan) -> List[TaskResult]:
    """Выполняет план и возвращает результаты в порядке задач плана."""
    done: Dict[int, TaskResult] = {}
    pending: List[Task] = list(plan.tasks)

    while pending:
        ready = [t for t in pending if all(d in done for d in t.depends_on)]
        if not ready:
            # Зависимость не появится уже никогда — обычно это цикл в ответе роутера
            for task in pending:
                done[task.id] = TaskResult(task, SKIP, "неисполнимая зависимость")
            break

        blocked = [t for t in ready if any(not done[d].ok for d in t.depends_on)]
        for task in blocked:
            done[task.id] = TaskResult(task, SKIP, "предыдущий шаг не выполнен")

        runnable = [t for t in ready if t not in blocked]
        if runnable:
            results = await asyncio.gather(*(
                _run_task(deps, t, [done[d].output for d in t.depends_on])
                for t in runnable
            ))
            for result in results:
                done[result.task.id] = result

        pending = [t for t in pending if t.id not in done]

    return [done[t.id] for t in plan.tasks if t.id in done]


def format_plan(plan: Plan) -> str:
    """Что бот собирается делать — показывается до начала работы."""
    lines = [f"🧠 <b>Разобрал на задачи:</b> {len(plan.tasks)}"]
    if plan.note:
        lines.append(f"<i>{html.escape(plan.note)}</i>")
    lines.append("")
    for task in plan.tasks:
        after = f" (после {', '.join(f'#{d}' for d in task.depends_on)})" if task.depends_on else ""
        lines.append(
            f"{task.id}. {roster.title(task.worker)} — {html.escape(task.goal)}{after}"
        )
    return "\n".join(lines)


def format_results(results: Sequence[TaskResult]) -> str:
    """Итог работы команды: по строке-заголовку на задачу плюс её результат."""
    ok = sum(1 for r in results if r.ok)
    lines = [f"📋 <b>Готово:</b> {ok} из {len(results)} задач", ""]
    for r in results:
        output = r.output[:OUTPUT_LIMIT] + ("…" if len(r.output) > OUTPUT_LIMIT else "")
        lines.append(
            f"{MARKS.get(r.status, '•')} <b>{roster.title(r.task.worker)}</b> — "
            f"{html.escape(r.task.goal)}"
        )
        lines.append(f"{html.escape(output)}\n")
    return "\n".join(lines).strip()
