from teabot import crosspost
from teabot.crosspost import (
    CrosspostSettings, Post, extract_summary, format_telegram, format_vk,
    load_state, mark_done, parse_post, pending_posts, save_state, truncate,
    TG_CAPTION_LIMIT,
)


def make_post(post_id, **kw):
    return Post(id=post_id, title=kw.get("title", f"Статья {post_id}"),
                link=kw.get("link", f"https://waystea.ru/p{post_id}/"),
                summary=kw.get("summary", "Краткое описание."),
                image_url=kw.get("image_url"))


def test_extract_summary_prefers_korotko_paragraph():
    content = (
        "<p>Вступление.</p>"
        "<p><strong>Коротко:</strong> шу и шэн — два типа <em>пуэра</em>.</p>"
    )
    assert extract_summary(content, "<p>excerpt</p>") == "Шу и шэн — два типа пуэра."


def test_extract_summary_falls_back_to_excerpt_without_read_more():
    summary = extract_summary("<p>Текст</p>", "<p>Отрывок статьи &hellip; Читать далее</p>")
    assert summary == "Отрывок статьи"


def test_extract_summary_falls_back_to_first_paragraph():
    assert extract_summary("<p>Первый &amp; главный.</p><p>Второй.</p>") == "Первый & главный."


def test_truncate_cuts_on_word_boundary():
    assert truncate("один два три четыре", 12) == "один два…"
    assert truncate("коротко", 50) == "коротко"


def test_parse_post_reads_featured_image():
    post = parse_post({
        "id": 7, "link": "https://waystea.ru/x/",
        "title": {"rendered": "Шу &amp; шэн"},
        "content": {"rendered": "<p>Коротко: ответ.</p>"},
        "excerpt": {"rendered": ""},
        "_embedded": {"wp:featuredmedia": [{"source_url": "https://waystea.ru/i.jpg"}]},
    })
    assert post == Post(7, "Шу & шэн", "https://waystea.ru/x/", "Ответ.", "https://waystea.ru/i.jpg")


def test_format_telegram_escapes_html_and_fits_caption():
    post = make_post(1, title="Чай <b>&</b>", summary="слово " * 400)
    text = format_telegram(post)
    assert len(text) <= TG_CAPTION_LIMIT
    assert "Чай &lt;b&gt;&amp;&lt;/b&gt;" in text
    assert 'href="https://waystea.ru/p1/"' in text


def test_format_vk_contains_link():
    assert format_vk(make_post(2)).endswith("https://waystea.ru/p2/")


def test_first_run_marks_existing_posts_without_publishing():
    state = {}
    posts = [make_post(3), make_post(1)]
    assert pending_posts(posts, state, "telegram") == []
    assert state == {"telegram": [1, 3]}


def test_pending_returns_only_new_posts_oldest_first():
    state = {"vk": [1]}
    posts = [make_post(5), make_post(1), make_post(4)]
    assert [p.id for p in pending_posts(posts, state, "vk")] == [4, 5]


def test_state_roundtrip(tmp_path):
    path = str(tmp_path / "state.json")
    assert load_state(path) == {}
    state = {"telegram": [1]}
    mark_done(state, "telegram", 9)
    save_state(path, state)
    assert load_state(path) == {"telegram": [1, 9]}


def test_run_sends_new_posts_and_keeps_failed_for_retry(tmp_path, monkeypatch):
    path = str(tmp_path / "state.json")
    save_state(path, {"telegram": [1], "vk": [1]})
    posts = [make_post(1), make_post(2)]
    monkeypatch.setattr(crosspost, "fetch_posts", lambda url: posts)
    sent = []
    monkeypatch.setattr(crosspost, "send_telegram", lambda s, p: sent.append(("tg", p.id)))

    def failing_vk(s, p):
        raise RuntimeError("boom")
    monkeypatch.setattr(crosspost, "send_vk", failing_vk)

    settings = CrosspostSettings("https://waystea.ru", "tok", "@chan", "vktok", "123", path)
    assert crosspost.run(settings) == 1
    assert sent == [("tg", 2)]
    assert load_state(path) == {"telegram": [1, 2], "vk": [1]}


def test_run_without_platforms_does_nothing(tmp_path, monkeypatch):
    def no_fetch(url):
        raise AssertionError("не должен ходить в сеть")
    monkeypatch.setattr(crosspost, "fetch_posts", no_fetch)
    settings = CrosspostSettings("https://waystea.ru", "", "", "", "", str(tmp_path / "s.json"))
    assert crosspost.run(settings) == 0


def test_settings_from_env_strips_vk_minus(monkeypatch):
    monkeypatch.setenv("VK_GROUP_ID", "-12345")
    monkeypatch.setenv("VK_ACCESS_TOKEN", "t")
    monkeypatch.delenv("TELEGRAM_CHANNEL_ID", raising=False)
    s = CrosspostSettings.from_env()
    assert s.vk_group_id == "12345"
    assert s.vk_enabled and not s.telegram_enabled


def test_extract_summary_ignores_korotko_subheading():
    content = "<p>Первый абзац статьи.</p><p><strong>Коротко в цифрах:</strong> 1, 2, 3</p>"
    assert extract_summary(content) == "Первый абзац статьи."


def test_parse_post_uses_first_content_image_without_featured():
    post = parse_post({
        "id": 8, "link": "https://waystea.ru/y/", "title": {"rendered": "T"},
        "content": {"rendered": '<p>Коротко: да.</p><img src="https://waystea.ru/a.jpg">'},
    })
    assert post.image_url == "https://waystea.ru/a.jpg"
