"""Команды выдачи VPN-ключей: /vpn, /vpn_new, /vpn_list, /vpn_revoke."""
import html
import logging

from telegram import Update
from telegram.ext import ContextTypes

from . import get_vpn
from ..services import qr

logger = logging.getLogger(__name__)

DISABLED_TEXT = (
    "🔒 VPN-модуль не настроен.\n"
    "Задайте VPN_HOST и REALITY_PUBLIC_KEY — см. vpn/README.md."
)
NO_ACCESS_TEXT = "🔒 Выдача ключей доступна только администраторам."

HAPP_HINT = (
    "\n\n<b>Как добавить в Happ</b>\n"
    "1. Установите Happ (App Store / Google Play / happ.su).\n"
    "2. Отсканируйте QR-код ниже — или скопируйте ссылку подписки и нажмите "
    "«+» → «Добавить из буфера обмена».\n"
    "3. Подписка сама принесёт ключ и профиль маршрутизации: через VPN пойдут "
    "только заблокированные сервисы, местные сайты — напрямую.\n"
    "Ключ обновляется автоматически, повторно ничего добавлять не нужно."
)


def _is_admin(ctx: ContextTypes.DEFAULT_TYPE, tg_id: int) -> bool:
    return tg_id in ctx.bot_data.get("vpn_admins", set())


def _sub_url(ctx: ContextTypes.DEFAULT_TYPE, token: str) -> str:
    base = ctx.bot_data.get("vpn_sub_base", "").rstrip("/")
    return f"{base}/sub/{token}" if base and token else ""


def _format_key(link: str, label: str, sub_url: str) -> str:
    parts = [f"🔑 <b>Ключ «{html.escape(label)}»</b>"]
    if sub_url:
        parts.append(f"\n<b>Ссылка подписки</b> (для Happ):\n"
                     f"<code>{html.escape(sub_url)}</code>")
    parts.append(f"\n<b>Прямая ссылка</b> (v2rayNG, Streisand, NekoBox):\n"
                 f"<code>{html.escape(link)}</code>")
    return "\n".join(parts)


async def _send_qr(update: Update, sub_url: str, label: str) -> None:
    """Прикладывает QR подписки — на телефоне это добавление в один шаг."""
    if not sub_url:
        return
    png = qr.qr_png(sub_url)
    if png is None:
        return
    await update.message.reply_photo(
        png, caption=f"QR подписки «{label}» — отсканируйте в Happ")


async def vpn_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Показывает свои ключи или подсказывает, как получить первый."""
    vpn = get_vpn(ctx)
    if vpn is None or not vpn.server.configured:
        await update.message.reply_text(DISABLED_TEXT)
        return

    tg_id = update.effective_user.id
    keys = await vpn.list_keys(tg_id)
    if not keys:
        await update.message.reply_text(
            "У вас пока нет ключей.\nПолучить: /vpn_new [название]"
            if _is_admin(ctx, tg_id) else NO_ACCESS_TEXT
        )
        return

    for key in keys:
        token = await vpn.ensure_token(key["uuid"])
        sub_url = _sub_url(ctx, token)
        await update.message.reply_text(
            _format_key(vpn.link(key), key.get("label", "vpn"), sub_url) + HAPP_HINT,
            parse_mode="HTML", disable_web_page_preview=True,
        )
        await _send_qr(update, sub_url, key.get("label", "vpn"))

    await update.message.reply_text(
        "Отозвать ключ: <code>/vpn_revoke &lt;uuid&gt;</code>\n"
        + "\n".join(f"• {html.escape(k.get('label', '—'))}: <code>{k['uuid']}</code>"
                    for k in keys),
        parse_mode="HTML",
    )


async def vpn_new_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    vpn = get_vpn(ctx)
    if vpn is None or not vpn.server.configured:
        await update.message.reply_text(DISABLED_TEXT)
        return

    tg_id = update.effective_user.id
    if not _is_admin(ctx, tg_id):
        await update.message.reply_text(NO_ACCESS_TEXT)
        return

    label = " ".join(ctx.args)[:32] if ctx.args else f"tg{tg_id}"
    user, status = await vpn.issue(tg_id, label)
    if user is None:
        await update.message.reply_text(status)
        return

    sub_url = _sub_url(ctx, user.get("sub_token", ""))
    await update.message.reply_text(
        _format_key(vpn.link(user), label, sub_url) + HAPP_HINT + f"\n\n{status}",
        parse_mode="HTML", disable_web_page_preview=True,
    )
    await _send_qr(update, sub_url, label)


async def vpn_list_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    vpn = get_vpn(ctx)
    if vpn is None or not vpn.server.configured:
        await update.message.reply_text(DISABLED_TEXT)
        return
    if not _is_admin(ctx, update.effective_user.id):
        await update.message.reply_text(NO_ACCESS_TEXT)
        return

    keys = await vpn.list_keys()
    if not keys:
        await update.message.reply_text("Активных ключей нет.")
        return

    lines = [f"🔑 <b>Активных ключей: {len(keys)}</b>\n"]
    for k in keys:
        lines.append(
            f"• {html.escape(k.get('label', '—'))} — "
            f"<code>{k['uuid']}</code> "
            f"(tg {k.get('tg_id') or '—'}, {k.get('created_at') or '—'})"
        )
    await update.message.reply_text("\n".join(lines), parse_mode="HTML")


async def vpn_revoke_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    vpn = get_vpn(ctx)
    if vpn is None or not vpn.server.configured:
        await update.message.reply_text(DISABLED_TEXT)
        return

    tg_id = update.effective_user.id
    if not ctx.args:
        await update.message.reply_text("Укажите uuid ключа: /vpn_revoke <uuid>")
        return

    # Администратор отзывает любой ключ, обычный пользователь — только свой.
    owner = None if _is_admin(ctx, tg_id) else tg_id
    ok, status = await vpn.revoke(ctx.args[0].strip(), owner)
    await update.message.reply_text(
        f"🗑 Ключ отозван. Подписка перестанет отдавать его.\n{status}" if ok else status)
