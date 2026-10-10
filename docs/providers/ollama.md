# Ollama

## Overview

- **Protocol:** REST, signed requests (`GET /api/balance`, `POST /api/me`)
- **URL:** `https://ollama.com`
- **Auth:** the Ed25519 key Ollama creates at `~/.ollama/id_ed25519`; no token or API key
- **Tracks:** Ollama Cloud plan credits and limits. Local models do not count toward them.
- **Default:** off. Turn Ollama on from the Providers page (see Setup).
- **Host:** WebUI only. The Tauri desktop app has no Ed25519 signing, so the plugin shows an error there.

Ported from the upstream Swift provider (`robinebers/openusage`, commit `bb7de176def2`).

## Setup

1. Install [Ollama](https://ollama.com/download) and create an account for a cloud plan, Free included.
2. Run `ollama signin`. It links `~/.ollama/id_ed25519` to your ollama.com account.
3. Open the Providers page and switch **Ollama** to Enabled.

Ollama never enables itself. The key file exists as soon as Ollama has run once, signed in or not, so OpenUsage
cannot tell that Cloud is set up. Enabling is the existing per-provider toggle; the choice is kept across restarts.

## Authentication

The plugin reads `~/.ollama/id_ed25519`, an unencrypted OpenSSH key holding one `ssh-ed25519` key. It signs each
request with the key's seed, the way the Ollama CLI does, and sends only the public key and the signature:

```
Authorization: <base64 SSH public key blob>:<base64 Ed25519 signature>
Accept: application/json
```

The signed text is `<METHOD>,<path>?ts=<unix seconds>`, for example `GET,/api/balance?ts=1700000000`. The server
rejects a stale `ts`, so a captured header cannot be replayed later. The signing happens in the host through
`host.crypto.ed25519Sign(seedBase64, message)`, which returns `{ signatureBase64, publicKeyBase64 }`.

The key, its seed and the signatures are never logged, returned or put into an error message. An encrypted key,
a file with more than one key, and a file whose two copies of the public key disagree are rejected as unusable.

There is no `OLLAMA_API_KEY` path. The documented Bearer token is not used, as in the upstream provider.

## Data Source

### Endpoints

```
GET  https://ollama.com/api/balance?ts=<unix>   required: credits and limits
POST https://ollama.com/api/me?ts=<unix>        best effort: plan name only
```

Ollama allows 10 balance requests per minute per user. See [docs.ollama.com/api/balance](https://docs.ollama.com/api/balance).

### Balance response

Current plans carry a monthly dollar allowance:

```json
{
  "included": {
    "balance_usd": 72.5,
    "allowance_usd": 100,
    "period": { "from": "2026-09-15T09:30:00Z", "until": "2026-10-15T09:30:00Z" }
  },
  "purchased": { "balance_usd": 25 }
}
```

Legacy plans keep session and weekly limits, as a percentage that remains:

```json
{
  "included": {
    "session": { "remaining_percent": 75, "resets_at": "2026-10-01T07:00:00Z" },
    "weekly": { "remaining_percent": 40, "resets_at": "2026-10-05T00:00:00Z" }
  },
  "purchased": { "balance_usd": 25 }
}
```

Ollama reports what remains; the plugin shows what is used (Monthly used = allowance - balance, Session used =
100 - remaining). A meter missing from the response is left out instead of shown as zero.

### Account response

`/api/me` returns capitalized keys when called directly (`{"ID":"...","Email":"...","Name":"...","Plan":"pro"}`).
The plugin reads only `Plan` (or `plan`) and title-cases it, so `pro` becomes `Pro`. Nothing else from this
response is read, logged or shown.

## Displayed Lines

| Line | Scope | Condition | Description |
|------|-------|-----------|-------------|
| Status | detail | plan lookup failed or unreadable | Amber notice: "Couldn't read your Ollama plan. Usage below is still up to date." Shown above the meters |
| Session | overview | `included.session.remaining_percent` is numeric | Legacy plans: percent used in the 5 hour window, with a reset time when `resets_at` parses |
| Weekly | overview | `included.weekly.remaining_percent` is numeric | Legacy plans: percent used in the 7 day window, with a reset time when `resets_at` parses |
| Monthly | overview | `allowance_usd` > 0 and `balance_usd` numeric | Current plans: dollars used of the monthly allowance, with the reset time and period from `period` |
| Purchased Credits | detail | `purchased.balance_usd` numeric | Dollars left of bought credits, floored at $0.00. These are used after included credits run out |

Each account reports either Monthly or Session and Weekly. The plan name appears beside the provider name;
an account with an empty plan shows no badge and no notice.

## Errors

| Condition | Message |
|-----------|---------|
| Not the WebUI host | "Ollama needs the OpenUsage WebUI: this host can't sign requests with an Ed25519 key." |
| No key file | "No Ollama key found. Install Ollama and run `ollama signin` to track cloud usage." |
| Key file not readable | "Couldn't read ~/.ollama/id_ed25519. Check the file's permissions." |
| Key file not a usable key | "~/.ollama/id_ed25519 isn't a usable Ollama signing key." |
| `/api/balance` 401 or 403 | "Not signed in to Ollama Cloud. Run `ollama signin` to see usage." |
| Other non-2xx | "Usage request failed (HTTP {status}). Try again later." |
| Network or signing error | "Usage request failed. Check your connection." |
| No readable `included` allowance | "Usage response invalid. Try again later." |
| Plan lookup failed | Status notice above; meters still refresh |

A signing failure and a network failure share one message, as in the upstream provider. The plugin logs only a
fixed note (which endpoint, or the HTTP status), never the error text.

## Privacy and Logging

The WebUI host does not log plugin HTTP traffic, and its `host.log` functions do nothing. The Tauri host logs request
URLs and a redacted response body, but it cannot run this plugin because it has no `ed25519Sign`. Before adding
Ed25519 to that host, extend `src-tauri/src/plugin_engine/host_api.rs`: `redact_body` matches `"email"` and `"name"`
case-sensitively, so the capitalized `"Email"` and `"Name"` from `/api/me` would not be redacted, and neither
`redact_body` nor `redact_log_message` knows an OpenSSH private key.
