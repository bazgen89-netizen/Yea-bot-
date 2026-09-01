"""ВКонтакте: диалоги сообщества, ответы и посты на стене.

Нужен токен сообщества с правами messages + wall (VK_GROUP_TOKEN)
и числовой id сообщества (VK_GROUP_ID).
"""
import random
import time

from ..base import CAP_INBOX, CAP_PUBLISH, CAP_REPLY, ConnectorError, HttpConnector
from ..models import KIND_MESSAGE, PublishResult, SocialItem

API = "https://api.vk.com/method"
API_VERSION = "5.199"


class VKConnector(HttpConnector):
    network = "vk"
    title = "ВКонтакте"
    capabilities = frozenset({CAP_INBOX, CAP_REPLY, CAP_PUBLISH})
    required_env = ("VK_GROUP_TOKEN", "VK_GROUP_ID")

    def _cred_keys(self):
        return ("token",)  # group_id нужен только для постинга на стену

    async def _call(self, method: str, **params) -> dict:
        params.update(access_token=self.creds["token"], v=API_VERSION)
        data = await self._post(f"{API}/{method}", data=params)
        if isinstance(data, dict) and "error" in data:
            err = data["error"]
            raise ConnectorError(f"VK {err.get('error_code')}: {err.get('error_msg', '')[:80]}")
        return data.get("response", {}) if isinstance(data, dict) else {}

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        resp = await self._call("messages.getConversations", count=limit, extended=1)
        names = {
            p["id"]: f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            for p in resp.get("profiles", [])
        }
        items = []
        for conv in resp.get("items", []):
            msg = conv.get("last_message") or {}
            # Свои же исходящие ответы не показываем как входящие
            if msg.get("out"):
                continue
            peer = str(conv.get("conversation", {}).get("peer", {}).get("id", ""))
            author_id = msg.get("from_id")
            items.append(SocialItem(
                network=self.network,
                kind=KIND_MESSAGE,
                item_id=str(msg.get("id", peer)),
                author=names.get(author_id, f"id{author_id}"),
                text=msg.get("text", ""),
                created_at=float(msg.get("date", time.time())),
                thread_id=peer,
                url=f"https://vk.com/gim{self.creds.get('group_id', '')}?sel={author_id}",
                raw=msg,
            ))
        return items

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        await self._call(
            "messages.send",
            peer_id=item.reply_to,
            message=text,
            random_id=random.randint(1, 2_000_000_000),
        )
        return PublishResult(self.network, True)

    async def publish(self, text: str, link: str = "") -> PublishResult:
        group_id = self.creds.get("group_id")
        if not group_id:
            return PublishResult(self.network, False, error="не задан VK_GROUP_ID")
        resp = await self._call(
            "wall.post",
            owner_id=f"-{group_id}",
            from_group=1,
            message=text,
            **({"attachments": link} if link else {}),
        )
        post_id = resp.get("post_id")
        return PublishResult(
            self.network, True,
            url=f"https://vk.com/wall-{group_id}_{post_id}" if post_id else "",
        )

    async def _probe(self) -> str:
        resp = await self._call("groups.getById")
        groups = resp.get("groups") if isinstance(resp, dict) else None
        name = (groups or [{}])[0].get("name") if groups else None
        return f"✅ {name}" if name else "✅ токен принят"
