// Ollama Cloud usage. Port of robinebers/openusage (Swift) Providers/Ollama at bb7de176def2.
// Credential: the ed25519 keypair `ollama` writes to ~/.ollama/id_ed25519. Requests are signed
// with it the way the Ollama CLI does, so no token or API key exists to read.
// The key material (seed, PEM, signatures) lives only inside one probe call and is never passed to
// ctx.host.log.*, a thrown message or a returned line.
(function () {
  var KEY_PATH = "~/.ollama/id_ed25519"
  var HOST = "https://ollama.com"
  var BALANCE_PATH = "/api/balance"
  var ACCOUNT_PATH = "/api/me"
  var SESSION_PERIOD_MS = 5 * 60 * 60 * 1000
  var WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

  var MSG_HOST = "Ollama needs the OpenUsage WebUI: this host can't sign requests with an Ed25519 key."
  var MSG_MISSING = "No Ollama key found. Install Ollama and run `ollama signin` to track cloud usage."
  var MSG_UNREADABLE = "Couldn't read ~/.ollama/id_ed25519. Check the file's permissions."
  var MSG_INVALID_KEY = "~/.ollama/id_ed25519 isn't a usable Ollama signing key."
  var MSG_NOT_SIGNED_IN = "Not signed in to Ollama Cloud. Run `ollama signin` to see usage."
  var MSG_CONNECTION = "Usage request failed. Check your connection."
  var MSG_INVALID_RESPONSE = "Usage response invalid. Try again later."
  var MSG_PLAN = "Couldn't read your Ollama plan. Usage below is still up to date."

  // --- Bytes: plain number arrays. ctx.base64 is UTF-8 based, so it cannot carry binary. ---

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  function base64ToBytes(text) {
    if (text.length % 4 !== 0 || !/^[A-Za-z0-9+\/]*={0,2}$/.test(text)) return null
    var bytes = []
    var buffer = 0
    var bits = 0
    for (var i = 0; i < text.length && text.charAt(i) !== "="; i++) {
      buffer = (buffer << 6) | B64.indexOf(text.charAt(i))
      bits += 6
      if (bits >= 8) {
        bits -= 8
        bytes.push((buffer >> bits) & 0xff)
        buffer &= (1 << bits) - 1
      }
    }
    return bytes
  }

  function bytesToBase64(bytes) {
    var out = ""
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
      out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : "="
      out += i + 2 < bytes.length ? B64.charAt(n & 63) : "="
    }
    return out
  }

  function asciiBytes(text) {
    var bytes = []
    for (var i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i))
    return bytes
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  var MAGIC = asciiBytes("openssh-key-v1\0")
  var NONE = asciiBytes("none")
  var KEY_TYPE = asciiBytes("ssh-ed25519")

  // Cursor over the SSH wire format: big-endian uint32 lengths followed by their payloads. Every
  // read is bounds-checked and returns null past the end, so a truncated file cannot over-read.
  function ByteReader(bytes, offset) {
    this.bytes = bytes
    this.offset = offset
  }
  ByteReader.prototype.uint32 = function () {
    var b = this.bytes
    var o = this.offset
    if (o + 4 > b.length) return null
    this.offset = o + 4
    return b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]
  }
  ByteReader.prototype.string = function () {
    var length = this.uint32()
    if (length === null || this.offset + length > this.bytes.length) return null
    var value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  // --- Key ---

  // The public half of a seed, from the host (the plugin has no ed25519 implementation of its own).
  function derivePublicKey(ctx, seed) {
    try {
      return base64ToBytes(ctx.host.crypto.ed25519Sign(bytesToBase64(seed), "").publicKeyBase64)
    } catch (e) {
      return null
    }
  }

  // Unencrypted OpenSSH container (PROTOCOL.key), scoped to what Ollama writes: one ssh-ed25519
  // key, no passphrase. Returns { seedBase64, publicKeyBase64 } or null for any deviation.
  function parseSigningKey(ctx, pem) {
    var body = pem
      .split(/\r\n|\r|\n/)
      .map(function (line) {
        return line.trim()
      })
      .filter(function (line) {
        return line !== "" && line.indexOf("-----") !== 0
      })
      .join("")
    var blob = base64ToBytes(body)
    if (!blob || !sameBytes(blob.slice(0, MAGIC.length), MAGIC)) return null

    var reader = new ByteReader(blob, MAGIC.length)
    var cipher = reader.string()
    var kdf = reader.string()
    var kdfOptions = reader.string()
    var keyCount = reader.uint32()
    var publicKeyBlob = reader.string()
    var privateSection = reader.string()
    if (cipher === null || !sameBytes(cipher, NONE)) return null
    if (kdf === null || !sameBytes(kdf, NONE)) return null
    if (kdfOptions === null || keyCount !== 1 || publicKeyBlob === null || privateSection === null) return null

    var priv = new ByteReader(privateSection, 0)
    if (priv.uint32() === null || priv.uint32() === null) return null // checkints
    var type = priv.string()
    if (type === null || !sameBytes(type, KEY_TYPE)) return null
    if (priv.string() === null) return null // public key, repeated
    var secret = priv.string() // seed || public key
    if (secret === null || secret.length !== 64) return null

    // Reject a key whose declared public half does not match the private one.
    var seed = secret.slice(0, 32)
    var derived = derivePublicKey(ctx, seed)
    if (derived === null || !sameBytes(derived, secret.slice(32))) return null

    // The outer public key is what the Authorization header carries. A damaged file can pair an
    // intact private key with another public half; every request would then be signed correctly,
    // rejected by ollama.com and reported as "not signed in" - a dead end signing in cannot fix.
    var outer = new ByteReader(publicKeyBlob, 0)
    var outerType = outer.string()
    if (outerType === null || !sameBytes(outerType, KEY_TYPE)) return null
    var outerKey = outer.string()
    if (outerKey === null || !sameBytes(outerKey, derived)) return null

    return { seedBase64: bytesToBase64(seed), publicKeyBase64: bytesToBase64(publicKeyBlob) }
  }

  function loadSigningKey(ctx) {
    var pem
    try {
      pem = ctx.host.fs.exists(KEY_PATH) ? ctx.host.fs.readText(KEY_PATH) : null
    } catch (e) {
      ctx.host.log.warn("ollama key file could not be read")
      throw MSG_UNREADABLE
    }
    if (typeof pem !== "string" || !pem.trim()) throw MSG_MISSING
    var key = parseSigningKey(ctx, pem)
    if (!key) {
      ctx.host.log.warn("ollama key file is not an unencrypted OpenSSH ed25519 key")
      throw MSG_INVALID_KEY
    }
    return key
  }

  // --- Requests ---

  // The challenge is "<METHOD>,<request-uri>" with a unix-seconds ts the server rejects when stale;
  // the header is "<base64 public key blob>:<base64 signature>".
  function send(ctx, key, method, path, ts) {
    var requestUri = path + "?ts=" + ts
    var signed = ctx.host.crypto.ed25519Sign(key.seedBase64, method + "," + requestUri)
    return ctx.util.request({
      method: method,
      url: HOST + requestUri,
      headers: {
        Authorization: key.publicKeyBase64 + ":" + signed.signatureBase64,
        Accept: "application/json",
      },
      timeoutMs: 15000,
    })
  }

  // Never forwards the exception text: a host error could echo request headers or the seed.
  function attempt(ctx, key, method, path, ts) {
    try {
      return { resp: send(ctx, key, method, path, ts) }
    } catch (e) {
      ctx.host.log.warn("ollama " + path + " request did not complete")
      return { failed: true }
    }
  }

  // --- Mapping (pure) ---

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
  }

  function parseObject(ctx, text) {
    var value = ctx.util.tryParseJson(text)
    return isObject(value) ? value : null
  }

  // JSON numbers and numeric strings; not booleans, not non-finite values.
  function toNumber(value) {
    if (typeof value === "string") {
      if (!value.trim()) return null
      value = Number(value.trim())
    }
    return typeof value === "number" && isFinite(value) ? value : null
  }

  function toIso(ctx, value) {
    return typeof value === "string" ? ctx.util.toIso(value) : null
  }

  function clampPercent(value) {
    return isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0
  }

  function dollars(value) {
    return "$" + value.toFixed(2)
  }

  // Ollama reports what remains; the meter shows what is used.
  function legacyLine(ctx, entry, label, periodMs) {
    if (!isObject(entry)) return null
    var remaining = toNumber(entry.remaining_percent)
    if (remaining === null) return null
    var opts = { label: label, used: clampPercent(100 - remaining), limit: 100, format: { kind: "percent" } }
    // The period only pairs with a real reset; alone it would render a static "Resets in 5h".
    var resetsAt = toIso(ctx, entry.resets_at)
    if (resetsAt) {
      opts.resetsAt = resetsAt
      opts.periodDurationMs = periodMs
    }
    return ctx.line.progress(opts)
  }

  function monthlyLine(ctx, included) {
    var allowance = toNumber(included.allowance_usd)
    var balance = toNumber(included.balance_usd)
    if (allowance === null || allowance <= 0 || balance === null) return null
    var period = isObject(included.period) ? included.period : {}
    var from = toIso(ctx, period.from)
    var until = toIso(ctx, period.until)
    var opts = {
      label: "Monthly",
      used: Math.min(allowance, Math.max(0, allowance - balance)),
      limit: allowance,
      format: { kind: "dollars" },
    }
    if (until) opts.resetsAt = until
    if (from && until && Date.parse(until) > Date.parse(from)) {
      opts.periodDurationMs = Math.trunc(Date.parse(until) - Date.parse(from))
    }
    return ctx.line.progress(opts)
  }

  // Session and Weekly (legacy plans) or Monthly (current plans), then Purchased Credits.
  function balanceLines(ctx, bodyText) {
    var root = parseObject(ctx, bodyText)
    if (!root || !isObject(root.included)) throw MSG_INVALID_RESPONSE

    var lines = []
    var session = legacyLine(ctx, root.included.session, "Session", SESSION_PERIOD_MS)
    var weekly = legacyLine(ctx, root.included.weekly, "Weekly", WEEKLY_PERIOD_MS)
    var monthly = monthlyLine(ctx, root.included)
    if (session) lines.push(session)
    if (weekly) lines.push(weekly)
    if (monthly) lines.push(monthly)
    // `included` is the allowance this plugin exists to show. Matching neither documented shape
    // means the response is not one it understands: fail rather than show an empty card.
    if (lines.length === 0) throw MSG_INVALID_RESPONSE

    var purchased = isObject(root.purchased) ? toNumber(root.purchased.balance_usd) : null
    if (purchased !== null) {
      lines.push(ctx.line.text({ label: "Purchased Credits", value: dollars(Math.max(0, purchased)) }))
    }
    return lines
  }

  // { name } for a usable plan, {} for an account without one, { unreadable: true } when the
  // response is not an account or its plan field vanished or changed type. Called directly,
  // ollama.com capitalizes its JSON keys (`Plan`); the local server lowercases them.
  function planFrom(ctx, bodyText) {
    var root = parseObject(ctx, bodyText)
    if (!root) return { unreadable: true }
    var raw = root.Plan !== undefined ? root.Plan : root.plan
    if (typeof raw !== "string") return { unreadable: true }
    var name = raw.trim()
    if (!name) return {}
    return {
      name: name.toLowerCase().replace(/(^|\s)(\S)/g, function (m, space, letter) {
        return space + letter.toUpperCase()
      }),
    }
  }

  // --- Probe ---

  function probe(ctx) {
    if (typeof ctx.host.crypto.ed25519Sign !== "function") throw MSG_HOST
    var key = loadSigningKey(ctx)
    var ts = Math.floor(Date.parse(ctx.nowIso) / 1000)

    // The balance endpoint is required; the account endpoint only names the plan, so a failure
    // there must not blank out the meters.
    var balance = attempt(ctx, key, "GET", BALANCE_PATH, ts)
    var account = attempt(ctx, key, "POST", ACCOUNT_PATH, ts)

    var accountBody = null
    var warn = false
    if (account.resp && account.resp.status >= 200 && account.resp.status < 300) {
      accountBody = account.resp.bodyText
    } else {
      ctx.host.log.warn(
        "ollama plan lookup failed (" + (account.resp ? "HTTP " + account.resp.status : "connection") + "); meters unaffected",
      )
      warn = true
    }

    if (balance.failed) throw MSG_CONNECTION
    var status = balance.resp.status
    // The key parsed and signed fine, so 401/403 means ollama.com does not know it: Ollama is
    // installed but `ollama signin` never ran (or the user signed out since).
    if (status === 401 || status === 403) throw MSG_NOT_SIGNED_IN
    if (status < 200 || status >= 300) throw "Usage request failed (HTTP " + status + "). Try again later."

    var lines = balanceLines(ctx, balance.resp.bodyText)
    var plan = accountBody === null ? {} : planFrom(ctx, accountBody)
    if (!warn && plan.unreadable) {
      ctx.host.log.warn("ollama plan response unreadable; meters unaffected")
      warn = true
    }
    if (warn) lines.unshift(ctx.line.badge({ label: "Status", text: MSG_PLAN, color: "#f59e0b" }))
    return { plan: plan.name, lines: lines }
  }

  globalThis.__openusage_plugin = { id: "ollama", probe: probe }
})()
