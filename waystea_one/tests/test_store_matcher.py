from app.services.store_matcher import StoreOption, match_store

STORES = [
    StoreOption(id=1, name="Черёмушки", aliases=["черемушки", "черёмушки"]),
    StoreOption(id=2, name="Гагарина", aliases=["гагарина", "гагарин"]),
    StoreOption(
        id=3,
        name="Рынок на Студёной",
        aliases=["рынок на студеной", "студен", "рынок"],
    ),
]


def test_matches_exact_name():
    assert match_store("Гагарина на месте", STORES).name == "Гагарина"


def test_matches_alias_without_yo():
    assert match_store("Доброе утро, черемушки на месте", STORES).name == "Черёмушки"


def test_matches_alias_substring():
    assert match_store("я на студеной сегодня", STORES).name == "Рынок на Студёной"


def test_returns_none_when_no_store_mentioned():
    assert match_store("Я на месте", STORES) is None


def test_returns_none_when_ambiguous():
    ambiguous_text = "Черёмушки и Гагарина сегодня закрыты на переучёт"
    assert match_store(ambiguous_text, STORES) is None
