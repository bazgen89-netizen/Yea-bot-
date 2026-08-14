from app.services.revenue import parse_revenue_message

VALID_MESSAGE = "Общая выручка: 50000\nНаличка: 20000\nБезнал: 30000"


def test_parses_valid_report():
    report = parse_revenue_message(VALID_MESSAGE)
    assert report is not None
    assert report.total == 50000
    assert report.cash == 20000
    assert report.non_cash == 30000


def test_rejects_mismatched_totals():
    bad_message = "Общая выручка: 50000\nНаличка: 20000\nБезнал: 10000"
    assert parse_revenue_message(bad_message) is None


def test_rejects_missing_line():
    incomplete_message = "Общая выручка: 50000\nНаличка: 20000"
    assert parse_revenue_message(incomplete_message) is None


def test_ignores_unrelated_text():
    assert parse_revenue_message("Закончился чай") is None
