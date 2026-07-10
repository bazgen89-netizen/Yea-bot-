import pytest

from teabot.constants import is_buy_question


@pytest.mark.parametrize("text", [
    "Где купить шен пуэр?",
    "Сколько стоит Да Хун Пао",
    "ЦЕНА на лунцзин",
    "есть ли доставка в Москву",
    "tea shop рядом",
])
def test_buy_questions_detected(text):
    assert is_buy_question(text)


@pytest.mark.parametrize("text", [
    "Как заваривать габу?",
    "Расскажи про Юньнань",
    "Чем шен отличается от шу",
])
def test_regular_questions_not_detected(text):
    assert not is_buy_question(text)
