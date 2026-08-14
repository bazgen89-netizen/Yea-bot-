from app.services.purchasing import extract_product, is_purchase_request_message


def test_recognizes_trigger_phrase():
    assert is_purchase_request_message("Нужно привезти сахар")
    assert is_purchase_request_message("Сахар нужно привезти")


def test_ignores_unrelated_message():
    assert not is_purchase_request_message("Гагарина на месте")
    # Tea restock requests go through the dedicated topic
    # (app/handlers/tea_requests.py), not keyword detection here.
    assert not is_purchase_request_message("Закончился ГАБА")
    assert not is_purchase_request_message("Молоко осталось, надо привезти")


def test_extracts_product_name():
    assert extract_product("Нужно привезти сахар").strip() == "сахар"
    assert extract_product("Сахар нужно привезти").strip() == "Сахар"


def test_ignores_word_only_containing_a_trigger_word():
    # "привезти" alone (without "нужно") shouldn't match — avoids the same
    # class of false positive as the old broad keyword list.
    assert not is_purchase_request_message("Не могу сегодня привезти документы")
