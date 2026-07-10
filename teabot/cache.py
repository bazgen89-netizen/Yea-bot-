"""Кэш в памяти с TTL и ограничением размера."""
import time
from typing import Any, Callable, Optional


class TTLCache:
    """Хранит пары ключ → значение не дольше ttl секунд, не больше max_size записей.

    При переполнении сначала удаляются просроченные записи, затем самые старые.
    clock инжектируется для тестов.
    """

    def __init__(self, ttl: float = 300, max_size: int = 200,
                 evict_batch: int = 50, clock: Callable[[], float] = time.time):
        self.ttl = ttl
        self.max_size = max_size
        self.evict_batch = evict_batch
        self._clock = clock
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Optional[Any]:
        entry = self._data.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if self._clock() - stored_at >= self.ttl:
            del self._data[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._cleanup()
        self._data[key] = (self._clock(), value)

    def _cleanup(self) -> None:
        if len(self._data) < self.max_size:
            return
        now = self._clock()
        expired = [k for k, (t, _) in self._data.items() if now - t >= self.ttl]
        for k in expired:
            del self._data[k]
        if len(self._data) >= self.max_size:
            oldest = sorted(self._data.items(), key=lambda x: x[1][0])
            for k, _ in oldest[:self.evict_batch]:
                del self._data[k]

    def __len__(self) -> int:
        return len(self._data)
