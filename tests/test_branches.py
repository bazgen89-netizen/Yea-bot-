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
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
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


# --------------------------------------------- Google: своя локация на точку

def google_env(**extra):
    return {"GOOGLE_CLIENT_ID": "c", "GOOGLE_CLIENT_SECRET": "s",
            "GOOGLE_REFRESH_TOKEN": "r", **extra}


def google_connectors(env):
    return [c for c in build_connectors(env, session=None)
            if c.network.startswith("google_maps")]


def test_google_locations_become_separate_platforms():
    found = google_connectors(google_env(
        GOOGLE_LOCATIONS="gagarina:accounts/1/locations/11,cheryomushki:accounts/1/locations/33"))

    assert [c.network for c in found] == ["google_maps_gagarina", "google_maps_cheryomushki"]
    assert all(c.enabled for c in found)
    assert "Гагарина" in found[0].title
    assert found[1].creds["location"] == "accounts/1/locations/33"


def test_single_google_location_still_works():
    found = google_connectors(google_env(GOOGLE_LOCATION="accounts/1/locations/2"))
    assert [c.network for c in found] == ["google_maps"]


def test_google_entry_without_location_is_skipped():
    found = google_connectors(google_env(GOOGLE_LOCATIONS="gagarina:accounts/1/locations/11,мусор"))
    assert [c.network for c in found] == ["google_maps_gagarina"]


def test_google_review_carries_its_branch():
    connector = google_connectors(google_env(
        GOOGLE_LOCATIONS="gagarina:accounts/1/locations/11"))[0]
    connector.session = FakeSession({"access_token": "t", "expires_in": 3600})
    connector._token, connector._token_expires = "t", 9e12  # токен уже есть
    connector.session = FakeSession({"reviews": [{
        "reviewId": "r1", "starRating": "FIVE", "comment": "Отличный подарок",
        "createTime": "2026-09-01T10:00:00Z", "name": "accounts/1/locations/11/reviews/r1",
        "reviewer": {"displayName": "Гость"},
    }]})

    item = run(connector.fetch())[0]
    assert item.branch == "gagarina"
    assert item.network == "google_maps_gagarina"
    assert item.rating == 5


# ------------------------------------------------- панель сгруппирована

def test_panel_groups_platforms_by_store():
    from teabot.handlers.social import group_by_branch

    env = {"YANDEX_BUSINESS_TOKEN": "t",
           "GOOGLE_CLIENT_ID": "c", "GOOGLE_CLIENT_SECRET": "s",
           "GOOGLE_REFRESH_TOKEN": "r",
           "GOOGLE_LOCATIONS": "gagarina:accounts/1/locations/11",
           "VK_GROUP_TOKEN": "v", "VK_GROUP_ID": "1"}
    enabled = [c for c in build_connectors(env, session=None) if c.enabled]

    groups = dict((title, [c.network for c in found])
                  for title, found in group_by_branch(enabled))
    titles = list(groups)

    # Гагарина собирает обе свои карточки — Яндекс и Google
    gagarina = next(t for t in titles if "Гагарина" in t)
    assert groups[gagarina] == ["yandex_maps_gagarina", "google_maps_gagarina"]
    assert "ул. Гагарина, 5А" in gagarina

    # Точки идут первыми, общие сети — последними
    assert titles[-1] == "🌐 Общие сети"
    assert "vk" in groups["🌐 Общие сети"]


def test_grouping_keeps_order_of_branches():
    from teabot.handlers.social import group_by_branch

    enabled = [c for c in build_connectors({"YANDEX_BUSINESS_TOKEN": "t"}, session=None)
               if c.enabled]
    titles = [t for t, _ in group_by_branch(enabled)]
    assert ["Гагарина" in titles[0], "Гастромаркет" in titles[1],
            "Черёмушки" in titles[2]] == [True, True, True]


def test_platforms_without_branch_stay_common():
    from teabot.handlers.social import group_by_branch

    enabled = [c for c in build_connectors(
        {"VK_GROUP_TOKEN": "v", "VK_GROUP_ID": "1"}, session=None) if c.enabled]
    groups = group_by_branch(enabled)
    assert [t for t, _ in groups] == ["🌐 Общие сети"]


# ------------------------------------------- посты в карточках Google Карт

def test_google_publishes_post_to_its_own_card():
    connector = google_connectors(google_env(
        GOOGLE_LOCATIONS="gagarina:accounts/1/locations/11"))[0]
    connector._token, connector._token_expires = "t", 9e12
    connector.session = FakeSession({"searchUrl": "https://maps.google.com/post"})

    result = run(connector.publish("Собрали новые подарочные наборы",
                                   link="https://waystea.ru",
                                   image_url="https://waystea.ru/foto.jpg"))

    assert result.ok
    call = connector.session.calls[0]
    assert call["url"].endswith("accounts/1/locations/11/localPosts")
    body = call["json"]
    assert body["summary"].startswith("Собрали новые")
    assert body["languageCode"] == "ru"
    assert body["media"][0]["sourceUrl"] == "https://waystea.ru/foto.jpg"
    assert body["callToAction"]["url"] == "https://waystea.ru"


def test_google_post_without_picture_and_link():
    connector = google_connectors(google_env(
        GOOGLE_LOCATIONS="cheryomushki:accounts/1/locations/33"))[0]
    connector._token, connector._token_expires = "t", 9e12
    connector.session = FakeSession({})

    assert run(connector.publish("Новое поступление улунов")).ok
    body = connector.session.calls[0]["json"]
    assert "media" not in body and "callToAction" not in body


def test_post_goes_to_every_store_card():
    from teabot.social import CAP_PUBLISH as PUBLISH

    env = google_env(GOOGLE_LOCATIONS=(
        "gagarina:accounts/1/locations/11,gastromarket:accounts/1/locations/22,"
        "cheryomushki:accounts/1/locations/33"))
    publishing = [c for c in google_connectors(env) if c.can(PUBLISH)]
    assert len(publishing) == 3
