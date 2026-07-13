from app.services.purchasing import extract_product, is_purchase_request_message


def test_recognizes_out_of_stock_message():
    assert is_purchase_request_message("Закончился ГАБА")
    assert is_purchase_request_message("Нет стаканов")
    assert is_purchase_request_message("Нужны пакеты")


def test_ignores_unrelated_message():
    assert not is_purchase_request_message("Гагарина на месте")


def test_extracts_product_name():
    assert extract_product("Закончился ГАБА").strip() == "ГАБА"
    assert extract_product("Нет стаканов").strip() == "стаканов"
