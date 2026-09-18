from app.services.question_detector import looks_like_question


def test_recognizes_question_mark():
    assert looks_like_question("Где инструкция?")


def test_recognizes_question_word_without_mark():
    assert looks_like_question("как заваривать этот чай")


def test_ignores_statements():
    assert not looks_like_question("Гагарина на месте")
    assert not looks_like_question("готово")
