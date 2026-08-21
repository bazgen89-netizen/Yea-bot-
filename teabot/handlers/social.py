"""Управление всеми соцсетями из одного Telegram-чата.

Команды: /social — панель, /inbox — забрать входящие,
/post — пост во все сети сразу, /autopilot — автономные ответы.
Кнопки под карточками используют префикс callback_data «soc:».
"""
import html
import logging
from typing import Optional

from telegram import Update
from telegram.ext import ContextTypes

from ..config import SOCIAL_FETCH_LIMIT, SOCIAL_MAX_CARDS
from ..keyboards import (
    social_draft_kb, social_item_kb, social_panel_kb, social_post_kb,
)
from ..social import CAP_INBOX, CAP_PUBLISH, CAP_REPLY, SocialHub, SocialItem

logger = logging.getLogger(__name__)

HUB_KEY = "social_hub"
ADMIN_KEY = "social_admin_chat_id"

# Ключи режимов ввода в user_data
MODE = "social_mode"
REPLY_TOKEN = "social_reply_token"
DRAFT = "social_draft"
PENDING_POST = "social_pending_post"


def get_hub(ctx: ContextTypes.DEFAULT_TYPE) -> Optional[SocialHub]:
    return ctx.bot_data.get(HUB_KEY)


def _admin_chat_id(ctx: ContextTypes.DEFAULT_TYPE) -> Optional[int]:
    return ctx.bot_data.get(ADMIN_KEY)


def is_allowed(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> bool:
    """Управлять сетями можно только из админского чата.

    Если чат не настроен, разрешаем — иначе владелец не сможет узнать
    свой chat_id, чтобы его настроить.
    """
    admin = _admin_chat_id(ctx)
    if admin is None:
        return True
    chat = update.effective_chat
    return chat is not None and chat.id == admin


async def _deny(update: Update) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(
            "🔒 Управление соцсетями доступно только в админском чате."
        )


# --------------------------------------------------------------- панель

def _panel_text(hub: SocialHub, ctx: ContextTypes.DEFAULT_TYPE) -> str:
    enabled = hub.enabled
    lines = ["🌐 <b>Единый центр соцсетей</b>", ""]
    if enabled:
        lines.append("Подключено: " + ", ".join(c.title for c in enabled))
    else:
        lines.append("⚠️ Пока не подключена ни одна сеть — см. docs/SOCIAL.md")
    lines.append(f"🤖 Автопилот: {'включён' if hub.autopilot else 'выключен'}")
    if _admin_chat_id(ctx) is None:
        chat = ctx.bot_data.get("last_chat_id")
        lines.append(
            f"\n⚠️ SOCIAL_ADMIN_CHAT_ID не задан — автономный опрос выключен."
            + (f"\nID этого чата: <code>{chat}</code>" if chat else "")
        )
    if hub.last_errors:
        lines.append("\n⚠️ Ошибки:")
        lines += [f"• {n}: {html.escape(e)}" for n, e in hub.last_errors.items()]
    return "\n".join(lines)


async def social_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    hub = get_hub(ctx)
    ctx.bot_data["last_chat_id"] = update.effective_chat.id if update.effective_chat else None
    if hub is None:
        await update.message.reply_text("⚠️ Хаб соцсетей не инициализирован.")
        return
    if not is_allowed(update, ctx):
        return await _deny(update)
    await update.message.reply_text(
        _panel_text(hub, ctx), parse_mode="HTML",
        reply_markup=social_panel_kb(hub.autopilot),
    )


async def status_text(hub: SocialHub) -> str:
    lines = ["📊 <b>Статус площадок</b>", ""]
    for connector, status in await hub.statuses():
        caps = []
        if connector.can(CAP_INBOX):
            caps.append("чтение")
        if connector.can(CAP_REPLY):
            caps.append("ответы")
        if connector.can(CAP_PUBLISH):
            caps.append("посты")
        lines.append(f"• <b>{html.escape(connector.title)}</b> — {html.escape(status)}")
        lines.append(f"  <i>{', '.join(caps) or 'нет операций'}</i>")
    return "\n".join(lines)


# ------------------------------------------------------------- входящие

async def deliver_items(bot, chat_id: int, hub: SocialHub,
                        items: list[SocialItem]) -> None:
    """Показывает входящие в админском чате; в автопилоте — сразу отвечает."""
    for item in items[:SOCIAL_MAX_CARDS]:
        connector = hub.by_network(item.network)
        title = connector.title if connector else item.network
        token = hub.remember(item)
        can_reply = bool(connector and connector.can(CAP_REPLY))

        if hub.autopilot and can_reply and hub.ai and not hub.needs_human(item):
            draft = await hub.draft_reply(item)
            if draft and not draft.startswith("⚠️"):
                result = await hub.reply(item, draft)
                await bot.send_message(
                    chat_id,
                    f"{item.format(title)}\n\n🤖 <b>Автопилот ответил:</b>\n"
                    f"{html.escape(draft)}\n\n{result.format(title)}",
                    parse_mode="HTML",
                )
                continue

        prefix = ""
        if hub.autopilot and hub.needs_human(item):
            prefix = "🔔 <b>Нужен ваш ответ</b> (автопилот не отвечает на негатив)\n\n"
        await bot.send_message(
            chat_id, prefix + item.format(title), parse_mode="HTML",
            reply_markup=social_item_kb(token, can_reply),
        )

    if len(items) > SOCIAL_MAX_CARDS:
        await bot.send_message(
            chat_id,
            f"… и ещё {len(items) - SOCIAL_MAX_CARDS} входящих. "
            f"Откройте /inbox, чтобы посмотреть остальные.",
        )


async def inbox_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    hub = get_hub(ctx)
    if hub is None:
        return
    if not is_allowed(update, ctx):
        return await _deny(update)

    msg = await update.message.reply_text("⏳ Опрашиваю все сети...")
    items = await hub.fetch_new(SOCIAL_FETCH_LIMIT)
    if not items:
        await msg.edit_text("📭 Новых сообщений и отзывов нет.")
        return
    await msg.edit_text(f"📥 Новых входящих: {len(items)}")
    await deliver_items(ctx.bot, update.effective_chat.id, hub, items)


# ------------------------------------------------------------ публикация

async def post_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    hub = get_hub(ctx)
    if hub is None:
        return
    if not is_allowed(update, ctx):
        return await _deny(update)

    text = " ".join(ctx.args).strip() if ctx.args else ""
    if not text:
        ctx.user_data[MODE] = "post"
        await update.message.reply_text(
            "✍️ Пришлите текст поста — опубликую сразу во все сети, "
            "которые это поддерживают."
        )
        return
    await _confirm_post(update.message, ctx, hub, text)


async def _confirm_post(message, ctx: ContextTypes.DEFAULT_TYPE,
                        hub: SocialHub, text: str) -> None:
    targets = hub.with_capability(CAP_PUBLISH)
    if not targets:
        await message.reply_text("⚠️ Нет сетей, куда можно публиковать.")
        return
    ctx.user_data[PENDING_POST] = text
    await message.reply_text(
        f"📝 <b>Опубликовать в {len(targets)} сетях?</b>\n"
        f"{', '.join(c.title for c in targets)}\n\n{html.escape(text[:1000])}",
        parse_mode="HTML", reply_markup=social_post_kb(),
    )


async def autopilot_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    hub = get_hub(ctx)
    if hub is None:
        return
    if not is_allowed(update, ctx):
        return await _deny(update)

    arg = (ctx.args[0].lower() if ctx.args else "")
    if arg in {"on", "вкл", "1"}:
        hub.autopilot = True
    elif arg in {"off", "выкл", "0"}:
        hub.autopilot = False
    else:
        hub.autopilot = not hub.autopilot
    await update.message.reply_text(
        f"🤖 Автопилот {'включён — отвечаю сам и показываю ответы здесь.' if hub.autopilot else 'выключен — отвечаю только по кнопке.'}",
        reply_markup=social_panel_kb(hub.autopilot),
    )


# --------------------------------------------------------------- ввод

async def handle_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> bool:
    """Перехватывает текст, если он адресован соцсетям. True — сообщение обработано."""
    hub = get_hub(ctx)
    if hub is None or not is_allowed(update, ctx):
        return False
    text = update.message.text.strip()

    token = ctx.user_data.pop(REPLY_TOKEN, None)
    if token:
        item = hub.resolve(token)
        if item is None:
            await update.message.reply_text("⚠️ Сообщение устарело, откройте /inbox заново.")
            return True
        result = await hub.reply(item, text)
        connector = hub.by_network(item.network)
        await update.message.reply_text(
            result.format(connector.title if connector else item.network)
        )
        return True

    if ctx.user_data.pop(MODE, None) == "post":
        await _confirm_post(update.message, ctx, hub, text)
        return True

    return False


# ------------------------------------------------------------ callbacks

async def on_social_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    hub = get_hub(ctx)
    if hub is None:
        return
    if not is_allowed(update, ctx):
        await q.message.reply_text("🔒 Только для админского чата.")
        return

    action, _, token = q.data[len("soc:"):].partition(":")

    if action == "inbox":
        note = await q.message.reply_text("⏳ Опрашиваю все сети...")
        items = await hub.fetch_new(SOCIAL_FETCH_LIMIT)
        await note.edit_text(
            f"📥 Новых входящих: {len(items)}" if items else "📭 Новых входящих нет."
        )
        if items:
            await deliver_items(ctx.bot, q.message.chat_id, hub, items)

    elif action == "status":
        await q.message.reply_text(await status_text(hub), parse_mode="HTML")

    elif action == "autopilot":
        hub.autopilot = not hub.autopilot
        await q.message.reply_text(
            f"🤖 Автопилот {'включён' if hub.autopilot else 'выключен'}.",
            reply_markup=social_panel_kb(hub.autopilot),
        )

    elif action == "post":
        ctx.user_data[MODE] = "post"
        await q.message.reply_text("✍️ Пришлите текст поста для всех сетей.")

    elif action == "post_cancel":
        ctx.user_data.pop(PENDING_POST, None)
        await q.message.reply_text("❌ Публикация отменена.")

    elif action == "post_go":
        text = ctx.user_data.pop(PENDING_POST, "")
        if not text:
            await q.message.reply_text("⚠️ Текст поста потерялся, пришлите заново.")
            return
        note = await q.message.reply_text("🚀 Публикую...")
        results = await hub.publish(text)
        titles = {c.network: c.title for c in hub.connectors}
        await note.edit_text(
            "📣 <b>Результат публикации:</b>\n"
            + "\n".join(r.format(titles.get(r.network, r.network)) for r in results),
            parse_mode="HTML",
        )

    elif action == "ai":
        item = hub.resolve(token)
        if item is None:
            await q.message.reply_text("⚠️ Сообщение устарело, откройте /inbox заново.")
            return
        note = await q.message.reply_text("🤖 Готовлю ответ...")
        draft = await hub.draft_reply(item)
        if not draft:
            await note.edit_text("⚠️ AI недоступен — напишите ответ вручную.")
            return
        ctx.user_data[DRAFT] = draft
        await note.edit_text(
            f"🤖 <b>Черновик ответа:</b>\n\n{html.escape(draft)}",
            parse_mode="HTML", reply_markup=social_draft_kb(token),
        )

    elif action == "send":
        item = hub.resolve(token)
        draft = ctx.user_data.pop(DRAFT, "")
        if item is None or not draft:
            await q.message.reply_text("⚠️ Черновик потерялся, подготовьте ответ заново.")
            return
        result = await hub.reply(item, draft)
        connector = hub.by_network(item.network)
        await q.message.reply_text(
            result.format(connector.title if connector else item.network)
        )

    elif action == "re":
        if hub.resolve(token) is None:
            await q.message.reply_text("⚠️ Сообщение устарело, откройте /inbox заново.")
            return
        ctx.user_data[REPLY_TOKEN] = token
        await q.message.reply_text("✍️ Напишите текст ответа — отправлю в эту сеть.")

    elif action == "done":
        try:
            await q.edit_message_reply_markup(reply_markup=None)
        except Exception as e:  # noqa: BLE001 — сообщение могло устареть
            logger.debug("Не удалось снять кнопки: %s", e)


# ---------------------------------------------------------- автономный опрос

async def poll_job(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Фоновая задача: сама опрашивает все сети и приносит новое в админский чат."""
    hub = get_hub(ctx)
    chat_id = _admin_chat_id(ctx)
    if hub is None or chat_id is None:
        return
    try:
        items = await hub.fetch_new(SOCIAL_FETCH_LIMIT)
    except Exception as e:  # noqa: BLE001 — задача не должна умирать насовсем
        logger.error("Опрос соцсетей упал: %s", e)
        return
    if items:
        logger.info("📥 Новых входящих из соцсетей: %d", len(items))
        await deliver_items(ctx.bot, chat_id, hub, items)
