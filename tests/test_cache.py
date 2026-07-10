from teabot.cache import TTLCache


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def test_get_missing_key_returns_none():
    cache = TTLCache()
    assert cache.get("nope") is None


def test_set_and_get():
    cache = TTLCache()
    cache.set("k", "value")
    assert cache.get("k") == "value"


def test_entry_expires_after_ttl():
    clock = FakeClock()
    cache = TTLCache(ttl=300, clock=clock)
    cache.set("k", "value")

    clock.advance(299)
    assert cache.get("k") == "value"

    clock.advance(2)
    assert cache.get("k") is None


def test_eviction_removes_expired_first():
    clock = FakeClock()
    cache = TTLCache(ttl=300, max_size=5, evict_batch=2, clock=clock)
    for i in range(5):
        cache.set(f"old{i}", i)

    clock.advance(301)  # все old* просрочены
    cache.set("fresh", "v")
    assert len(cache) == 1
    assert cache.get("fresh") == "v"


def test_eviction_removes_oldest_when_nothing_expired():
    clock = FakeClock()
    cache = TTLCache(ttl=1000, max_size=3, evict_batch=2, clock=clock)
    for i in range(4):
        cache.set(f"k{i}", i)
        clock.advance(1)

    # при вставке k3 кэш был переполнен: два самых старых удалены
    assert cache.get("k0") is None
    assert cache.get("k1") is None
    assert cache.get("k2") == 2
    assert cache.get("k3") == 3
