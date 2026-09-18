"""Проверка геометки при открытии смены."""
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Расстояние по большому кругу, метры (формула гаверсинуса)."""
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


def check(lat: float, lon: float, point_lat: float, point_lon: float, radius_m: int) -> tuple[bool, int]:
    """Возвращает (внутри радиуса, расстояние в метрах)."""
    d = distance_m(lat, lon, point_lat, point_lon)
    return d <= radius_m, round(d)
