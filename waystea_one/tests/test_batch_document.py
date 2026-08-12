from dataclasses import dataclass

from app.services.reports import _looks_like_shortage, build_batch_document


@dataclass
class FakeTask:
    title: str
    proof_comment: str | None = None


def test_shortage_detection():
    assert _looks_like_shortage("воды мало, надо привезти")
    assert _looks_like_shortage("Молока нет")
    assert _looks_like_shortage("сахар заканчивается")
    assert _looks_like_shortage("лампа не работает")
    assert not _looks_like_shortage("всё в наличии")
    assert not _looks_like_shortage("чисто, порядок")
    assert not _looks_like_shortage(None)


def test_document_lists_shortages_separately():
    tasks = [
        FakeTask("Проверить наличие чая", "всё в наличии"),
        FakeTask("Проверить наличие воды", "воды мало, надо привезти"),
        FakeTask("Включить музыку", None),
    ]
    filename, text = build_batch_document("Аня", "Гагарина", 1, tasks)

    assert filename == "otchet_blok_1_Гагарина.txt"
    assert "ТРЕБУЕТ ВНИМАНИЯ" in text
    # the shortage task appears in the dedicated section
    assert text.count("воды мало, надо привезти") == 2  # once in the list, once in the warning
    # a fully-stocked task is not flagged
    assert "Проверить наличие чая: всё в наличии" not in text


def test_document_no_shortage_says_so():
    tasks = [FakeTask("Включить свет", None), FakeTask("Проверить чай", "всё есть")]
    _filename, text = build_batch_document("Боря", "Черёмушки", 2, tasks)
    assert "Нехватки не отмечено." in text
    assert "ТРЕБУЕТ ВНИМАНИЯ" not in text
