import pytest

from teabot.config import Settings, DEFAULT_SOCIAL_NETWORKS
from teabot.social import NETWORKS, SocialConfig, known, title, validate


# --- каталог сетей ---

def test_known_filters_unsupported_codes():
    assert known(["instagram", "myspace", "facebook"]) == ["instagram", "facebook"]


def test_title_falls_back_to_code():
    assert title("instagram") == NETWORKS["instagram"].title
    assert title("myspace") == "myspace"


# --- валидация поста ---

def test_validate_accepts_text_only_post_for_text_networks():
    assert validate("Новый шен пуэр в наличии", [], ["facebook"]) == []


def test_validate_requires_media_for_instagram():
    problems = validate("Новый шен пуэр", [], ["instagram"])
    assert len(problems) == 1
    assert "фото" in problems[0]


def test_validate_accepts_instagram_with_media():
    assert validate("Новый шен пуэр", ["https://cdn/img.jpg"], ["instagram"]) == []


def test_validate_checks_text_limit_per_network():
    long_text = "ц" * 400
    problems = validate(long_text, ["https://cdn/img.jpg"], ["pinterest", "facebook"])
    # 400 символов: Pinterest (лимит 500) проходит, а X с лимитом 280 — нет
    assert problems == []
    assert validate(long_text, [], ["twitter"])


def test_validate_rejects_empty_selection_and_empty_post():
    assert validate("текст", [], []) == ["Не выбрана ни одна соцсеть."]
    problems = validate("   ", [], ["facebook"])
    assert any("пустой" in p for p in problems)


def test_validate_reports_unknown_network():
    problems = validate("текст", [], ["myspace"])
    assert any("Неизвестная сеть" in p for p in problems)


# --- доступ ---

def test_social_config_denies_when_no_admins():
    assert SocialConfig(networks=("facebook",)).allows(42) is False


def test_social_config_allows_listed_admin():
    cfg = SocialConfig(networks=("facebook",), admins=frozenset({42}))
    assert cfg.allows(42) and not cfg.allows(43)


# --- настройки ---

@pytest.fixture
def clean_env(monkeypatch):
    for var in ("METRICOOL_USER_TOKEN", "METRICOOL_USER_ID", "METRICOOL_BLOG_ID",
                "SOCIAL_NETWORKS", "SOCIAL_ADMINS", "SOCIAL_TIMEZONE"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def test_social_disabled_without_credentials(clean_env):
    s = Settings.from_env()
    assert s.social_enabled is False
    assert s.social_networks == DEFAULT_SOCIAL_NETWORKS
    assert s.social_admins == frozenset()


def test_social_enabled_with_full_credentials(clean_env):
    clean_env.setenv("METRICOOL_USER_TOKEN", "tok")
    clean_env.setenv("METRICOOL_USER_ID", "4951550")
    clean_env.setenv("METRICOOL_BLOG_ID", "6427175")
    assert Settings.from_env().social_enabled is True


def test_social_partial_credentials_stay_disabled(clean_env):
    clean_env.setenv("METRICOOL_USER_TOKEN", "tok")
    assert Settings.from_env().social_enabled is False


def test_parses_admins_and_networks(clean_env):
    clean_env.setenv("SOCIAL_ADMINS", "42, 77 ; oops")
    clean_env.setenv("SOCIAL_NETWORKS", "instagram, facebook")
    s = Settings.from_env()
    assert s.social_admins == frozenset({42, 77})
    assert s.social_networks == ("instagram", "facebook")
