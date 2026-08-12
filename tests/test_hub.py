"""Тесты разбора плана, реестра исполнителей и их запуска."""
import asyncio
import json

import pytest

from teabot.hub.plan import MAX_TASKS, Plan, Task, extract_json, parse_plan
from teabot.hub.router import Router, roster
from teabot.hub.runner import format_plan, format_results, run_plan
from teabot.hub.workers import Deps, available

ALLOWED = ["content", "research", "smm"]


def run(coro):
    return asyncio.run(coro)


# --- разбор ответа роутера ---

def test_extract_json_from_code_fence():
    raw = 'Вот план:\n```json\n{"tasks": []}\n```'
    assert extract_json(raw) == {"tasks": []}


def test_extract_json_from_bare_text():
    assert extract_json('бла {"tasks": [], "note": "ок"} бла')["note"] == "ок"


def test_parse_plan_reads_tasks_and_note():
    raw = json.dumps({
        "note": "нужен пост",
        "tasks": [
            {"id": 1, "worker": "content", "goal": "текст про пуэр", "depends_on": []},
            {"id": 2, "worker": "smm", "goal": "опубликовать", "depends_on": [1]},
        ],
    })
    plan = parse_plan(raw, ALLOWED)

    assert plan.note == "нужен пост"
    assert [t.worker for t in plan.tasks] == ["content", "smm"]
    assert plan.tasks[1].depends_on == (1,)
    assert bool(plan) is True


def test_parse_plan_drops_unknown_worker():
    raw = json.dumps({"tasks": [
        {"id": 1, "worker": "telepathy", "goal": "угадать"},
        {"id": 2, "worker": "content", "goal": "написать"},
    ]})
    plan = parse_plan(raw, ALLOWED)
    assert [t.worker for t in plan.tasks] == ["content"]


def test_parse_plan_drops_task_without_goal():
    raw = json.dumps({"tasks": [{"id": 1, "worker": "content", "goal": "  "}]})
    assert parse_plan(raw, ALLOWED).tasks == ()


def test_parse_plan_drops_forward_and_self_dependencies():
    raw = json.dumps({"tasks": [
        {"id": 1, "worker": "content", "goal": "а", "depends_on": [2, 1, 99]},
        {"id": 2, "worker": "smm", "goal": "б", "depends_on": [1]},
    ]})
    plan = parse_plan(raw, ALLOWED)
    assert plan.tasks[0].depends_on == ()
    assert plan.tasks[1].depends_on == (1,)


def test_parse_plan_ignores_duplicate_ids():
    raw = json.dumps({"tasks": [
        {"id": 1, "worker": "content", "goal": "первая"},
        {"id": 1, "worker": "research", "goal": "вторая"},
    ]})
    assert len(parse_plan(raw, ALLOWED).tasks) == 1


def test_parse_plan_caps_task_count():
    raw = json.dumps({"tasks": [
        {"id": i, "worker": "content", "goal": f"задача {i}"} for i in range(1, 20)
    ]})
    assert len(parse_plan(raw, ALLOWED).tasks) == MAX_TASKS


def test_parse_plan_rejects_broken_json():
    with pytest.raises(Exception):
        parse_plan("это вообще не json", ALLOWED)


def test_empty_plan_is_falsy():
    assert not Plan()


# --- реестр исполнителей ---

class FakeAI:
    def __init__(self, answer="ok", api_key="k"):
        self.api_key = api_key
        self.answer = answer
        self.calls = []

    async def ask(self, prompt, system=None, temperature=None, max_tokens=None):
        self.calls.append({"prompt": prompt, "system": system})
        return self.answer


class FakeSearch:
    def __init__(self, data="данные", api_key="k"):
        self.api_key = api_key
        self.data = data

    async def search_china(self, q):
        return self.data


class FakeSocial:
    def __init__(self, enabled=True):
        self.enabled = enabled
        self.published = None

    async def publish(self, text, networks, media=None, draft=False, **kw):
        from teabot.services.social import PostResult
        self.published = {"text": text, "networks": networks, "draft": draft}
        return [PostResult(n, True, "черновик создан") for n in networks]


def make_deps(**over):
    args = dict(
        ai=FakeAI(), search=FakeSearch(), social=FakeSocial(),
        networks=("instagram", "facebook"),
    )
    args.update(over)
    return Deps(**args)


def test_available_hides_workers_without_credentials():
    deps = make_deps(ai=FakeAI(api_key=""), social=FakeSocial(enabled=False))
    codes = [w.code for w in available(deps)]
    assert codes == ["research"]


def test_available_hides_smm_without_networks():
    codes = [w.code for w in available(make_deps(networks=()))]
    assert "smm" not in codes


def test_roster_lists_codes_for_prompt():
    text = roster(available(make_deps()))
    assert "content:" in text and "smm:" in text


# --- исполнение плана ---

def test_run_plan_passes_output_into_dependent_task():
    social = FakeSocial()
    deps = make_deps(ai=FakeAI("Готовый текст поста"), social=social)
    plan = Plan(tasks=(
        Task(1, "content", "написать пост"),
        Task(2, "smm", "опубликовать", depends_on=(1,)),
    ))

    results = run(run_plan(deps, plan))
    assert all(r.ok for r in results)
    assert social.published["text"] == "Готовый текст поста"
    assert social.published["draft"] is True  # автопост всегда через черновик


def test_run_plan_skips_task_when_its_source_failed():
    class Boom(FakeAI):
        async def ask(self, *a, **kw):
            raise RuntimeError("нет связи")

    deps = make_deps(ai=Boom())
    plan = Plan(tasks=(
        Task(1, "content", "написать"),
        Task(2, "smm", "опубликовать", depends_on=(1,)),
    ))

    results = run(run_plan(deps, plan))
    assert results[0].status == "fail"
    assert results[1].status == "skip"
    assert deps.social.published is None


def test_run_plan_breaks_dependency_cycle():
    plan = Plan(tasks=(
        Task(1, "content", "а", depends_on=(2,)),
        Task(2, "content", "б", depends_on=(1,)),
    ))
    results = run(run_plan(make_deps(), plan))
    assert [r.status for r in results] == ["skip", "skip"]
    assert "зависимость" in results[0].output


def test_run_plan_runs_independent_tasks_together():
    deps = make_deps()
    plan = Plan(tasks=(
        Task(1, "content", "текст"),
        Task(2, "research", "факты"),
    ))
    results = run(run_plan(deps, plan))
    assert [r.status for r in results] == ["ok", "ok"]


def test_run_plan_marks_unknown_worker_as_failed():
    plan = Plan(tasks=(Task(1, "ghost", "нечто"),))
    assert run(run_plan(make_deps(), plan))[0].status == "fail"


def test_research_falls_back_to_llm_without_search_results():
    deps = make_deps(search=FakeSearch(data=""), ai=FakeAI("ответ по памяти"))
    results = run(run_plan(deps, Plan(tasks=(Task(1, "research", "цены"),))))
    assert results[0].output == "ответ по памяти"
    assert "Поиск ничего не дал" in deps.ai.calls[-1]["prompt"]


# --- отчёты ---

def test_format_plan_shows_dependencies():
    plan = Plan(tasks=(
        Task(1, "content", "написать"),
        Task(2, "smm", "запостить", depends_on=(1,)),
    ), note="разобрал")
    text = format_plan(plan)
    assert "разобрал" in text and "(после #1)" in text


def test_format_results_counts_and_escapes():
    deps = make_deps(ai=FakeAI("<b>текст</b>"))
    results = run(run_plan(deps, Plan(tasks=(Task(1, "content", "написать"),))))
    text = format_results(results)
    assert "1 из 1 задач" in text
    assert "&lt;b&gt;текст&lt;/b&gt;" in text


# --- роутер целиком ---

def test_router_returns_parsed_plan():
    ai = FakeAI(json.dumps({"note": "ок", "tasks": [
        {"id": 1, "worker": "content", "goal": "пост"},
    ]}))
    plan = run(Router(ai).plan("напиши пост", make_deps(ai=ai)))
    assert plan.tasks[0].worker == "content"
    assert "напиши пост" in ai.calls[0]["prompt"]


def test_router_survives_garbage_answer():
    ai = FakeAI("извините, не понял")
    plan = run(Router(ai).plan("что-то", make_deps(ai=ai)))
    assert plan.tasks == ()
    assert "разобрать" in plan.note


def test_router_reports_when_no_workers_configured():
    deps = make_deps(ai=FakeAI(api_key=""), search=FakeSearch(api_key=""),
                     social=FakeSocial(enabled=False))
    plan = run(Router(deps.ai).plan("сделай всё", deps))
    assert plan.tasks == ()
    assert "исполнител" in plan.note
