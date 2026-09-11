"""Meta Graph API: страница Facebook и аккаунт Instagram.

Facebook: диалоги страницы, ответы в Messenger, посты на страницу
(FB_PAGE_ID, FB_PAGE_TOKEN).
Instagram: комментарии под последними публикациями и ответы на них
(IG_USER_ID, IG_TOKEN — обычно тот же токен страницы).
Публикация в Instagram требует медиафайла, поэтому здесь не поддерживается.
"""
import time
from datetime import datetime, timezone

from ..base import CAP_INBOX, CAP_PUBLISH, CAP_REPLY, ConnectorError, HttpConnector
from ..models import KIND_COMMENT, KIND_MESSAGE, PublishResult, SocialItem

GRAPH = "https://graph.facebook.com/v21.0"


def _ts(value: str) -> float:
    """ISO-8601 из Graph API → epoch. При неудаче — текущее время."""
    if not value:
        return time.time()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z").timestamp()
        except ValueError:
            return datetime.now(timezone.utc).timestamp()


class _GraphConnector(HttpConnector):
    async def _call(self, method: str, path: str, **kwargs) -> dict:
        params = kwargs.pop("params", {})
        params["access_token"] = self.creds["token"]
        status, body = await self._request(method, f"{GRAPH}/{path}", params=params, **kwargs)
        if isinstance(body, dict) and "error" in body:
            raise ConnectorError(str(body["error"].get("message", ""))[:100])
        return self._unwrap(status, body)


class FacebookConnector(_GraphConnector):
    network = "facebook"
    title = "Facebook (страница)"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY, CAP_PUBLISH})
    required_env = ("FB_PAGE_ID", "FB_PAGE_TOKEN")

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        data = await self._call(
            "GET", f"{self.creds['page_id']}/conversations",
            params={
                "fields": "id,participants,messages.limit(1){id,message,from,created_time}",
                "limit": limit,
            },
        )
        items = []
        for conv in data.get("data", []):
            msgs = (conv.get("messages") or {}).get("data") or []
            if not msgs:
                continue
            msg = msgs[0]
            sender = msg.get("from", {}) or {}
            if str(sender.get("id")) == str(self.creds["page_id"]):
                continue  # наш собственный ответ
            items.append(SocialItem(
                network=self.network,
                kind=KIND_MESSAGE,
                item_id=str(msg.get("id")),
                author=sender.get("name", "клиент"),
                text=msg.get("message", ""),
                created_at=_ts(msg.get("created_time", "")),
                thread_id=str(sender.get("id", "")),
                url=f"https://business.facebook.com/latest/inbox/all?selected_item_id={conv.get('id','')}",
                raw=msg,
            ))
        return items

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        await self._call(
            "POST", f"{self.creds['page_id']}/messages",
            json={
                "recipient": {"id": item.reply_to},
                "message": {"text": text},
                "messaging_type": "RESPONSE",
            },
        )
        return PublishResult(self.network, True)

    async def publish(self, text: str, link: str = "") -> PublishResult:
        payload = {"message": text}
        if link:
            payload["link"] = link
        res = await self._call("POST", f"{self.creds['page_id']}/feed", json=payload)
        post_id = res.get("id", "")
        return PublishResult(
            self.network, True,
            url=f"https://facebook.com/{post_id}" if post_id else "",
        )

    async def _probe(self) -> str:
        res = await self._call("GET", self.creds["page_id"], params={"fields": "name"})
        return f"✅ {res.get('name', 'страница подключена')}"


class InstagramConnector(_GraphConnector):
    network = "instagram"
    title = "Instagram"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY})
    required_env = ("IG_USER_ID", "IG_TOKEN")

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        media = await self._call(
            "GET", f"{self.creds['user_id']}/media",
            params={
                "fields": "id,permalink,comments.limit(5){id,text,username,timestamp}",
                "limit": 5,
            },
        )
        items = []
        for post in media.get("data", []):
            for c in (post.get("comments") or {}).get("data", []):
                items.append(SocialItem(
                    network=self.network,
                    kind=KIND_COMMENT,
                    item_id=str(c.get("id")),
                    author=c.get("username", "instagram"),
                    text=c.get("text", ""),
                    created_at=_ts(c.get("timestamp", "")),
                    thread_id=str(c.get("id")),
                    url=post.get("permalink", ""),
                    raw=c,
                ))
        items.sort(key=lambda i: i.created_at, reverse=True)
        return items[:limit]

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        await self._call("POST", f"{item.reply_to}/replies", params={"message": text})
        return PublishResult(self.network, True, url=item.url)

    async def publish(self, text: str, link: str = "") -> PublishResult:
        return PublishResult(
            self.network, False,
            error="Instagram публикует только с медиа — используйте отложенный постинг",
        )

    async def _probe(self) -> str:
        res = await self._call("GET", self.creds["user_id"], params={"fields": "username"})
        return f"✅ @{res.get('username', 'подключён')}"
