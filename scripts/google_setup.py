#!/usr/bin/env python3
"""Подключение Google Business Profile — без пересылки ключей кому-либо.

Скрипт запускается у владельца карточек, читает ключи из окружения и
печатает то, что нужно вписать в переменные бота. Сами ключи никуда не
отправляются и в репозиторий не попадают.

    # 1. Ссылка для авторизации (нужны GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET)
    python scripts/google_setup.py auth

    # 2. Обмен кода из браузера на refresh-токен
    python scripts/google_setup.py token <код-из-браузера>

    # 3. Проверка доступа и готовая строка GOOGLE_LOCATIONS
    python scripts/google_setup.py locations

    # 4. Свежие отзывы по всем точкам — убедиться, что доступ работает
    python scripts/google_setup.py reviews
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from teabot import branches  # noqa: E402

SCOPE = "https://www.googleapis.com/auth/business.manage"
REDIRECT = "urn:ietf:wg:oauth:2.0:oob"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
INFO_URL = "https://mybusinessbusinessinformation.googleapis.com/v1"
REVIEWS_URL = "https://mybusiness.googleapis.com/v4"


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        sys.exit(f"❌ Не задана переменная {name}. Экспортируйте её перед запуском.")
    return value


def request(url: str, data: dict = None, token: str = "") -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        sys.exit(f"❌ HTTP {e.code}: {detail}")


def auth_url(client_id: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",  # без этого refresh-токен придёт только один раз
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def access_token() -> str:
    data = request(TOKEN_URL, {
        "client_id": env("GOOGLE_CLIENT_ID"),
        "client_secret": env("GOOGLE_CLIENT_SECRET"),
        "refresh_token": env("GOOGLE_REFRESH_TOKEN"),
        "grant_type": "refresh_token",
    })
    token = data.get("access_token")
    if not token:
        sys.exit("❌ Google не выдал access_token — проверьте refresh-токен.")
    return token


def locations_line(locations: list) -> str:
    """Сопоставляет локации Google с точками по адресу и собирает GOOGLE_LOCATIONS."""
    pairs = []
    for name, title, address in locations:
        code = guess_branch(title, address)
        pairs.append(f"{code or '?'}:{name}")
    return ",".join(pairs)


def guess_branch(title: str, address: str) -> str:
    """Угадывает точку по адресу — сверяет с адресами из teabot/branches.py."""
    haystack = f"{title} {address}".lower()
    for branch in branches.BRANCHES.values():
        street = branch.address.split(",")[0].lower().replace("ул. ", "").replace("пр-т ", "")
        if street.strip() in haystack:
            return branch.code
    return ""


def cmd_auth() -> None:
    print("Откройте ссылку, войдите владельцем карточек и скопируйте код:\n")
    print(auth_url(env("GOOGLE_CLIENT_ID")))
    print("\nЗатем: python scripts/google_setup.py token <код>")


def cmd_token(code: str) -> None:
    data = request(TOKEN_URL, {
        "client_id": env("GOOGLE_CLIENT_ID"),
        "client_secret": env("GOOGLE_CLIENT_SECRET"),
        "code": code,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    })
    token = data.get("refresh_token")
    if not token:
        sys.exit("❌ refresh_token не пришёл. Повторите шаг auth — нужен prompt=consent.")
    print("✅ Впишите это значение в переменные бота (Render), никуда больше:\n")
    print(f"GOOGLE_REFRESH_TOKEN={token}")


def cmd_locations() -> None:
    token = access_token()
    accounts = request(ACCOUNTS_URL, token=token).get("accounts", [])
    if not accounts:
        sys.exit("❌ Аккаунты не найдены — проверьте, что карточки принадлежат этому Google-аккаунту.")

    found = []
    for account in accounts:
        account_name = account.get("name", "")
        url = (f"{INFO_URL}/{account_name}/locations"
               f"?readMask=name,title,storefrontAddress&pageSize=100")
        for loc in request(url, token=token).get("locations", []):
            address = " ".join(
                (loc.get("storefrontAddress") or {}).get("addressLines", [])
            )
            full_name = f"{account_name}/{loc.get('name', '')}"
            found.append((full_name, loc.get("title", ""), address))
            print(f"• {loc.get('title', '')} — {address}\n  {full_name}")

    if found:
        print("\nВпишите в переменные бота:\n")
        print(f"GOOGLE_LOCATIONS={locations_line(found)}")
        print("\nЕсли вместо кода точки стоит «?» — подставьте нужный вручную: "
              + ", ".join(branches.BRANCHES))


def cmd_reviews() -> None:
    token = access_token()
    pairs = env("GOOGLE_LOCATIONS")
    for chunk in pairs.split(","):
        code, _, location = chunk.partition(":")
        branch = branches.find(code)
        title = branch.title if branch else code
        data = request(f"{REVIEWS_URL}/{location}/reviews?pageSize=5", token=token)
        reviews = data.get("reviews", [])
        print(f"\n📍 {title}: отзывов получено {len(reviews)}")
        for r in reviews:
            stars = r.get("starRating", "?")
            author = (r.get("reviewer") or {}).get("displayName", "гость")
            answered = "отвечен" if r.get("reviewReply") else "без ответа"
            print(f"   {stars} · {author} · {answered}: {(r.get('comment') or '')[:80]}")


COMMANDS = {"auth": cmd_auth, "token": cmd_token, "locations": cmd_locations,
            "reviews": cmd_reviews}


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] not in COMMANDS:
        sys.exit(__doc__)
    command = COMMANDS[args[0]]
    command(*args[1:]) if args[0] == "token" else command()


if __name__ == "__main__":
    main()
