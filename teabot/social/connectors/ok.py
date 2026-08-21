"""Одноклассники: публикация в группу через api.ok.ru.

Требует связку application_key / application_secret_key / access_token
(OK_APP_KEY, OK_APP_SECRET, OK_ACCESS_TOKEN) и id группы (OK_GROUP_ID).
Подпись запроса: md5(отсортированные параметры + md5(access_token + app_secret)).
"""
import hashlib
import json

from ..base import CAP_PUBLISH, ConnectorError, HttpConnector
from ..models import PublishResult

API = "https://api.ok.ru/fb.do"


class OKConnector(HttpConnector):
    network = "ok"
    title = "Одноклассники"
    capabilities = frozenset({CAP_PUBLISH})
    required_env = ("OK_APP_KEY", "OK_APP_SECRET", "OK_ACCESS_TOKEN")

    def _cred_keys(self):
        return ("app_key", "app_secret", "access_token")

    def _sign(self, params: dict) -> str:
        secret = hashlib.md5(
            (self.creds["access_token"] + self.creds["app_secret"]).encode()
        ).hexdigest()
        joined = "".join(f"{k}={params[k]}" for k in sorted(params))
        return hashlib.md5((joined + secret).encode()).hexdigest()

    async def _call(self, method: str, **params) -> dict:
        params.update(application_key=self.creds["app_key"], method=method, format="json")
        params["sig"] = self._sign(params)
        params["access_token"] = self.creds["access_token"]
        data = await self._post(API, data=params)
        if isinstance(data, dict) and data.get("error_code"):
            raise ConnectorError(str(data.get("error_msg", "ошибка OK"))[:100])
        return data if isinstance(data, dict) else {"result": data}

    async def publish(self, text: str, link: str = "") -> PublishResult:
        group_id = self.creds.get("group_id")
        if not group_id:
            return PublishResult(self.network, False, error="не задан OK_GROUP_ID")
        media = {"media": [{"type": "text", "text": text if not link else f"{text}\n{link}"}]}
        await self._call(
            "mediatopic.post",
            gid=group_id,
            type="GROUP_THEME",
            attachment=json.dumps(media, ensure_ascii=False),
        )
        return PublishResult(self.network, True, url=f"https://ok.ru/group/{group_id}")

    async def _probe(self) -> str:
        await self._call("users.getCurrentUser")
        return "✅ токен принят"
