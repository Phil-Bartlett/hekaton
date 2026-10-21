# Hekaton hub

A relay that Hekaton on each of your machines dials out to, so the machines can see each other's
sessions and ask things of each other from anywhere, not only through a shared folder. It holds each
machine's last presence (live sessions and saved cards), fans the roster out whenever anything
changes, and forwards a Terminate or Resume request and its answer between two machines. It never
sees a terminal, a transcript or a memory note; sharing memory notes still needs the shared data
folder.

Hekaton uses the hub when one is set under Settings, Paths. Without one, everything works through the
shared data folder alone. With both, the hub carries what it can and the folder carries the rest.

## Running it

```
docker build -t hekaton-hub server
docker run -d --name hekaton-hub --restart unless-stopped \
  -p 127.0.0.1:8600:8600 -v hekaton-hub:/data \
  -e HUB_PAIRING_CODE='choose a long phrase' hekaton-hub
```

Or without Docker: `cd server && npm install && HUB_PAIRING_CODE='…' node hub.js`.

| Variable           | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `HUB_PAIRING_CODE` | Required. What a machine must present once to pair; keep it long.           |
| `PORT`             | Listen port, default 8600.                                                  |
| `HUB_DATA`         | Folder for `tokens.json` and `presence.json`, default `/data` in the image. |
| `HUB_TRUST_PROXY`  | `1` behind a reverse proxy, so the pairing limiter sees the real address.   |

`GET /healthz` answers `ok` for a monitor or a proxy check.

## Putting it behind TLS

Run it on a LAN host and let an edge proxy terminate TLS; the hub itself speaks plain WebSocket. An
nginx server block, with a certificate from certbot:

```nginx
server {
    server_name hub.example.com;
    listen 443 ssl;
    location / {
        proxy_pass http://192.168.1.10:8600;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 1h;
    }
}
```

Set `HUB_TRUST_PROXY=1` in that case. Hekaton is then given `wss://hub.example.com`.

## Pairing

Under Settings, Paths, enter the hub address and the pairing code. The hub issues that machine its own
token, which Hekaton keeps in its local user-data folder (never in the shared data folder). Only a
hash of each token is stored on the hub, so copying its data folder gives nobody a way in. Five wrong
codes from one address lock that address out for ten minutes. Pair the same machine again and its
old token stops working; Unpair in Settings removes it from the hub.

## What crosses the wire

JSON text frames, one message each. A machine sends `hello` with its token, then `presence` whenever
something changes and every so often regardless; it receives `hosts`, the roster of the other
machines. A request is `command` (`terminate` or `resume`, with the card id); the hub forwards it to
the machine that owns the card, which answers with `result`, forwarded back. A machine that is not
connected gets no requests queued: the sender hears at once that it is away.
