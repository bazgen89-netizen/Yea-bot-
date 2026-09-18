"""Geofence check for shift start.

The location is requested once, when the employee marks themselves on site —
there is no continuous tracking (it would be both unlawful without separate
consent and useless: an employee who wants to game presence will do it with
one tap either way). The honest limitation is that Telegram location can be
spoofed on desktop or a modified client, which is why the shift start pairs
the geofence with the existing photo proof.
"""
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000
DEFAULT_RADIUS_M = 300


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


def check(lat: float, lon: float, store_lat: float | None, store_lon: float | None,
          radius_m: int | None) -> tuple[bool, int] | None:
    """(inside, distance) — or None when the store has no coordinates yet.

    Returning None rather than a default keeps an unconfigured store from
    silently reporting everyone as a no-show.
    """
    if store_lat is None or store_lon is None:
        return None
    distance = distance_m(lat, lon, store_lat, store_lon)
    return distance <= (radius_m or DEFAULT_RADIUS_M), round(distance)
