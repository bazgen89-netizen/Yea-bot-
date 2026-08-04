#!/usr/bin/env python3
"""Получение refresh token для Google Business Profile API.

Запускается один раз на локальной машине (не на сервере):

    python scripts/google_oauth.py --client-id ... --client-secret ...

Скрипт откроет ссылку авторизации, примет ответ Google на http://localhost:8765
и напечатает refresh token — его нужно положить в GOOGLE_GBP_REFRESH_TOKEN.
Зависимостей, кроме стандартной библиотеки, нет.
"""
import argparse
import json
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/business.manage"
REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/"

_code: str = ""


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — имя задано базовым классом
        global _code
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _code = (params.get("code") or [""])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        message = "Готово, можно закрыть вкладку." if _code else "Код не получен."
        self.wfile.write(f"<h3>{message}</h3>".encode())

    def log_message(self, *args):
        pass  # не засорять консоль запросами браузера


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--client-secret", required=True)
    args = parser.parse_args()

    auth_link = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": args.client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",  # без него Google не выдаст refresh token повторно
    })
    print(f"Откройте ссылку и подтвердите доступ:\n{auth_link}\n")
    webbrowser.open(auth_link)

    server = HTTPServer(("localhost", REDIRECT_PORT), _Handler)
    server.handle_request()
    server.server_close()

    if not _code:
        raise SystemExit("Код авторизации не получен")

    body = urllib.parse.urlencode({
        "code": _code,
        "client_id": args.client_id,
        "client_secret": args.client_secret,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body)) as r:
        data = json.load(r)

    token = data.get("refresh_token")
    if not token:
        raise SystemExit(f"Refresh token не выдан. Ответ: {data}")
    print("\nGOOGLE_GBP_REFRESH_TOKEN=" + token)


if __name__ == "__main__":
    main()
