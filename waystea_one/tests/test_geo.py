"""Shift-start geofence (app/services/geo.py)."""
from app.services.geo import check, distance_m

# Реальные точки WAYSTEA во Владимире (scripts/seed_stores.py)
GAGARINA = (56.129401, 40.403756)
CHERYOMUSHKI = (56.138837, 40.365208)
STUDENAYA = (56.126273, 40.388906)


def test_inside_own_radius():
    verdict = check(*GAGARINA, *GAGARINA, 300)
    assert verdict == (True, 0)


def test_outside_radius_reports_distance():
    # ~1.1 км севернее точки
    inside, distance = check(GAGARINA[0] + 0.01, GAGARINA[1], *GAGARINA, 300)
    assert not inside
    assert 1050 < distance < 1150


def test_stores_cannot_be_confused_with_each_other():
    """Даже с грубыми координатами точки разнесены далеко за любой радиус."""
    for a, b in ((GAGARINA, CHERYOMUSHKI), (GAGARINA, STUDENAYA), (CHERYOMUSHKI, STUDENAYA)):
        assert distance_m(*a, *b) > 900


def test_uncalibrated_store_is_not_a_no_show():
    """Точка без координат — проверки нет, а не «все прогуляли»."""
    assert check(*GAGARINA, None, None, 300) is None
    assert check(*GAGARINA, GAGARINA[0], None, 300) is None


def test_radius_defaults_when_missing():
    inside, _ = check(GAGARINA[0] + 0.002, GAGARINA[1], *GAGARINA, None)
    assert inside  # ~220 м, внутри дефолтных 300
