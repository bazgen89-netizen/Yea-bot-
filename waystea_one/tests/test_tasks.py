from app.services.tasks import is_completion_phrase


def test_recognizes_completion_phrases():
    assert is_completion_phrase("готово")
    assert is_completion_phrase("Готово!")
    assert is_completion_phrase("Всё")
    assert is_completion_phrase("ок")


def test_ignores_unrelated_text():
    assert not is_completion_phrase("Закончился ГАБА")
    assert not is_completion_phrase("почти")
