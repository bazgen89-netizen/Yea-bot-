"""Matching however an employee names the tea to a technological card
(app/services/quiz.py). The brewed tea is typed by hand in a hurry, so the
match has to survive case, «ё», word order and extra words in the card title.
"""
from app.services.quiz import match_card


class FakeQuestion:
    def __init__(self, card: str):
        self.card = card


CARDS = [
    FakeQuestion("Шэн пуэр молодой"),
    FakeQuestion("Те Гуань Инь"),
    FakeQuestion("Да Хун Пао"),
    FakeQuestion("Шу Пуэр Хайваньский 9978"),
]


def test_exact_title():
    assert match_card(CARDS, "Да Хун Пао") == "Да Хун Пао"


def test_case_and_yo_are_ignored():
    assert match_card(CARDS, "шен пуэр молодой") == "Шэн пуэр молодой"


def test_partial_name_matches_longer_card_title():
    assert match_card(CARDS, "9978") == "Шу Пуэр Хайваньский 9978"


def test_word_overlap_when_no_substring():
    assert match_card(CARDS, "заварил да хун пао 2023") == "Да Хун Пао"


def test_unknown_tea_has_no_card():
    assert match_card(CARDS, "габа") is None
    assert match_card(CARDS, "") is None
    assert match_card([], "Да Хун Пао") is None
