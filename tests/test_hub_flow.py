"""Тесты команды /team на упрощённых заглушках Telegram-объектов."""
import asyncio
import json
from types import SimpleNamespace

from teabot.handlers import AI_KEY, SEARCH_KEY, SOCIAL_KEY, SOCIAL_CFG_KEY, hub as flow
from teabot.social import SocialConfig
from tests.test_hub import FakeSearch, FakeSocial
from tests.test_social_flow import FakeMessage, make_update


class ScriptedAI:
    """Отдаёт заготовленные ответы по очереди: сначала план, потом работу."""

    def __init__(self, *answers):
        self.api_key = "k"
        self.answers = list(answers)
        self.calls = []

    async def ask(self, prompt, system=None, temperature=None, max_tokens=None):
        self.calls.append(prompt)
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]


def plan_json(*tasks):
    return json.dumps({"note": "разобрал", "tasks": list(tasks)})


def make_ctx(ai=None, admins=frozenset({42}), args=None):
    return SimpleNamespace(
        user_data={},
        args=args or [],
        bot_data={
            AI_KEY: ai or ScriptedAI(plan_json()),
            SEARCH_KEY: FakeSearch(),
            SOCIAL_KEY: FakeSocial(),
            SOCIAL_CFG_KEY: SocialConfig(networks=("instagram", "facebook"), admins=admins),
        },
    )


def run(coro):
    return asyncio.run(coro)


# --- доступ и режим ---

def test_team_denied_for_non_admin():
    ctx = make_ctx()
    upd = make_update(user_id=999)
    run(flow.team_cmd(upd, ctx))
    assert "администраторам" in upd.message.last_reply
    assert not flow.is_active(ctx)


def test_team_toggles_mode_on_and_off():
    ctx = make_ctx()
    upd = make_update()

    run(flow.team_cmd(upd, ctx))
    assert flow.is_active(ctx)
    assert "включён" in upd.message.last_reply

    run(flow.team_cmd(upd, ctx))
    assert not flow.is_active(ctx)
    assert "выключен" in upd.message.last_reply


def test_team_with_argument_runs_once_without_enabling_mode():
    ai = ScriptedAI(
        plan_json({"id": 1, "worker": "content", "goal": "пост про пуэр"}),
        "Готовый текст",
    )
    ctx = make_ctx(ai=ai, args=["напиши", "пост"])
    upd = make_update()
    run(flow.team_cmd(upd, ctx))

    assert not flow.is_active(ctx)
    assert "напиши пост" in ai.calls[0]
    assert "1 из 1 задач" in upd.message.last_reply


# --- полный цикл ---

def test_message_in_mode_produces_plan_and_report():
    ai = ScriptedAI(
        plan_json(
            {"id": 1, "worker": "content", "goal": "текст поста"},
            {"id": 2, "worker": "smm", "goal": "разложить по сетям", "depends_on": [1]},
        ),
        "Свежий шен пуэр уже на складе",
    )
    ctx = make_ctx(ai=ai)
    ctx.user_data[flow.MODE_KEY] = True

    upd = make_update("нужен пост про новый пуэр и разложи по сетям")
    run(flow.on_text(upd, ctx))

    status = upd.message.replies[0].msg
    assert "Разобрал на задачи:</b> 2" in status.edits[-1].text
    assert "(после #1)" in status.edits[-1].text

    report = upd.message.last_reply
    assert "2 из 2 задач" in report
    assert ctx.bot_data[SOCIAL_KEY].published["text"] == "Свежий шен пуэр уже на складе"


def test_message_without_tasks_reports_politely():
    ctx = make_ctx(ai=ScriptedAI(plan_json()))
    ctx.user_data[flow.MODE_KEY] = True

    upd = make_update("как заваривать улун?")
    run(flow.on_text(upd, ctx))

    status = upd.message.replies[0].msg
    assert "🤔" in status.edits[-1].text
    assert ctx.bot_data[SOCIAL_KEY].published is None


def test_long_report_is_split_into_several_messages():
    msg = FakeMessage()
    long_report = "\n\n".join(f"строка {i} " + "x" * 200 for i in range(60))
    run(flow._send_long(msg, long_report))

    parts = [r.text for r in msg.replies]
    assert len(parts) >= 2
    assert all(len(p) <= flow.TG_LIMIT for p in parts)
    # ни один абзац не потерян при разрезании
    assert sum(p.count("строка ") for p in parts) == 60


def test_short_report_stays_in_one_message():
    msg = FakeMessage()
    run(flow._send_long(msg, "короткий отчёт"))
    assert [r.text for r in msg.replies] == ["короткий отчёт"]
