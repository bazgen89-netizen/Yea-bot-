"""Бот не пишет в общий чат — ни при каких обстоятельствах.

Решение владельца: в чате бот молчит всегда. Написал кто-то в чат — ответ
уходит автору в личку; не получилось (человек не открыл диалог с ботом) —
узнаёт руководитель, а в чате по-прежнему тишина.

Тест разбирает исходники хендлеров в синтаксическое дерево, потому что
запрещать надо не результат, а приём: `message.answer()` и `message.reply()`
отвечают в тот чат, откуда пришло сообщение. В личной переписке такой вызов
выглядит безобидно — и именно поэтому легко проходит ревью, а вылезает уже
в рабочем чате при всех.
"""
import ast
import pathlib

import pytest

HANDLERS = sorted(pathlib.Path("app/handlers").glob("*.py"))

# Методы объекта сообщения, отвечающие в исходный чат
CHAT_REPLY_METHODS = {"answer", "reply", "answer_photo", "answer_document", "send_copy"}


def _root_name(node: ast.AST) -> str | None:
    """Имя в начале цепочки: message.answer → message, callback.message.answer → callback."""
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def find_chat_replies(source: str) -> list[tuple[int, str]]:
    tree = ast.parse(source)
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in CHAT_REPLY_METHODS:
            continue
        # callback.answer() — это всплывающее уведомление у нажавшего кнопку,
        # оно не появляется в чате и никому, кроме него, не видно.
        target = node.func.value
        if isinstance(target, ast.Name) and target.id == "callback":
            continue
        if _root_name(node.func) in ("message", "callback"):
            found.append((node.lineno, f"{_root_name(node.func)}...{node.func.attr}()"))
    return found


@pytest.mark.parametrize("path", HANDLERS, ids=lambda p: p.name)
def test_handler_never_answers_into_the_chat(path):
    offenders = find_chat_replies(path.read_text(encoding="utf-8"))
    assert not offenders, (
        f"{path.name}: {offenders} отвечает в тот чат, откуда пришло сообщение — "
        "в группе это публичное сообщение. Нужен reply_private() или notify_employee()."
    )


def test_the_detector_catches_a_real_offender():
    """Проверка самого теста: без неё он мог бы тихо ничего не искать."""
    assert find_chat_replies("async def f(message):\n    await message.answer('привет')\n")
    assert find_chat_replies("async def f(callback):\n    await callback.message.answer('x')\n")
    assert not find_chat_replies("async def f(message):\n    await reply_private(message, 'x')\n")
    assert not find_chat_replies("async def f(callback):\n    await callback.answer('ок')\n")


def test_messaging_layer_sends_only_to_private_chats():
    source = pathlib.Path("app/services/messaging.py").read_text(encoding="utf-8")
    assert not find_chat_replies(source)
    # Единственные адресаты — личка человека и руководитель
    assert "bot.send_message(telegram_user_id" in source
    assert "bot.send_message(settings.owner_telegram_id" in source
    assert "async def reply_private(" in source
