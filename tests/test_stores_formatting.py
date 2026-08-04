from teabot.stores.formatting import format_card, format_review, format_reviews, format_stores
from teabot.stores.models import GOOGLE, TWOGIS, Review, Store, StoreCard


def test_card_with_rating_and_links():
    card = StoreCard(platform=TWOGIS, store_slug="msk", name="Waystea",
                     address="ул. Примерная, 1", phone="+7 900 000-00-00",
                     hours="Пн 10:00–20:00", rating=4.9, reviews_count=120,
                     url="https://2gis.ru/firm/222")

    out = format_card(card)

    assert "2ГИС" in out
    assert "4.9" in out and "★★★★★" in out and "120 отз." in out
    assert 'href="https://2gis.ru/firm/222"' in out


def test_card_with_error_shows_warning():
    out = format_card(StoreCard(platform=GOOGLE, store_slug="msk", error="HTTP 403"))

    assert "⚠️" in out and "HTTP 403" in out


def test_html_is_escaped():
    card = StoreCard(platform=TWOGIS, store_slug="msk", name="Чай <b>&</b>",
                     address="<script>alert(1)</script>")

    out = format_card(card)

    assert "<script>" not in out
    assert "&lt;script&gt;" in out


def test_empty_stores_message_points_to_docs():
    assert "stores.json" in format_stores([])


def test_store_block_lists_all_platforms():
    store = Store(slug="msk", name="Waystea", city="Москва")
    cards = [
        StoreCard(platform=TWOGIS, store_slug="msk", rating=4.9),
        StoreCard(platform=GOOGLE, store_slug="msk", error="нет ключа"),
    ]

    out = format_stores([(store, cards)])

    assert "Waystea — Москва" in out
    assert "2ГИС" in out and "Google Maps" in out


def test_review_marks_answered_state():
    unanswered = Review(platform=GOOGLE, store_slug="msk", review_id="1",
                        author="Иван", rating=5, text="Отличный чай")
    answered = Review(platform=GOOGLE, store_slug="msk", review_id="2",
                      text="Ок", reply_text="Спасибо!")

    assert "Без ответа" in format_review(unanswered)
    assert "Ответ уже дан" in format_review(answered)


def test_long_review_text_truncated():
    long_review = Review(platform=TWOGIS, store_slug="msk", review_id="1",
                         text="а" * 1000)

    assert "…" in format_review(long_review)


def test_reviews_list_limits_and_counts_rest():
    reviews = [
        Review(platform=TWOGIS, store_slug="msk", review_id=str(i), text=f"отзыв {i}")
        for i in range(8)
    ]

    out = format_reviews(reviews, {"msk": "Waystea — Москва"}, limit=3)

    assert "и ещё 5" in out


def test_empty_reviews_message():
    assert "Свежих отзывов не найдено" in format_reviews([], {})
