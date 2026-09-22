"""Контроль рабочих сетей Wi-Fi в том же чате, где соцсети.

Агент на точке раз в несколько минут присылает список подключённых
устройств, бот сверяет его с реестром и сообщает о новом. Сам бот в сеть
магазина не ходит: он в облаке, а сеть — за роутером.
"""
import html
import logging
import time

from telegram import Update
from telegram.ext import ContextTypes

from .. import branches
from ..security import DeviceRegistry, SeenReport, normalize_mac
from .social import ADMIN_KEY, is_allowed

logger = logging.getLogger(__name__)

REGISTRY_KEY = "wifi_registry"
AGENT_TOKEN_KEY = "wifi_agent_token"


def get_registry(ctx: ContextTypes.DEFAULT_TYPE):
    return ctx.bot_data.get(REGISTRY_KEY)


def branch_title(code: str) -> str:
    branch = branches.find(code)
    return branch.title if branch else (code or "сеть")


def _device_line(device) -> str:
    parts = [f"<code>{device.mac}</code>"]
    if device.title != device.mac:
        parts.append(html.escape(device.title))
    if device.ip:
        parts.append(device.ip)
    return "• " + " · ".join(parts)


def alert_text(report: SeenReport) -> str:
    """Сообщение о новом в сети точки. Пустая строка — сообщать не о чем."""
    if not report.has_news:
        return ""

    title = branch_title(report.branch)
    head = "🌙 <b>Ночью</b> " if report.at_night else ""
    lines = [f"{head}📶 <b>Wi-Fi {html.escape(title)}</b>"]

    if report.new:
        lines.append(f"\n🆕 Новых устройств: {len(report.new)}")
        lines += [_device_line(d) for d in report.new]
    if report.returned:
        lines.append(f"\n↩️ Давно не появлялись: {len(report.returned)}")
        lines += [_device_line(d) for d in report.returned]

    lines.append(f"\nВсего в сети сейчас: {len(report.new) + len(report.returned) + len(report.known)}")
    lines.append("Своё устройство: <code>/wifi trust "
                 f"{report.new[0].mac if report.new else 'MAC'} Касса</code>")
    return "\n".join(lines)


async def notify(bot, chat_id: int, report: SeenReport) -> bool:
    """Шлёт предупреждение в админский чат. False — если сообщать нечего."""
    text = alert_text(report)
    if not text:
        return False
    await bot.send_message(chat_id, text, parse_mode="HTML")
    return True


# --------------------------------------------------------------- команды

def _summary(registry: DeviceRegistry) -> str:
    lines = ["📶 <b>Рабочие сети</b>"]
    codes = [b.code for b in branches.BRANCHES.values()]
    codes += [c for c in {d.branch for d in registry.devices.values()} if c not in codes]

    for code in codes:
        devices = registry.of_branch(code)
        if not devices:
            continue
        unknown = [d for d in devices if not d.trusted]
        checked = registry.last_check.get(code)
        when = (f"проверка {time.strftime('%d.%m %H:%M', time.localtime(checked))}"
                if checked else "агент ещё не выходил на связь")
        lines.append(f"\n<b>{html.escape(branch_title(code))}</b> — {when}")
        lines.append(f"Устройств: {len(devices)}, из них не помечены своими: {len(unknown)}")
        for device in unknown[:10]:
            lines.append(_device_line(device))

    if len(lines) == 1:
        lines.append("\nДанных пока нет: запустите агента на точке "
                     "(scripts/wifi_agent.py).")
    return "\n".join(lines)


async def wifi_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/wifi — сводка, /wifi trust MAC имя, /wifi forget MAC."""
    registry = get_registry(ctx)
    if registry is None:
        return
    if not is_allowed(update, ctx):
        await update.message.reply_text("🔒 Доступно только в админском чате.")
        return

    args = ctx.args or []
    if not args:
        await update.message.reply_text(_summary(registry), parse_mode="HTML")
        return

    action = args[0].lower()
    mac = normalize_mac(args[1]) if len(args) > 1 else ""
    if action not in ("trust", "forget") or not mac:
        await update.message.reply_text(
            "Как пользоваться:\n"
            "<code>/wifi</code> — что в сетях\n"
            "<code>/wifi trust AA:BB:CC:DD:EE:FF Касса</code> — пометить своим\n"
            "<code>/wifi forget AA:BB:CC:DD:EE:FF</code> — забыть устройство",
            parse_mode="HTML",
        )
        return

    # Точку не спрашиваем: один MAC живёт в одной сети
    found = [d for d in registry.devices.values() if d.mac == mac]
    if not found:
        await update.message.reply_text("Такого устройства в реестре нет.")
        return

    name = " ".join(args[2:]).strip()
    for device in found:
        if action == "trust":
            registry.trust(device.branch, mac, name)
        else:
            registry.forget(device.branch, mac)

    title = name or found[0].title
    await update.message.reply_text(
        f"✅ {html.escape(title)} помечено своим — больше не предупреждаю."
        if action == "trust" else f"🗑 Устройство {mac} забыто.",
        parse_mode="HTML",
    )


def admin_chat_id(ctx) -> int:
    return ctx.bot_data.get(ADMIN_KEY)
