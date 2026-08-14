from app.models import UpsellType
from app.services.upsell import detect_upsell_type


def test_detects_tasting_to_purchase():
    text = "предложил дегустацию Да Хун Пао, купили 100г"
    assert detect_upsell_type(text) == UpsellType.TASTING_TO_PURCHASE


def test_detects_pairing():
    assert detect_upsell_type("продал вкусности к чаю") == UpsellType.PAIRING


def test_returns_none_for_unrelated_text():
    assert detect_upsell_type("Гагарина на месте") is None
