# Astra Developer Hub — writing an integration

An Astra integration adds a card to **Astra Connect**: a live status, settings, an optional details table and
optional alerts. It is a folder with one file, `astra-integration.json`. There is no code to write and none is
run: Astra performs the checks your manifest describes, with only the permissions the player switched on.

Start from `sdk/example/` and point your editor at `sdk/astra-integration.schema.json` for completion.

## The manifest

```json
{
  "$schema": "../astra-integration.schema.json",
  "manifestVersion": 1,
  "id": "acme-status",
  "name": "Acme network status",
  "description": "Shows whether the Acme network is up.",
  "version": "1.0.0",
  "author": "Acme",
  "homepage": "https://acme.example/astra",
  "category": "servers",
  "icon": "servers",
  "astra": ">=1.12.0",
  "permissions": ["network:api.acme.example", "notifications"],
  "config": [
    { "key": "region", "label": "Region", "type": "select", "options": ["eu", "us"], "default": "eu" },
    { "key": "token", "label": "API token", "type": "secret" }
  ],
  "status": {
    "type": "http-json",
    "url": "https://api.acme.example/v1/status?region={{config.region}}",
    "headers": { "Authorization": "Bearer {{config.token}}" },
    "path": "data.online",
    "connectedWhen": true,
    "text": "{{data.players}} players online",
    "textOtherwise": "Acme is down"
  },
  "details": {
    "type": "http-json",
    "url": "https://api.acme.example/v1/servers",
    "rows": "servers",
    "columns": [{ "label": "Server", "path": "name" }, { "label": "Players", "path": "players" }]
  },
  "notify": { "title": "Acme is now {{value}}", "body": "Status changed." }
}
```

| Field | Rules |
|---|---|
| `manifestVersion` | `1` |
| `id` | lowercase letters, digits, dashes; 2–41 characters; use a prefix with a dash. Can't be one of Astra's own ids. |
| `name`, `description`, `author`, `version` | required; `name` ≤ 60 characters; `version` like `1.0.0` |
| `category` | `maps`, `social`, `servers` or `player` |
| `icon` | an Astra icon name (`link`, `servers`, `globe`, `users`, `chart`, …) |
| `astra` | Astra versions it works with: `>=1.12.0`, `1.12.x`, `*` — refused if this Astra doesn't match |
| `minecraft` | optional, informational range |
| `permissions` | see below; must cover every host the manifest calls |
| `config` | settings fields: `text`, `url`, `number` (`min`/`max`), `bool`, `select` (`options`), `secret` (stored sealed with the OS key store; the page only sees "set") — `required: true` keeps the status at *Needs setup* until filled |
| `status` | required, `http-json` or `server-ping` |
| `details` | optional table for the details window |
| `notify` | optional; an alert in the inbox when the status changes (needs `notifications`) |

### Status checks

**`http-json`** — `GET` the `url` (HTTPS only, no redirects, 8 s timeout, answer ≤ 256 KB, must be JSON).
`path` picks a value (`data.servers[0].online`); `connectedWhen` decides *Connected* vs *Ready*: a value
(`true`, `"up"`), a list of values, or `{ "gt": 0 }`, `{ "gte": n }`, `{ "lt": n }`, `{ "not": x }`,
`{ "exists": true }`. Set `"otherwise": "error"` to show *Problem* instead of *Ready*. HTTP errors and non-JSON
answers are *Problem* with the reason.

**`server-ping`** — Minecraft Server List Ping to `address` (needs `ping`). Offline = *Ready* with the reason.

### Templates

`{{config.key}}` inserts a setting (URL-encoded inside `url`), `{{value}}` the value at `path`, `{{any.path}}` a
value from the answer. The **host** of a URL can't come from a setting — permissions are granted per host.

### Permissions

| Permission | Lets the integration |
|---|---|
| `network:api.example.com` | call `https://api.example.com/…` |
| `network:*.example.com` | call `example.com` and its subdomains |
| `ping` | ping Minecraft servers |
| `notifications` | put alerts in the Astra inbox |

Installing grants nothing. The player switches each permission on in **Connect → Developer Hub**; until all are on,
the card says *Needs setup — waiting for your OK*. There's no file, launcher, account or game access at all.

## Testing

In Astra: **Connect → Developer Hub → Test a folder** validates the manifest (errors and warnings with the field
path) and runs the status check once with the settings you type, showing the request, HTTP status, the value it
picked and the result — nothing is saved. Then **Install from folder**, grant the permissions, and turn it on in
Connect.

Without Astra, validation is plain Node:

```bash
node -e "const d=require('./src/eco/devhub');console.log(JSON.stringify(d.validate(require('./sdk/example/astra-integration.json'),{appVersion:'1.12.0'}),null,2))"
```

## Errors and reports

Every check's outcome (state, text, request, HTTP status, answer excerpt) is kept for the last 30 runs, and
problems also appear in Connect's error list and the inbox ("Integration problems"). **Copy error report** puts a
JSON report on the clipboard — Astra version, platform, validation results, permissions and recent checks, without
the player's settings — for the player to send to you.
