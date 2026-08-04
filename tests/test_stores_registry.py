import json

from teabot.stores import StoreRegistry
from teabot.stores.models import GOOGLE, TWOGIS, YANDEX

RAW = {
    "stores": [
        {
            "slug": "msk",
            "name": "Waystea",
            "city": "Москва",
            "address": "ул. Примерная, 1",
            "platforms": {
                "yandex": {"id": "111", "query": "Waystea Москва"},
                "2gis": "222",
                "google": {"id": "ChIJ1", "owner_id": "accounts/1/locations/2"},
                "vk_maps": {"id": "333"},
            },
        },
        {"name": "Waystea СПб", "platforms": {"2gis": {"id": "444"}}},
        {"platforms": {}},
    ]
}


def test_from_dict_parses_platforms():
    reg = StoreRegistry.from_dict(RAW)

    assert len(reg) == 2  # запись без slug/name пропущена
    msk = reg.get("msk")
    assert msk.title == "Waystea — Москва"
    assert set(msk.refs) == {YANDEX, TWOGIS, GOOGLE}  # неизвестная площадка отброшена
    assert msk.refs[TWOGIS].external_id == "222"  # строка вместо словаря
    assert msk.refs[GOOGLE].owner_id == "accounts/1/locations/2"


def test_slug_falls_back_to_name():
    reg = StoreRegistry.from_dict(RAW)
    assert reg.get("Waystea СПб") is not None


def test_public_url_built_per_platform():
    reg = StoreRegistry.from_dict(RAW)
    refs = reg.get("msk").refs

    assert refs[YANDEX].public_url() == "https://yandex.ru/maps/org/111/"
    assert refs[TWOGIS].public_url() == "https://2gis.ru/firm/222"
    assert "place_id:ChIJ1" in refs[GOOGLE].public_url()


def test_search_text_prefers_query():
    reg = StoreRegistry.from_dict(RAW)
    msk = reg.get("msk")

    assert msk.search_text(YANDEX) == "Waystea Москва"
    assert msk.search_text(TWOGIS) == "Waystea Москва ул. Примерная, 1"


def test_platforms_in_use():
    reg = StoreRegistry.from_dict(RAW)
    assert reg.platforms_in_use() == {YANDEX, TWOGIS, GOOGLE}


def test_from_file_missing_is_empty(tmp_path):
    assert len(StoreRegistry.from_file(tmp_path / "нет.json")) == 0


def test_from_file_broken_json_is_empty(tmp_path):
    path = tmp_path / "stores.json"
    path.write_text("{не json", encoding="utf-8")
    assert len(StoreRegistry.from_file(path)) == 0


def test_from_file_reads_json(tmp_path):
    path = tmp_path / "stores.json"
    path.write_text(json.dumps(RAW, ensure_ascii=False), encoding="utf-8")
    assert len(StoreRegistry.from_file(path)) == 2
