"""Точки Waystea: профили, отдельная карточка на магазин, ответы от её имени."""
import asyncio

from teabot import branches
from teabot.social import SeenStore, SocialHub, SocialItem, build_connectors
from teabot.social.models import KIND_REVIEW


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ профили

def test_every_branch_is_filled_in():
    for code, branch in branches.BRANCHES.items():
        assert branch.code == code
        assert branch.title and branch.format and branch.positioning
        assert branch.audience and branch.focus and branch.tone and branch.avoid
        assert branch.keywords


def test_branches_differ_in_focus():
    focuses = [set(b.focus) for b in branches.BRANCHES.values()]
    for i, first in enumerate(focuses):
        for second in focuses[i + 1:]:
            assert not first & second, "у точек должны быть разные акценты"


def test_find_is_case_insensitive_and_safe():
    assert branches.find("GAGARINA").title == "Гагарина"
    assert branches.find(" cheryomushki ").code == "cheryomushki"
    assert branches.find("выдумка") is None
    assert branches.find("") is None


def test_reply_profile_mentions_point_and_accents():
    profile = branches.GASTROMARKET.reply_profile()
    assert "Гастромаркет" in profile
    assert "чайная" in profile.lower()
    assert "дегустации" in profile


# ------------------------------------------- отдельная карточка на магазин

def yandex_env(**extra):
    return {"YANDEX_BUSINESS_TOKEN": "tok", **extra}


def yandex_connectors(env):
    return [c for c in build_connectors(env, session=None)
            if c.network.startswith("yandex_maps")]


def test_each_store_becomes_its_own_platform():
    env = yandex_env(YANDEX_COMPANIES="gagarina:111,gastromarket:222,cheryomushki:333")
    found = yandex_connectors(env)

    assert [c.network for c in found] == [
        "yandex_maps_gagarina", "yandex_maps_gastromarket", "yandex_maps_cheryomushki",
    ]
    assert all(c.enabled for c in found)
    assert [c.creds["company_id"] for c in found] == ["111", "222", "333"]
    assert "Гагарина" in found[0].title


def test_single_card_still_works_without_branches():
    found = yandex_connectors(yandex_env(YANDEX_COMPANY_ID="777"))
    assert len(found) == 1
    assert found[0].network == "yandex_maps"
    assert found[0].creds["company_id"] == "777"


def test_unknown_branch_code_still_gets_own_platform():
    found = yandex_connectors(yandex_env(YANDEX_COMPANIES="новая-точка:999"))
    assert found[0].network == "yandex_maps_новая-точка"
    assert found[0].enabled


def test_entry_without_company_id_is_skipped():
    found = yandex_connectors(yandex_env(YANDEX_COMPANIES="gagarina:111,сломано"))
    assert [c.network for c in found] == ["yandex_maps_gagarina"]


def test_token_is_shared_by_all_cards():
    found = yandex_connectors(yandex_env(
        YANDEX_COMPANIES="gagarina:111,cheryomushki:333", YANDEX_API_URL="https://api.test/v2"))
    assert {c.creds["token"] for c in found} == {"tok"}
    assert {c.creds["api_url"] for c in found} == {"https://api.test/v2"}


# ------------------------------------------------- ответ от имени точки

class RecordingAI:
    """Запоминает, с какой ролью его спросили."""

    def __init__(self):
        self.system = ""

    async def ask(self, prompt, system=""):
        self.system = system
        return "Спасибо за отзыв!"


def review(branch=""):
    return SocialItem(
        network="yandex_maps_gagarina", kind=KIND_REVIEW, item_id="r1",
        author="Гость", text="Купили набор в подарок — очень красиво",
        rating=5, branch=branch,
    )


def test_reply_is_written_on_behalf_of_the_store():
    ai = RecordingAI()
    hub = SocialHub([], SeenStore(), ai=ai)

    run(hub.draft_reply(review(branch="gagarina")))
    assert "Гагарина" in ai.system
    assert "подарочные наборы" in ai.system
    assert "Waystea" in ai.system  # общая роль магазина никуда не делась


def test_each_store_gets_its_own_role():
    ai = RecordingAI()
    hub = SocialHub([], SeenStore(), ai=ai)

    run(hub.draft_reply(review(branch="gastromarket")))
    tea_room = ai.system
    run(hub.draft_reply(review(branch="cheryomushki")))
    shop = ai.system

    assert "Гастромаркет" in tea_room and "Гастромаркет" not in shop
    assert "чай на развес" in shop
    assert tea_room != shop


def test_item_without_branch_uses_common_role():
    ai = RecordingAI()
    hub = SocialHub([], SeenStore(), ai=ai)

    run(hub.draft_reply(review()))
    assert "Waystea" in ai.system
    assert "Отвечаешь от имени точки" not in ai.system


# ------------------------------------------ отзыв помнит, откуда он пришёл

class FakeResponse:
    def __init__(self, payload):
        self.payload, self.status = payload, 200
        self.headers = {"Content-Type": "application/json"}

    async def json(self, content_type=None):
        return self.payload

    async def text(self):
        return ""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, payload):
        self.payload = payload

    def request(self, method, url, **kwargs):
        return FakeResponse(self.payload)


def test_fetched_review_carries_its_branch():
    reviews = {"reviews": [{"id": "r1", "text": "Отличный подарок", "rating": 5,
                            "author": {"name": "Гость"}, "created_at": "2026-09-01T10:00:00Z"}]}
    connector = yandex_connectors(yandex_env(YANDEX_COMPANIES="gagarina:111"))[0]
    connector.session = FakeSession(reviews)

    item = run(connector.fetch())[0]
    assert item.branch == "gagarina"
    assert item.network == "yandex_maps_gagarina"


# ------------------------------------------------ карточки точек по умолчанию

def test_every_branch_knows_its_card_and_address():
    for branch in branches.BRANCHES.values():
        assert branch.address and branch.yandex_id.isdigit()
        assert branch.yandex_id in branch.yandex_url


def test_cards_are_unique():
    ids = [b.yandex_id for b in branches.BRANCHES.values()]
    assert len(set(ids)) == len(ids)


def test_cards_of_branches_are_used_when_env_is_silent():
    found = yandex_connectors(yandex_env())
    assert [c.network for c in found] == [
        "yandex_maps_gagarina", "yandex_maps_gastromarket", "yandex_maps_cheryomushki",
    ]
    assert [c.creds["company_id"] for c in found] == [
        b.yandex_id for b in branches.BRANCHES.values()
    ]


def test_env_list_overrides_known_cards():
    found = yandex_connectors(yandex_env(YANDEX_COMPANIES="gagarina:999"))
    assert [c.creds["company_id"] for c in found] == ["999"]
