"""Маршрутизация рабочих обновлений: команды, кнопки, фото и текстовые ответы.

Рабочие обработчики живут в группе 0 и при срабатывании останавливают разбор
(ApplicationHandlerStop), поэтому чайная часть бота (группа 1) их не видит.
Сообщения от людей вне списка сотрудников проходят насквозь — клиенты как и
раньше попадают к чайному эксперту.
"""
import logging

from telegram import Update
from telegram.ext import (
    Application, ApplicationHandlerStop, CallbackQueryHandler,
    CommandHandler, ContextTypes, MessageHandler, filters,
)

from . import handlers as H, quiz as quiz_mod, regulations as reg_mod
from .clock import now_msk, today_msk
from .models import QuizRecord, TastingRecord

logger = logging.getLogger(__name__)


# ──────────────────────────────── команды ────────────────────────────────────

async def myid_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Нужна, чтобы заполнить work_config.json — Telegram нигде не показывает id."""
    await update.message.reply_text(f"Твой Telegram ID: <code>{update.effective_user.id}</code>",
                                    parse_mode="HTML")
    raise ApplicationHandlerStop


async def work_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        return  # не сотрудник — пусть отвечает чайный бот
    regulations = ctx.bot_data[H.WORK_REGULATIONS]
    if person.is_boss:
        await update.message.reply_text(
            "🍵 Рабочая панель руководителя\n\n"
            "/сводка — что сделано сегодня\n"
            "/задача Имя текст до 18:00 — поставить задачу\n"
            "/люди — состав и точки",
        )
    else:
        point = ctx.bot_data[H.WORK_CFG].point_of(person)
        await update.message.reply_text(
            f"Привет, {person.name}! Точка: {point.title if point else 'не задана'}.\n"
            f"Выбери, что открываем:",
            reply_markup=H.menu_kb(person, regulations),
        )
    raise ApplicationHandlerStop


async def rules_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """/правила — что именно бот фиксирует. Сотрудник должен видеть это в любой момент."""
    from .scheduler import CONSENT_TEXT
    if H.whois(ctx, update.effective_user.id) is None:
        return
    await update.message.reply_text(CONSENT_TEXT, parse_mode="HTML")
    raise ApplicationHandlerStop


async def brew_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """/чай — сменить заваренный чай в течение смены."""
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        return
    await H.ask_brew(ctx.bot, person.tg_id, ctx)
    raise ApplicationHandlerStop


async def feedback_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """/отзыв — записать впечатление о чае, который сейчас пьёшь."""
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        return
    if H.brew_today(ctx):
        await H.ask_brew_feedback(ctx.bot, person, ctx.user_data)
    else:
        await H.ask_brew(ctx.bot, person.tg_id, ctx)
    raise ApplicationHandlerStop


async def digest_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = H.whois(ctx, update.effective_user.id)
    if person is None or not person.is_boss:
        return
    await update.message.reply_text(await build_digest(ctx), parse_mode="HTML")
    raise ApplicationHandlerStop


async def people_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = H.whois(ctx, update.effective_user.id)
    if person is None or not person.is_boss:
        return
    cfg = ctx.bot_data[H.WORK_CFG]
    lines = ["<b>Команда</b>"]
    for p in cfg.people.values():
        point = cfg.points.get(p.point)
        lines.append(f"• {p.name} — {'руководитель' if p.is_boss else (point.title if point else 'без точки')}")
    await update.message.reply_text("\n".join(lines), parse_mode="HTML")
    raise ApplicationHandlerStop


async def task_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """/задача Имя текст задачи до 18:00"""
    person = H.whois(ctx, update.effective_user.id)
    if person is None or not person.is_boss:
        return
    raw = " ".join(ctx.args or [])
    if not raw:
        await update.message.reply_text("Формат: /задача Имя что сделать до 18:00")
        raise ApplicationHandlerStop

    cfg = ctx.bot_data[H.WORK_CFG]
    target = next((p for p in cfg.staff if raw.lower().startswith(p.name.lower())), None)
    if target is None:
        names = ", ".join(p.name for p in cfg.staff) or "никого нет в конфиге"
        await update.message.reply_text(f"Не понял, кому. Есть: {names}")
        raise ApplicationHandlerStop

    title = raw[len(target.name):].strip()
    due = ""
    if " до " in title:
        title, _, due = title.rpartition(" до ")
        title, due = title.strip(), due.strip()

    await H.assign_task(ctx, target, title, due=due)
    await update.message.reply_text(f"✅ Задача ушла: {target.name} — «{title}»" + (f", до {due}" if due else ""))
    raise ApplicationHandlerStop


# ──────────────────────────────── кнопки ─────────────────────────────────────

async def on_work_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        await query.answer()
        raise ApplicationHandlerStop

    parts = query.data[len(H.CB):].split(":")
    kind = parts[0]

    if kind == "open":
        regulation = reg_mod.by_id(ctx.bot_data[H.WORK_REGULATIONS], parts[1])
        await query.answer()
        if regulation:
            await H.send_checklist(ctx.bot, person.tg_id, regulation, ctx)

    elif kind == "chk":
        await _on_checklist_tap(update, ctx, reg_id=parts[1], item_id=parts[2])

    elif kind == "close":
        await query.answer()
        closing = reg_mod.for_moment(ctx.bot_data[H.WORK_REGULATIONS], "close")
        for regulation in closing:
            await H.send_checklist(ctx.bot, person.tg_id, regulation, ctx)
        await H.close_shift(update, ctx)

    elif kind == "task":
        await _on_task_tap(update, ctx, action=parts[1], task_id=parts[2])

    elif kind == "treat":
        brew = ctx.user_data.get("brew") or {}
        brew["treats"] = brew.get("treats", 0) + 1
        await H.storage(ctx).update_where(
            "Чай дня", "brewed_at", brew.get("key", ""), {"treats": brew["treats"]})
        await query.answer(f"Записал. Сегодня угостил: {brew['treats']}")

    elif kind == "rebrew":
        await query.answer()
        await H.ask_brew(ctx.bot, person.tg_id, ctx)

    elif kind == "quiz":
        await _on_quiz_answer(update, ctx, choice=int(parts[1]))

    raise ApplicationHandlerStop


async def _on_checklist_tap(update: Update, ctx: ContextTypes.DEFAULT_TYPE, reg_id: str, item_id: str) -> None:
    query = update.callback_query
    regulation = reg_mod.by_id(ctx.bot_data[H.WORK_REGULATIONS], reg_id)
    item = next((i for i in regulation.items if i.id == item_id), None) if regulation else None
    if item is None:
        await query.answer("Пункт не найден")
        return

    if item.proof == reg_mod.PROOF_PHOTO:
        ctx.user_data["pending"] = {"kind": "chk_photo", "reg": reg_id, "item": item_id}
        await query.answer()
        await query.message.reply_text(f"📷 Пришли фото: {item.text}")
        return
    if item.proof == reg_mod.PROOF_TEXT:
        ctx.user_data["pending"] = {"kind": "chk_text", "reg": reg_id, "item": item_id}
        await query.answer()
        await query.message.reply_text(f"✍️ Ответь сообщением: {item.text}")
        return

    await H._complete_item(update, ctx, reg_id, item)
    await query.answer("Отмечено")
    await query.edit_message_reply_markup(H.checklist_kb(regulation, H._done_set(ctx, reg_id)))


async def _on_task_tap(update: Update, ctx: ContextTypes.DEFAULT_TYPE, action: str, task_id: str) -> None:
    query = update.callback_query
    now = now_msk().isoformat(timespec="seconds")

    if action == "take":
        await H._set_task_status(ctx, task_id, "взята", taken_at=now)
        await query.answer("Взял")
        await query.edit_message_reply_markup(H.task_kb(task_id))
        return

    if action == "issue":
        ctx.user_data["pending"] = {"kind": "task_issue", "task": task_id}
        await query.answer()
        await query.message.reply_text("⚠️ Опиши, что не так — передам руководителю.")
        return

    task = await H._set_task_status(ctx, task_id, "сделана", done_at=now)
    await query.answer("Готово")
    if task and task.get("proof") in (reg_mod.PROOF_PHOTO, reg_mod.PROOF_TEXT):
        ctx.user_data["pending"] = {"kind": "task_proof", "task": task_id, "proof": task["proof"]}
        ask = "📷 Пришли фото результата" if task["proof"] == reg_mod.PROOF_PHOTO else "✍️ Напиши результат"
        await query.message.reply_text(ask)
    else:
        await query.message.reply_text("✅ Записал.")


async def _on_quiz_answer(update: Update, ctx: ContextTypes.DEFAULT_TYPE, choice: int) -> None:
    query = update.callback_query
    person = H.whois(ctx, update.effective_user.id)
    question = ctx.user_data.get("quiz_current")
    if question is None:
        await query.answer("Вопрос уже закрыт")
        return

    correct = choice == question.answer
    await H.storage(ctx).append("Викторина", QuizRecord(
        date=today_msk(), tg_id=person.tg_id, name=person.name, card=question.card,
        question=question.text, answer=question.options[choice], correct="да" if correct else "нет",
    ).to_row())

    await query.answer("Верно!" if correct else "Мимо")
    verdict = "✅ Верно." if correct else f"❌ Нет. Правильно: <b>{question.correct_option}</b>"
    explain = f"\n<i>{question.explain}</i>" if question.explain else ""
    await query.edit_message_text(f"{question.text}\n\n{verdict}{explain}", parse_mode="HTML")
    await H._ask_next_quiz(ctx.bot, person.tg_id, ctx.user_data)


# ──────────────────── фото и текст как подтверждение ─────────────────────────

async def on_work_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        return
    pending = ctx.user_data.get("pending")
    if not pending:
        await update.message.reply_text("Фото принял, но сейчас оно ни к чему не привязано.")
        raise ApplicationHandlerStop

    photo_id = update.message.photo[-1].file_id
    ctx.user_data.pop("pending", None)

    if pending["kind"] == "shift_photo":
        await H.storage(ctx).update_where(
            "Смены", "opened_at", ctx.user_data.get("shift_key", ""), {"photo_id": photo_id})
        regulations = reg_mod.for_moment(ctx.bot_data[H.WORK_REGULATIONS], "open")
        await update.message.reply_text("✅ Принято. Открываю чек-лист смены.")
        for regulation in regulations:
            await H.send_checklist(ctx.bot, person.tg_id, regulation, ctx)
        await update.message.reply_text(
            "Остальное — в меню:", reply_markup=H.menu_kb(person, ctx.bot_data[H.WORK_REGULATIONS]))
        await H.ask_brew(ctx.bot, person.tg_id, ctx)

    elif pending["kind"] == "chk_photo":
        regulation = reg_mod.by_id(ctx.bot_data[H.WORK_REGULATIONS], pending["reg"])
        item = next(i for i in regulation.items if i.id == pending["item"])
        await H._complete_item(update, ctx, pending["reg"], item, photo_id=photo_id)
        await update.message.reply_text(
            f"✅ {item.text} — отмечено.",
            reply_markup=H.checklist_kb(regulation, H._done_set(ctx, pending["reg"])))

    elif pending["kind"] == "task_proof":
        await H.storage(ctx).update_where("Задачи", "id", pending["task"], {"photo_id": photo_id})
        await update.message.reply_text("✅ Задача закрыта с фото.")

    raise ApplicationHandlerStop


# Слова, которые сотрудник напишет вместо команды. Кириллица в /командах Telegram запрещена.
TEXT_COMMANDS = {
    "сводка": digest_cmd, "отчет": digest_cmd, "отчёт": digest_cmd,
    "люди": people_cmd, "команда": people_cmd,
    "чай": brew_cmd, "заварил": brew_cmd,
    "отзыв": feedback_cmd, "впечатления": feedback_cmd,
    "правила": rules_cmd, "меню": work_start,
}


async def on_work_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    person = H.whois(ctx, update.effective_user.id)
    if person is None:
        return  # не сотрудник — вопрос уходит чайному эксперту

    text = update.message.text.strip()
    pending = ctx.user_data.get("pending")
    if not pending:
        handler = TEXT_COMMANDS.get(text.lower().strip("!?. "))
        if handler is not None:
            ctx.args = []
            await handler(update, ctx)
        return  # сотрудник просто спросил что-то про чай — пусть отвечает чайный эксперт

    ctx.user_data.pop("pending", None)

    if pending["kind"] == "chk_text":
        regulation = reg_mod.by_id(ctx.bot_data[H.WORK_REGULATIONS], pending["reg"])
        item = next(i for i in regulation.items if i.id == pending["item"])
        await H._complete_item(update, ctx, pending["reg"], item, comment=text)
        await update.message.reply_text(
            f"✅ {item.text} — записано.",
            reply_markup=H.checklist_kb(regulation, H._done_set(ctx, pending["reg"])))

    elif pending["kind"] == "task_proof":
        await H.storage(ctx).update_where("Задачи", "id", pending["task"], {"comment": text})
        await update.message.reply_text("✅ Задача закрыта.")

    elif pending["kind"] == "brew":
        await H.save_brew(ctx, person, text)
        await update.message.reply_text(
            f"🫖 Записал: <b>{text}</b>. Буду напоминать угощать гостей и спрошу впечатления.",
            parse_mode="HTML", reply_markup=H.treat_kb())

    elif pending["kind"] == "brew_feedback":
        await H.storage(ctx).append("Дегустации", TastingRecord(
            date=today_msk(), tg_id=person.tg_id, name=person.name,
            tea=pending.get("tea", ""), notes=text,
        ).to_row())
        brew = ctx.user_data.get("brew") or {}
        await H.storage(ctx).update_where("Чай дня", "brewed_at", brew.get("key", ""), {"feedback": text})
        await update.message.reply_text("🍵 Спасибо, записал в базу по чаю.")

    elif pending["kind"] == "task_issue":
        await H._set_task_status(ctx, pending["task"], "проблема", comment=text)
        await update.message.reply_text("Передал руководителю.")
        await H.notify_bosses(ctx, f"⚠️ <b>{person.name}</b> сообщает о проблеме:\n{text}")

    raise ApplicationHandlerStop


# ──────────────────────────────── сводка ─────────────────────────────────────

async def build_digest(ctx: ContextTypes.DEFAULT_TYPE) -> str:
    """Что реально произошло за день — по каждому сотруднику."""
    cfg = ctx.bot_data[H.WORK_CFG]
    store = H.storage(ctx)
    today = today_msk()

    shifts = [r for r in await store.rows("Смены") if r.get("date") == today]
    tasks = [r for r in await store.rows("Задачи") if r.get("date") == today]
    checks = [r for r in await store.rows("Чек-листы") if r.get("date") == today]
    tastings = [r for r in await store.rows("Дегустации") if r.get("date") == today]
    quizzes = [r for r in await store.rows("Викторина") if r.get("date") == today]

    lines = [f"📊 <b>Сводка за {today}</b>"]
    for person in cfg.staff:
        pid = str(person.tg_id)
        shift = next((s for s in shifts if str(s.get("tg_id")) == pid), None)
        point = cfg.points.get(person.point)
        lines.append(f"\n<b>{person.name}</b> — {point.title if point else 'точка не задана'}")
        if shift is None:
            lines.append("  ❌ смену не открывал")
        else:
            geo_note = "" if shift.get("geo_ok") == "да" else f" ⚠️ гео: {shift.get('geo_ok')}"
            closed = shift.get("closed_at", "")[11:16] if shift.get("closed_at") else "ещё на смене"
            lines.append(f"  🕘 {shift.get('opened_at', '')[11:16]} → {closed}{geo_note}")

        done = sum(1 for t in tasks if str(t.get("tg_id")) == pid and t.get("status") == "сделана")
        total = sum(1 for t in tasks if str(t.get("tg_id")) == pid)
        overdue = [t for t in tasks if str(t.get("tg_id")) == pid and t.get("status") not in ("сделана",)]
        if total:
            tail = f", не закрыто: {len(overdue)}" if overdue else ""
            lines.append(f"  📋 задачи: {done}/{total}{tail}")
        lines.append(f"  ✅ пунктов регламента: {sum(1 for c in checks if str(c.get('tg_id')) == pid)}")

        tasting = next((t for t in tastings if str(t.get("tg_id")) == pid), None)
        lines.append(f"  🍵 дегустация: {tasting['tea']}" if tasting else "  🍵 дегустация: не записана")

        answers = [q for q in quizzes if str(q.get("tg_id")) == pid]
        if answers:
            right = sum(1 for q in answers if q.get("correct") == "да")
            lines.append(f"  🧠 викторина: {right}/{len(answers)}")

    return "\n".join(lines)


# ──────────────────────────────── регистрация ────────────────────────────────

def register_work_handlers(ptb: Application) -> None:
    """Группа 0 — рабочий контур, он же первым получает обновления."""
    g = 0
    ptb.add_handler(CommandHandler("myid", myid_cmd), group=g)
    ptb.add_handler(CommandHandler("start", work_start), group=g)
    # Telegram принимает только латиницу в командах, поэтому русские слова
    # («сводка», «чай», «отзыв») разбираются в on_work_text как обычный текст.
    ptb.add_handler(CommandHandler("digest", digest_cmd), group=g)
    ptb.add_handler(CommandHandler("people", people_cmd), group=g)
    ptb.add_handler(CommandHandler("task", task_cmd), group=g)
    ptb.add_handler(CommandHandler("rules", rules_cmd), group=g)
    ptb.add_handler(CommandHandler("brew", brew_cmd), group=g)
    ptb.add_handler(CommandHandler("feedback", feedback_cmd), group=g)
    ptb.add_handler(CallbackQueryHandler(on_work_callback, pattern=f"^{H.CB}"), group=g)
    ptb.add_handler(MessageHandler(filters.LOCATION, H.on_location), group=g)
    ptb.add_handler(MessageHandler(filters.PHOTO, on_work_photo), group=g)
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_work_text), group=g)
