"""Расписание смены: утро, напоминания про заваренный чай, викторина, закрытие, сводка.

Всё время — московское (см. clock.py). Задания ставятся на job_queue PTB.
"""
import logging
import random
from datetime import timedelta

from telegram.ext import Application, ContextTypes

from . import handlers as H, regulations as reg_mod
from .clock import now_msk, parse_hhmm, today_msk
from .config import Person, WorkConfig

logger = logging.getLogger(__name__)

# Когда в течение дня напоминать про заваренный чай
TREAT_REMINDERS = ("12:30", "15:30", "18:30")
FEEDBACK_ASK = "17:30"
OVERDUE_CHECK_MINUTES = 15

CONSENT_TEXT = (
    "ℹ️ <b>Как работает бот</b>\n\n"
    "Бот фиксирует: время открытия и закрытия смены, геометку в момент открытия "
    "(разово, по нажатию кнопки — постоянного отслеживания нет), выполнение пунктов "
    "регламента, задачи и ответы на вопросы по чаю.\n\n"
    "Данные видит руководитель. Это рабочий учёт, а не слежка: между сменами и вне "
    "открытия смены бот ничего не фиксирует.\n\n"
    "Вопросы — руководителю. Посмотреть этот текст снова: /правила"
)


def _works_today(person: Person) -> bool:
    return now_msk().weekday() in person.workdays


async def _morning(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    for person in cfg.staff:
        if not _works_today(person):
            continue
        point = cfg.point_of(person)
        if point is None:
            continue
        try:
            await H.ask_open_shift(ctx.bot, person, point, ctx)
        except Exception as e:
            logger.error("Утреннее сообщение для %s не ушло: %s", person.name, e)


async def _treat_reminder(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    for person in cfg.staff:
        if not _works_today(person):
            continue
        try:
            await H.remind_treat(ctx.bot, person, ctx.application.user_data[person.tg_id])
        except Exception as e:
            logger.error("Напоминание про чай для %s не ушло: %s", person.name, e)


async def _ask_feedback(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    for person in cfg.staff:
        if not _works_today(person):
            continue
        try:
            await H.ask_brew_feedback(ctx.bot, person, ctx.application.user_data[person.tg_id])
        except Exception as e:
            logger.error("Запрос отзыва для %s не ушёл: %s", person.name, e)


async def _quiz_window_open(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Ставит викторину на случайную минуту внутри окна — чтобы её не ждали по часам."""
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    start, end = (parse_hhmm(v) for v in cfg.quiz_window)
    span = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    delay = random.randint(0, max(span, 1)) * 60
    ctx.job_queue.run_once(_run_quiz, when=delay, name="quiz-run")


async def _run_quiz(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    if not ctx.bot_data.get(H.WORK_QUIZ):
        return
    for person in cfg.staff:
        if not _works_today(person):
            continue
        try:
            await H.send_quiz(ctx.bot, person, ctx)
        except Exception as e:
            logger.error("Викторина для %s не ушла: %s", person.name, e)


async def _evening(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: WorkConfig = ctx.bot_data[H.WORK_CFG]
    regulations = ctx.bot_data[H.WORK_REGULATIONS]
    for person in cfg.staff:
        if not _works_today(person):
            continue
        try:
            for regulation in reg_mod.for_moment(regulations, "close"):
                await H.send_checklist(ctx.bot, person.tg_id, regulation, ctx)
            await ctx.bot.send_message(
                person.tg_id,
                "Закончишь — нажми «🌙 Закрыть смену» в меню /start.",
            )
        except Exception as e:
            logger.error("Вечернее сообщение для %s не ушло: %s", person.name, e)


async def _digest(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    from .router import build_digest
    text = await build_digest(ctx)
    await H.notify_bosses(ctx, text)


async def _check_overdue(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Задача с дедлайном, которую не закрыли — уходит руководителю один раз."""
    store = H.storage(ctx)
    notified: set[str] = ctx.bot_data.setdefault("overdue_notified", set())
    now = now_msk().strftime("%H:%M")
    for task in await store.rows("Задачи"):
        due, task_id = str(task.get("due", "")), str(task.get("id"))
        if not due or task_id in notified:
            continue
        if task.get("date") != today_msk() or task.get("status") == "сделана":
            continue
        if due <= now:
            notified.add(task_id)
            await store.update_where("Задачи", "id", task_id, {"status": "просрочена"})
            await H.notify_bosses(
                ctx, f"⏰ Просрочено: <b>{task.get('name')}</b> — «{task.get('title')}» (до {due})")


async def send_consent_notice(app: Application) -> None:
    """Уведомление о том, что бот фиксирует время и геометку. Без него учёт незаконен."""
    cfg: WorkConfig = app.bot_data[H.WORK_CFG]
    for person in cfg.staff:
        try:
            await app.bot.send_message(person.tg_id, CONSENT_TEXT, parse_mode="HTML")
        except Exception as e:
            logger.warning("Уведомление для %s не доставлено: %s", person.name, e)


def schedule_jobs(app: Application) -> None:
    cfg: WorkConfig = app.bot_data[H.WORK_CFG]
    jq = app.job_queue
    if jq is None:
        logger.error("❌ job_queue недоступен — расписание не поставлено")
        return

    jq.run_daily(_morning, parse_hhmm(cfg.morning_reminder), name="morning")
    jq.run_daily(_evening, parse_hhmm(cfg.evening_close), name="evening")
    jq.run_daily(_digest, parse_hhmm(cfg.boss_digest), name="digest")
    jq.run_daily(_quiz_window_open, parse_hhmm(cfg.quiz_window[0]), name="quiz-window")
    jq.run_daily(_ask_feedback, parse_hhmm(FEEDBACK_ASK), name="brew-feedback")
    for hhmm in TREAT_REMINDERS:
        jq.run_daily(_treat_reminder, parse_hhmm(hhmm), name=f"treat-{hhmm}")
    jq.run_repeating(_check_overdue, interval=timedelta(minutes=OVERDUE_CHECK_MINUTES),
                     first=timedelta(minutes=2), name="overdue")

    logger.info("🗓 Расписание: утро %s, вечер %s, сводка %s, викторина %s-%s (МСК)",
                cfg.morning_reminder, cfg.evening_close, cfg.boss_digest, *cfg.quiz_window)
