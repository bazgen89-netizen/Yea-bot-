"""Учёт устройств в рабочих сетях Wi-Fi.

Смысл простой: в магазине есть список «своих» устройств — касса,
терминал, планшет, телефоны сотрудников. Всё, что появилось сверх этого
списка, — повод посмотреть. Особенно ночью, когда магазин закрыт.

Реестр хранится в файле: на Render диск эфемерный, поэтому после
передеплоя первые устройства придут как новые — один раз.
"""
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

MAC_RE = re.compile(r"^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")

# Событие считается ночным вне этих часов (магазины работают 10–21)
WORK_HOURS = (9, 22)


def normalize_mac(value: str) -> str:
    """Приводит адрес к одному виду: разделители у роутеров разные."""
    cleaned = re.sub(r"[^0-9a-fA-F]", "", value or "").lower()
    if len(cleaned) != 12:
        return ""
    return ":".join(cleaned[i:i + 2] for i in range(0, 12, 2))


@dataclass
class Device:
    mac: str
    branch: str = ""
    name: str = ""
    ip: str = ""
    vendor: str = ""
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    trusted: bool = False

    @property
    def title(self) -> str:
        return self.name or self.vendor or self.mac


@dataclass(frozen=True)
class SeenReport:
    """Что изменилось в сети точки с прошлой проверки."""
    branch: str
    new: list
    returned: list
    known: list
    at_night: bool = False

    @property
    def has_news(self) -> bool:
        return bool(self.new or self.returned)


class DeviceRegistry:
    """Помнит устройства каждой точки и отвечает, что изменилось."""

    #: устройство, не появлявшееся дольше этого срока, считается вернувшимся
    ABSENT_SECONDS = 24 * 3600

    def __init__(self, path: Optional[str] = None,
                 clock=time.time, work_hours: tuple = WORK_HOURS):
        self.path = path
        self._clock = clock
        self.work_hours = work_hours
        self.devices: dict = {}
        self.last_check: dict = {}  # точка → когда агент выходил на связь
        self.load()

    # ------------------------------------------------------------ данные

    def key(self, branch: str, mac: str) -> str:
        return f"{branch}:{mac}"

    def get(self, branch: str, mac: str) -> Optional[Device]:
        return self.devices.get(self.key(branch, normalize_mac(mac)))

    def of_branch(self, branch: str) -> list:
        found = [d for d in self.devices.values() if d.branch == branch]
        return sorted(found, key=lambda d: d.last_seen, reverse=True)

    def trust(self, branch: str, mac: str, name: str = "") -> Optional[Device]:
        """Помечает устройство своим — о нём больше не предупреждаем."""
        device = self.get(branch, mac)
        if device is None:
            return None
        device.trusted = True
        if name:
            device.name = name
        self.save()
        return device

    def forget(self, branch: str, mac: str) -> bool:
        key = self.key(branch, normalize_mac(mac))
        if key in self.devices:
            del self.devices[key]
            self.save()
            return True
        return False

    # ------------------------------------------------------------ сверка

    def _is_night(self) -> bool:
        hour = time.localtime(self._clock()).tm_hour
        start, end = self.work_hours
        return not (start <= hour < end)

    def check(self, branch: str, seen: Iterable[dict]) -> SeenReport:
        """Сверяет увиденное с реестром и возвращает, что нового."""
        now = self._clock()
        new, returned, known = [], [], []

        for raw in seen:
            mac = normalize_mac(raw.get("mac", ""))
            if not mac:
                continue
            device = self.devices.get(self.key(branch, mac))

            if device is None:
                device = Device(
                    mac=mac, branch=branch, name=raw.get("name", ""),
                    ip=raw.get("ip", ""), vendor=raw.get("vendor", ""),
                    first_seen=now, last_seen=now,
                )
                self.devices[self.key(branch, mac)] = device
                new.append(device)
                continue

            was_absent = now - device.last_seen > self.ABSENT_SECONDS
            device.last_seen = now
            device.ip = raw.get("ip", "") or device.ip
            if not device.name and raw.get("name"):
                device.name = raw["name"]

            if device.trusted:
                known.append(device)
            elif was_absent:
                returned.append(device)
            else:
                known.append(device)

        self.last_check[branch] = now
        self.save()
        return SeenReport(branch=branch, new=new, returned=returned,
                          known=known, at_night=self._is_night())

    # --------------------------------------------------------- хранение

    def load(self) -> None:
        if not self.path or not os.path.exists(self.path):
            return
        try:
            with open(self.path, encoding="utf-8") as f:
                for item in json.load(f):
                    device = Device(**item)
                    self.devices[self.key(device.branch, device.mac)] = device
        except (OSError, ValueError, TypeError) as e:
            logger.warning("Реестр устройств не прочитан: %s", e)

    def save(self) -> None:
        if not self.path:
            return
        try:
            directory = os.path.dirname(self.path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump([asdict(d) for d in self.devices.values()], f,
                          ensure_ascii=False)
        except OSError as e:
            logger.warning("Реестр устройств не сохранён: %s", e)

    def __len__(self) -> int:
        return len(self.devices)
