"""Рабочий контур: открытие смены с геометкой, чек-листы, задачи, викторина, отчёты.

Все рабочие callback_data начинаются с "w:", чтобы не пересекаться с чайной частью бота.
"""
import logging
import uuid

from telegram import (
    InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton,
    ReplyKeyboardMarkup, ReplyKeyboardRemove, Update,
)
from telegram.ext import ContextTypes, ApplicationHandlerStop

from . import geo, quiz as quiz_mod, regulations as reg_mod
from .clock import hours_between, now_msk, today_msk
from .config import Person, WorkConfig
from .models import BrewRecord, ChecklistRecord, QuizRecord, ShiftRecord, TaskRecord, TastingRecord

logger = logging.getLogger(__name__)

WORK_CFG = "work_config"
WORK_STORAGE = "work_storage"
WORK_REGULATIONS = "work_regulations"
WORK_QUIZ = "work_quiz"

CB = "w:"  # префикс рабочих кнопок


# ─────────────────────────── доступ к зависимостям ───────────────────────────

def cfg(ctx: ContextTypes.DEFAULT_TYPE) -> WorkConfig:
    return ctx.bot_data[WORK_CFG]


def storage(ctx: ContextTypes.DEFAULT_TYPE):
    return ctx.bot_data[WORK_STORAGE]


def whois(ctx: ContextTypes.DEFAULT_TYPE, tg_id: int) -> Person | None:
    return cfg(ctx).person(tg_id)


# ─────────────────────────────── клавиатуры ──────────────────────────────────

def location_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton("📍 Я на точке", request_location=True)]],
        resize_keyboard=True, one_time_keyboard=True,
    )


def checklist_kb(regulation: reg_mod.Regulation, done: set[str]) -> InlineKeyboardMarkup:
    rows = []
    for item in regulation.items:
        mark = "✅" if item.id in done else "⬜"
        hint = {reg_mod.PROOF_PHOTO: " 📷", reg_mod.PROOF_TEXT: " ✍️"}.get(item.proof, "")
        rows.append([InlineKeyboardButton(
            f"{mark} {item.text}{hint}", callback_data=f"{CB}chk:{regulation.id}:{item.id}",
        )])
    return InlineKeyboardMarkup(rows)


def task_kb(task_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🙋 Взял", callback_data=f"{CB}task:take:{task_id}"),
        InlineKeyboardButton("✅ Сделал", callback_data=f"{CB}task:done:{task_id}"),
        InlineKeyboardButton("⚠️ Проблема", callback_data=f"{CB}task:issue:{task_id}"),
    ]])


def menu_kb(person: Person, regulations: tuple[reg_mod.Regulation, ...]) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(r.title, callback_data=f"{CB}open:{r.id}")]
            for r in regulations if r.when != "close"]
    rows.append([InlineKeyboardButton("🌙 Закрыть смену", callback_data=f"{CB}close")])
    return InlineKeyboardMarkup(rows)


# ──────────────────────────────── смена ──────────────────────────────────────

async def ask_open_shift(bot, person: Person, point, ctx) -> None:
    """Утреннее сообщение: просим геометку. Отправляется планировщиком."""
    await bot.send_message(
        person.tg_id,
        f"☀️ Доброе утро, {person.name}!\n"
        f"Точка: <b>{point.title}</b>, открытие в {point.open_at}.\n\n"
        f"Нажми кнопку — Telegram пришлёт геометку, и смена откроется.",
        parse_mode="HTML", reply_markup=location_kb(),
    )


async def report_distance(update: Update, ctx: ContextTypes.DEFAULT_TYPE, person: Person) -> None:
    """Калибровка точки: где я сейчас и как далеко от записанных координат.

    Координаты из ссылки на карту почти всегда смещены — этой командой их
    проверяют, стоя в магазине, и правят в конфиге.
    """
    loc = update.message.location
    lines = [f"📍 Твои координаты: <code>{loc.latitude:.6f}, {loc.longitude:.6f}</code>",
             "<i>(широта, долгота — в таком порядке их и вписывают в конфиг)</i>", ""]

    points = [cfg(ctx).point_of(person)] if person.point else list(cfg(ctx).points.values())
    for point in filter(None, points):
        if not point.lat or not point.lon:
            lines.append(f"• {point.title}: координаты не заполнены")
            continue
        inside, distance = geo.check(loc.latitude, loc.longitude, point.lat, point.lon, point.radius_m)
        verdict = "внутри зоны" if inside else f"ВНЕ зоны (радиус {point.radius_m} м)"
        lines.append(f"• {point.title}: {distance} м — {verdict}")

    await update.message.reply_text("\n".join(lines), parse_mode="HTML",
                                    reply_markup=ReplyKeyboardRemove())


async def on_location(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = whois(ctx, update.effective_user.id)
    if person is None:
        return  # не сотрудник — геометка бота не касается

    if (ctx.user_data.get("pending") or {}).get("kind") == "geo_check":
        ctx.user_data.pop("pending", None)
        await report_distance(update, ctx, person)
        raise ApplicationHandlerStop

    point = cfg(ctx).point_of(person)
    if point is None:
        await update.message.reply_text(
            "Точка для тебя не задана в конфиге — скажи руководителю.",
            reply_markup=ReplyKeyboardRemove())
        raise ApplicationHandlerStop

    loc = update.message.location
    if point.lat and point.lon:
        inside, distance = geo.check(loc.latitude, loc.longitude, point.lat, point.lon, point.radius_m)
    else:
        inside, distance = True, 0   # координаты точки не заполнены — проверять не с чем
    record = ShiftRecord(
        date=today_msk(), tg_id=person.tg_id, name=person.name, point=point.title,
        opened_at=now_msk().isoformat(timespec="seconds"),
        opened_lat=loc.latitude, opened_lon=loc.longitude,
        geo_ok="да" if inside else f"нет — {distance} м",
    )
    await storage(ctx).append("Смены", record.to_row())
    ctx.user_data["shift_key"] = record.opened_at   # opened_at уникален — по нему потом правим строку

    if not inside:
        await update.message.reply_text(
            f"⚠️ Ты в {distance} м от точки «{point.title}» (радиус {point.radius_m} м).\n"
            f"Смену отметил, но руководителю ушло уведомление.",
            reply_markup=ReplyKeyboardRemove())
        await notify_bosses(ctx, f"⚠️ {person.name} открыл смену в {distance} м от «{point.title}».")
    else:
        await update.message.reply_text(
            f"✅ Смена открыта на «{point.title}». Время: {now_msk():%H:%M}.",
            reply_markup=ReplyKeyboardRemove())

    ctx.user_data["pending"] = {"kind": "shift_photo"}
    await update.message.reply_text("📷 Пришли фото точки — и открываем чек-лист.")
    raise ApplicationHandlerStop


async def close_shift(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = whois(ctx, update.effective_user.id)
    rows = await storage(ctx).rows("Смены")
    opened = next((r for r in reversed(rows)
                   if str(r.get("tg_id")) == str(person.tg_id)
                   and r.get("date") == today_msk() and not r.get("closed_at")), None)
    now = now_msk().isoformat(timespec="seconds")
    if opened:
        await storage(ctx).update_where(
            "Смены", "opened_at", opened["opened_at"],
            {"closed_at": now, "hours": hours_between(opened["opened_at"], now)},
        )
    text = f"🌙 Смена закрыта, {now_msk():%H:%M}."
    if opened and opened.get("opened_at"):
        text += f" Отработано: {hours_between(opened['opened_at'], now)} ч."
    await ctx.bot.send_message(person.tg_id, text)


# ──────────────────────────────── чек-листы ──────────────────────────────────

def _done_set(ctx: ContextTypes.DEFAULT_TYPE, reg_id: str) -> set[str]:
    day = ctx.user_data.setdefault("checklists", {})
    if day.get("date") != today_msk():
        day.clear()
        day["date"] = today_msk()
    return day.setdefault(reg_id, set())


async def send_checklist(bot, chat_id: int, regulation: reg_mod.Regulation, ctx) -> None:
    await bot.send_message(
        chat_id, f"<b>{regulation.title}</b>\nОтмечай по мере выполнения.",
        parse_mode="HTML", reply_markup=checklist_kb(regulation, _done_set(ctx, regulation.id)),
    )


async def _complete_item(update: Update, ctx: ContextTypes.DEFAULT_TYPE, reg_id: str,
                         item: reg_mod.Item, photo_id: str = "", comment: str = "") -> None:
    """Записывает выполненный пункт и обновляет клавиатуру чек-листа."""
    person = whois(ctx, update.effective_user.id)
    point = cfg(ctx).point_of(person)
    await storage(ctx).append("Чек-листы", ChecklistRecord(
        date=today_msk(), tg_id=person.tg_id, name=person.name,
        point=point.title if point else "", regulation=reg_id, item=item.text,
        done_at=now_msk().isoformat(timespec="seconds"), photo_id=photo_id, comment=comment,
    ).to_row())

    # Дегустация — отдельный лист: это учебная база, а не галочка
    if reg_id == "degustaciya" and comment:
        tea_note = ctx.user_data.setdefault("tasting", {})
        tea_note[item.id] = comment
        if len(tea_note) >= 2:
            await storage(ctx).append("Дегустации", TastingRecord(
                date=today_msk(), tg_id=person.tg_id, name=person.name,
                tea=tea_note.get("chay", ""), notes=tea_note.get("chto_uznal", ""),
            ).to_row())
            tea_note.clear()

    done = _done_set(ctx, reg_id)
    done.add(item.id)
    regulation = reg_mod.by_id(ctx.bot_data[WORK_REGULATIONS], reg_id)
    if regulation and len(done) == len(regulation.items):
        await ctx.bot.send_message(person.tg_id, f"✅ {regulation.title} — закрыт полностью. Спасибо!")


# ──────────────────────────────── задачи ─────────────────────────────────────

async def assign_task(ctx: ContextTypes.DEFAULT_TYPE, person: Person, title: str,
                      source: str = "разовая", proof: str = reg_mod.PROOF_TAP, due: str = "") -> TaskRecord:
    task = TaskRecord(
        id=uuid.uuid4().hex[:8], date=today_msk(), tg_id=person.tg_id, name=person.name,
        title=title, source=source, proof=proof, due=due,
    )
    await storage(ctx).append("Задачи", task.to_row())
    due_text = f"\n⏰ До <b>{due}</b>" if due else ""
    await ctx.bot.send_message(
        person.tg_id, f"📋 Новая задача:\n<b>{title}</b>{due_text}",
        parse_mode="HTML", reply_markup=task_kb(task.id),
    )
    return task


async def _set_task_status(ctx, task_id: str, status: str, **patch) -> dict | None:
    rows = await storage(ctx).rows("Задачи")
    task = next((r for r in rows if str(r.get("id")) == task_id), None)
    if task is None:
        return None
    await storage(ctx).update_where("Задачи", "id", task_id, {"status": status, **patch})
    return task


# ─────────────────────────── чай дня и угощения ──────────────────────────────

async def ask_brew(bot, chat_id: int, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Спрашиваем, что заварено. Это ключ ко всему остальному: угощениям и викторине."""
    ctx.user_data["pending"] = {"kind": "brew"}
    await bot.send_message(
        chat_id,
        "🫖 Какой чай сегодня завариваешь? Напиши название — по нему буду напоминать "
        "угощать гостей и спрошу твои впечатления.",
    )


async def save_brew(ctx: ContextTypes.DEFAULT_TYPE, person: Person, tea: str) -> None:
    point = cfg(ctx).point_of(person)
    record = BrewRecord(
        date=today_msk(), tg_id=person.tg_id, name=person.name,
        point=point.title if point else "", tea=tea,
    )
    await storage(ctx).append("Чай дня", record.to_row())
    ctx.user_data["brew"] = {"tea": tea, "date": today_msk(), "treats": 0, "key": record.brewed_at}


def brew_today(ctx: ContextTypes.DEFAULT_TYPE) -> str:
    """Название заваренного сегодня чая, если он есть."""
    brew = ctx.user_data.get("brew") or {}
    return brew.get("tea", "") if brew.get("date") == today_msk() else ""


def treat_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🤝 Угостил гостя", callback_data=f"{CB}treat"),
        InlineKeyboardButton("🫖 Перезаварил другой", callback_data=f"{CB}rebrew"),
    ]])


async def remind_treat(bot, person: Person, user_data: dict) -> None:
    """Напоминание в течение смены: заваренный чай — это инструмент продажи, а не фон."""
    brew = user_data.get("brew") or {}
    if brew.get("date") != today_msk() or not brew.get("tea"):
        return
    await bot.send_message(
        person.tg_id,
        f"🫖 У тебя заварен <b>{brew['tea']}</b>.\n"
        f"Угощай гостей — особенно тех, кто уже что-то покупает: попробовал за прилавком → "
        f"чаще берёт этот чай с собой. Сегодня угостил: {brew.get('treats', 0)}.",
        parse_mode="HTML", reply_markup=treat_kb(),
    )


async def ask_brew_feedback(bot, person: Person, ctx_user_data: dict) -> None:
    """Обратная связь по чаю — каждый раз, когда сотрудник его пьёт."""
    brew = ctx_user_data.get("brew") or {}
    if brew.get("date") != today_msk() or not brew.get("tea"):
        return
    ctx_user_data["pending"] = {"kind": "brew_feedback", "tea": brew["tea"]}
    await bot.send_message(
        person.tg_id,
        f"✍️ Ты сегодня пил <b>{brew['tea']}</b>. Что скажешь?\n"
        f"Вкус, аромат, как заваривал, кому такой чай зайдёт — двух-трёх строк хватит. "
        f"Это идёт в общую базу, из неё потом и собираются ответы гостям.",
        parse_mode="HTML",
    )


# ──────────────────────────────── викторина ──────────────────────────────────

async def send_quiz(bot, person: Person, ctx) -> None:
    all_questions = ctx.bot_data[WORK_QUIZ]
    user_data = ctx.application.user_data[person.tg_id]
    tea = (user_data.get("brew") or {}).get("tea", "")
    questions = quiz_mod.pick(
        all_questions, cfg(ctx).quiz_questions,
        prefer_card=quiz_mod.find_card(all_questions, tea),
    )
    if not questions:
        return
    ctx.application.user_data[person.tg_id]["quiz_queue"] = questions
    await bot.send_message(
        person.tg_id,
        f"🧠 Пятиминутка по чаю — {len(questions)} вопроса(ов). Отвечай как думаешь, это не экзамен.",
    )
    await _ask_next_quiz(bot, person.tg_id, ctx.application.user_data[person.tg_id])


async def _ask_next_quiz(bot, chat_id: int, user_data: dict) -> None:
    queue: list = user_data.get("quiz_queue") or []
    if not queue:
        user_data.pop("quiz_current", None)
        return
    question = queue.pop(0)
    user_data["quiz_current"] = question
    buttons = [[InlineKeyboardButton(opt, callback_data=f"{CB}quiz:{i}")]
               for i, opt in enumerate(question.options)]
    await bot.send_message(
        chat_id, f"<b>{question.card}</b>\n{question.text}",
        parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons),
    )


# ──────────────────────────────── уведомления ────────────────────────────────

async def notify_bosses(ctx: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    for boss in cfg(ctx).bosses:
        try:
            await ctx.bot.send_message(boss.tg_id, text, parse_mode="HTML")
        except Exception as e:
            logger.error("Не отправить руководителю %s: %s", boss.tg_id, e)
