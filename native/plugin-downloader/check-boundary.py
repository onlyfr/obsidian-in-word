"""Probe an owned running helper. Never prints its ephemeral connection credential."""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def check(connection, origin):
    parsed = urlsplit(connection)
    base = f'{parsed.scheme}://{parsed.netloc}'
    def request(path, body, expected, request_origin=origin, token=parsed.fragment):
        req = Request(base + path, data=json.dumps(body).encode(), method='POST', headers={
            'Origin': request_origin, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urlopen(req, timeout=30) as response:
                actual = response.status
        except HTTPError as error:
            actual = error.code
            if request_origin != origin:
                assert error.headers.get('Access-Control-Allow-Origin') is None
        assert actual == expected, (path, actual, expected)
    request('/status', {}, 200)
    request('/status', {}, 403, request_origin='https://untrusted.example')
    request('/status', {}, 403, token='wrong')
    request('/asset', {'id': 'unknown', 'repo': 'maker/../local', 'assetId': 1, 'maxBytes': 100}, 400)
    request('/asset', {'id': 'unknown', 'repo': 'maker/repo', 'assetId': 1, 'maxBytes': 30 * 1024 * 1024}, 400)
    request('/asset', {'id': 'unknown', 'repo': 'maker/repo', 'assetId': 1, 'maxBytes': 100}, 400)
    request('/arbitrary-command', {}, 404)
    return {'validSession': True, 'foreignOriginRejected': True, 'wrongTokenRejected': True,
            'invalidRepoAndSizeRejected': True, 'unlistedPluginRejected': True, 'unknownRouteRejected': True}


if __name__ == '__main__':
    connection = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['connection']
    print(json.dumps(check(connection, sys.argv[2])))
