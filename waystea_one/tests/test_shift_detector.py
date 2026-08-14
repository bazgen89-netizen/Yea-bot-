from app.services.shift_detector import is_shift_start_message


def test_recognizes_common_phrases():
    assert is_shift_start_message("Черёмушки на месте")
    assert is_shift_start_message("Я пришёл")
    assert is_shift_start_message("Я на смене сегодня")


def test_ignores_unrelated_messages():
    assert not is_shift_start_message("Закончился ГАБА")
    assert not is_shift_start_message("Как заваривать Да Хун Пао?")
