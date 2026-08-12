"""Единый чат-штаб: одно сообщение → план задач → исполнители → отчёт."""
from .plan import Plan, Task, parse_plan
from .router import Router
from .runner import TaskResult, format_plan, format_results, run_plan
from .workers import Deps, Worker, available

__all__ = [
    "Plan", "Task", "parse_plan", "Router", "TaskResult",
    "format_plan", "format_results", "run_plan", "Deps", "Worker", "available",
]
