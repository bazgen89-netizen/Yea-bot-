"""Команды выдачи VPN-ключей: /vpn, /vpn_new, /vpn_list, /vpn_revoke."""
import html
import logging

from telegram import Update
from telegram.ext import ContextTypes

from . import get_vpn

logger = logging.getLogger(__name__)

DISABLED_TEXT = (
    "🔒 VPN-модуль не настроен.\n"
    "Задайте VPN_HOST и REALITY_PUBLIC_KEY — см. vpn/README.md."
)
NO_ACCESS_TEXT = "🔒 Выдача ключей доступна только администраторам."

SETUP_HINT = (
    "\n\n<b>Как подключить</b>\n"
    "1. Установите клиент: v2rayNG (Android), Streisand или FoXray (iOS), "
    "Hiddify или NekoBox (Windows/macOS/Linux).\n"
    "2. Скопируйте ссылку выше и импортируйте её из буфера обмена.\n"
    "3. Для режима «только заблокированные сайты через VPN» возьмите "
    "whitelist-конфиг:\n"
    "<code>python3 vpn/tools/gen_client_config.py --profile {profile} "
    "--link \"&lt;ваша ссылка&gt;\" -o out/</code>"
)


def _is_admin(ctx: ContextTypes.DEFAULT_TYPE, tg_id: int) -> bool:
    return tg_id in ctx.bot_data.get("vpn_admins", set())


def _format_key(link: str, label: str, profile: str) -> str:
    return (
        f"🔑 <b>Ключ «{html.escape(label)}»</b>\n\n"
        f"<code>{html.escape(link)}</code>"
        + SETUP_HINT.format(profile=profile)
    )


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
            "У вас пока нет ключей.\n"
            "Получить: /vpn_new [название]" if _is_admin(ctx, tg_id) else NO_ACCESS_TEXT
        )
        return

    profile = ctx.bot_data.get("vpn_profile", "ru")
    parts = [_format_key(vpn.link(k), k.get("label", "vpn"), profile) for k in keys]
    parts.append(f"\nОтозвать: /vpn_revoke &lt;uuid&gt;\nВаши uuid: " +
                 ", ".join(f"<code>{k['uuid']}</code>" for k in keys))
    await update.message.reply_text("\n\n".join(parts), parse_mode="HTML",
                                    disable_web_page_preview=True)


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

    profile = ctx.bot_data.get("vpn_profile", "ru")
    await update.message.reply_text(
        _format_key(vpn.link(user), label, profile) + f"\n\n{status}",
        parse_mode="HTML", disable_web_page_preview=True,
    )


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
    await update.message.reply_text(f"{'🗑 Ключ отозван' if ok else status}"
                                    + (f"\n{status}" if ok else ""))
