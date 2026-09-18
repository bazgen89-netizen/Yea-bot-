from app.services.vision import _parse_result


def test_parses_passing_result():
    result = _parse_result("РЕЗУЛЬТАТ: да\nКОММЕНТАРИЙ: Всё чисто, отлично.")
    assert result.passed is True
    assert "отлично" in result.comment.lower()


def test_parses_failing_result():
    result = _parse_result("РЕЗУЛЬТАТ: нет\nКОММЕНТАРИЙ: На столе остались чашки.")
    assert result.passed is False
    assert "чашки" in result.comment.lower()


def test_defaults_to_failed_on_unexpected_format():
    result = _parse_result("что-то непонятное без нужных слов")
    assert result.passed is False
