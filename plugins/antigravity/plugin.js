(function () {
  var LS_SERVICE = "exa.language_server_pb.LanguageServerService"
  var STATE_DBS = [
    "~/Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb",
    "~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
    "~/.config/Antigravity IDE/User/globalStorage/state.vscdb",
    "~/.config/Antigravity/User/globalStorage/state.vscdb",
  ]
  var AGY_KEYCHAIN_SERVICE = "gemini"
  var AGY_KEYCHAIN_ACCOUNT = "antigravity"
  var CLOUD_CODE_URLS = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]
  var LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist"
  var FETCH_MODELS_PATH = "/v1internal:fetchAvailableModels"
  var RETRIEVE_QUOTA_PATH = "/v1internal:retrieveUserQuota"
  var QUOTA_SUMMARY_PATH = "/v1internal:retrieveUserQuotaSummary"
  // Google drops paidTier for callers that do not look like the Antigravity client, and the daily
  // host returns the Gemini 4 Argon quota group only to Antigravity Hub 2.16.0 or newer.
  var CLIENT_USER_AGENT = "antigravity/hub/2.23.1 darwin/arm64"
  var LOAD_CODE_ASSIST_BODY = { metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }
  var LOGIN_MESSAGE = "Start Antigravity or run `agy` and try again."
  var GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token"
  var GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
  var GOOGLE_CLIENT_SECRET = "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"
  var OAUTH_TOKEN_KEY = "antigravityUnifiedStateSync.oauthToken"
  var OAUTH_TOKEN_SENTINEL = "oauthTokenInfoSentinelKey"
  var CC_MODEL_BLACKLIST = {
    "MODEL_CHAT_20706": true,
    "MODEL_CHAT_23310": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE": true,
    "MODEL_GOOGLE_GEMINI_2_5_PRO": true,
    "MODEL_PLACEHOLDER_M19": true,
    "MODEL_PLACEHOLDER_M9": true,
    "MODEL_PLACEHOLDER_M12": true,
  }
  // --- Protobuf wire-format decoder ---

  function readVarint(s, pos) {
    var v = 0
    var shift = 0
    while (pos < s.length) {
      var b = s.charCodeAt(pos++)
      v += (b & 0x7f) * Math.pow(2, shift)
      if ((b & 0x80) === 0) return { v: v, p: pos }
      shift += 7
    }
    return null
  }

  function readFields(s) {
    var fields = {}
    var pos = 0
    while (pos < s.length) {
      var tag = readVarint(s, pos)
      if (!tag) break
      pos = tag.p
      var fieldNum = Math.floor(tag.v / 8)
      var wireType = tag.v % 8
      if (wireType === 0) {
        var val = readVarint(s, pos)
        if (!val) break
        fields[fieldNum] = { type: 0, value: val.v }
        pos = val.p
      } else if (wireType === 1) {
        if (pos + 8 > s.length) break
        pos += 8
      } else if (wireType === 2) {
        var len = readVarint(s, pos)
        if (!len) break
        pos = len.p
        if (pos + len.v > s.length) break
        fields[fieldNum] = { type: 2, data: s.substring(pos, pos + len.v) }
        pos += len.v
      } else if (wireType === 5) {
        if (pos + 4 > s.length) break
        pos += 4
      } else {
        break
      }
    }
    return fields
  }

  // --- SQLite credential reading ---

  // Antigravity wraps OAuth state in a double-base64 envelope:
  //   b64(outer.f1 = wrapper{ f1=sentinel, f2=payload{ f1=b64(inner proto) } }).
  // The inner base64 layer is the unusual part — it's a UTF-8 string field, not raw bytes.
  function unwrapOAuthSentinel(ctx, base64Text) {
    var trimmed = String(base64Text || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed) return null
    var outer = ctx.base64.decode(trimmed)
    var outerFields = readFields(outer)
    if (!outerFields[1] || outerFields[1].type !== 2) return null
    var wrapper = readFields(outerFields[1].data)
    var sentinel = (wrapper[1] && wrapper[1].type === 2) ? wrapper[1].data : null
    var payload = (wrapper[2] && wrapper[2].type === 2) ? wrapper[2].data : null
    if (sentinel !== OAUTH_TOKEN_SENTINEL || !payload) return null
    var payloadFields = readFields(payload)
    if (!payloadFields[1] || payloadFields[1].type !== 2) return null
    var innerText = payloadFields[1].data.replace(/^\s+|\s+$/g, "")
    if (!innerText) return null
    return ctx.base64.decode(innerText)
  }

  function loadOAuthTokensFromDb(ctx, dbPath) {
    try {
      var rows = ctx.host.sqlite.query(
        dbPath,
        "SELECT value FROM ItemTable WHERE key = '" + OAUTH_TOKEN_KEY + "' LIMIT 1"
      )
      var parsed = ctx.util.tryParseJson(rows)
      if (!parsed || !parsed.length || !parsed[0].value) return null
      var inner = unwrapOAuthSentinel(ctx, parsed[0].value)
      if (!inner) return null
      var fields = readFields(inner)
      var accessToken = (fields[1] && fields[1].type === 2) ? fields[1].data : null
      var refreshToken = (fields[3] && fields[3].type === 2) ? fields[3].data : null
      var expirySeconds = null
      if (fields[4] && fields[4].type === 2) {
        var ts = readFields(fields[4].data)
        if (ts[1] && ts[1].type === 0) expirySeconds = ts[1].value
      }
      if (!accessToken && !refreshToken) return null
      return { accessToken: accessToken, refreshToken: refreshToken, expirySeconds: expirySeconds }
    } catch (e) {
      ctx.host.log.warn("failed to read unified oauth token from " + dbPath + ": " + String(e))
      return null
    }
  }

  function readEnvText(ctx, name) {
    if (!ctx.host.env || typeof ctx.host.env.get !== "function") return null
    try {
      var value = ctx.host.env.get(name)
      if (typeof value !== "string") return null
      var trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.warn(name + " read failed: " + String(e))
      return null
    }
  }

  function joinPath(base, relativePath) {
    var root = String(base || "").replace(/\/+$/, "")
    var rel = String(relativePath || "").replace(/^\/+/, "")
    if (!root) return rel
    if (!rel) return root
    return root + "/" + rel
  }

  function hasPinnedAntigravityHome(ctx) {
    return !!(
      readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CLI_HOME") ||
      readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CONFIG_DIR")
    )
  }

  function stateDbCandidates(ctx) {
    var configDir = readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CONFIG_DIR")
    if (configDir) {
      return [joinPath(configDir, "User/globalStorage/state.vscdb")]
    }
    if (readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CLI_HOME")) {
      return []
    }
    return STATE_DBS.slice()
  }

  function loadCliOAuthTokens(ctx) {
    // IDE config pin is exclusive — do not also read an ambient CLI home.
    if (readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CONFIG_DIR")) return null
    var cliHome = readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CLI_HOME")
    if (!cliHome) return null
    var tokenPath = joinPath(cliHome, ".gemini/antigravity-cli/antigravity-oauth-token")
    try {
      if (!ctx.host.fs || typeof ctx.host.fs.exists !== "function" || !ctx.host.fs.exists(tokenPath)) {
        return null
      }
      var raw = ctx.host.fs.readText(tokenPath)
      var parsed = ctx.util.tryParseJson(raw)
      if (!parsed) return null
      // Prefer the nested Google OAuth token object. Top-level id_token is OIDC identity
      // only — extractTokenFromObject would otherwise treat it as a bearer access token.
      var accessToken = null
      var refreshToken = null
      if (parsed.token && typeof parsed.token === "object") {
        if (typeof parsed.token.access_token === "string" && parsed.token.access_token.trim()) {
          accessToken = parsed.token.access_token.trim()
        } else if (typeof parsed.token.accessToken === "string" && parsed.token.accessToken.trim()) {
          accessToken = parsed.token.accessToken.trim()
        }
        if (typeof parsed.token.refresh_token === "string" && parsed.token.refresh_token.trim()) {
          refreshToken = parsed.token.refresh_token.trim()
        } else if (typeof parsed.token.refreshToken === "string" && parsed.token.refreshToken.trim()) {
          refreshToken = parsed.token.refreshToken.trim()
        }
      }
      var expirySeconds = null
      if (parsed.token && typeof parsed.token === "object") {
        var expiryValue = parsed.token.expiry
        if (typeof expiryValue === "number" && Number.isFinite(expiryValue)) {
          expirySeconds = expiryValue > 1e11 ? Math.floor(expiryValue / 1000) : Math.floor(expiryValue)
        } else if (typeof expiryValue === "string" && expiryValue.trim()) {
          var expiryMs = Date.parse(expiryValue.trim())
          if (Number.isFinite(expiryMs)) expirySeconds = Math.floor(expiryMs / 1000)
        }
        if (typeof parsed.token.expirySeconds === "number" && Number.isFinite(parsed.token.expirySeconds)) {
          expirySeconds = parsed.token.expirySeconds
        }
      }
      if (!accessToken) accessToken = extractTokenFromObject(parsed.token)
      if (!accessToken) accessToken = extractTokenFromObject(parsed)
      if (!accessToken && !refreshToken) return null
      return { accessToken: accessToken, refreshToken: refreshToken, expirySeconds: expirySeconds }
    } catch (e) {
      ctx.host.log.warn("failed to read antigravity CLI oauth token: " + String(e))
      return null
    }
  }

  function loadOAuthTokenCandidates(ctx) {
    var candidates = []
    var cliTokens = loadCliOAuthTokens(ctx)
    if (cliTokens) candidates.push(cliTokens)

    var dbs = stateDbCandidates(ctx)
    for (var i = 0; i < dbs.length; i++) {
      var tokens = loadOAuthTokensFromDb(ctx, dbs[i])
      if (tokens) candidates.push(tokens)
    }
    return candidates
  }

  // --- Google OAuth token refresh ---

  function refreshAccessToken(ctx, refreshTokenValue) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }
    ctx.host.log.info("attempting Google OAuth token refresh")
    try {
      var resp = ctx.host.http.request({
        method: "POST",
        url: GOOGLE_OAUTH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID) +
          "&client_secret=" + encodeURIComponent(GOOGLE_CLIENT_SECRET) +
          "&refresh_token=" + encodeURIComponent(refreshTokenValue) +
          "&grant_type=refresh_token",
        timeoutMs: 15000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Google OAuth refresh returned status: " + resp.status)
        return null
      }
      var body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || !body.access_token) {
        ctx.host.log.warn("Google OAuth refresh response missing access_token")
        return null
      }
      var expiresIn = (typeof body.expires_in === "number") ? body.expires_in : 3600
      cacheToken(ctx, body.access_token, expiresIn)
      return body.access_token
    } catch (e) {
      ctx.host.log.warn("Google OAuth refresh failed: " + String(e))
      return null
    }
  }

  // --- Token cache ---

  function loadCachedToken(ctx) {
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      if (!ctx.host.fs.exists(path)) return null
      var data = ctx.util.tryParseJson(ctx.host.fs.readText(path))
      if (!data || !data.accessToken || !data.expiresAtMs) return null
      if (data.expiresAtMs <= Date.now()) return null
      return data.accessToken
    } catch (e) {
      ctx.host.log.warn("failed to read cached token: " + String(e))
      return null
    }
  }

  function cacheToken(ctx, accessToken, expiresInSeconds) {
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      ctx.host.fs.writeText(path, JSON.stringify({
        accessToken: accessToken,
        expiresAtMs: Date.now() + (expiresInSeconds || 3600) * 1000,
      }))
    } catch (e) {
      ctx.host.log.warn("failed to cache refreshed token: " + String(e))
    }
  }

  // --- agy keychain token ---

  function trimString(value) {
    return typeof value === "string" ? value.trim() : ""
  }

  function decodeBase64(ctx, text) {
    try {
      return ctx.base64.decode(text)
    } catch (e) {
      return null
    }
  }

  function unwrapAgyKeychainText(ctx, raw) {
    var text = trimString(raw)
    if (!text) return null
    if (text.indexOf("go-keyring-base64:") === 0) {
      text = trimString(decodeBase64(ctx, text.slice("go-keyring-base64:".length)))
    }
    return text || null
  }

  function extractTokenFromObject(obj) {
    if (!obj || typeof obj !== "object") return null

    var directKeys = [
      "access_token",
      "accessToken",
      "token",
      "bearerToken",
      "auth_token",
      "authToken",
    ]
    for (var i = 0; i < directKeys.length; i++) {
      var value = obj[directKeys[i]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j++) {
      var nested = extractTokenFromObject(obj[nestedKeys[j]])
      if (nested) return nested
    }

    return null
  }

  function extractAgyAccessToken(ctx, raw) {
    var text = unwrapAgyKeychainText(ctx, raw)
    if (!text) return null

    var parsed = ctx.util.tryParseJson(text)
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim()
    if (parsed) return extractTokenFromObject(parsed)

    if (text.indexOf("Bearer ") === 0) return text.slice("Bearer ".length).trim() || null
    return text
  }

  function loadAgyKeychainToken(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      var raw = ctx.host.keychain.readGenericPassword(AGY_KEYCHAIN_SERVICE, AGY_KEYCHAIN_ACCOUNT)
      return extractAgyAccessToken(ctx, raw)
    } catch (e) {
      ctx.host.log.info("agy keychain read failed: " + String(e))
      return null
    }
  }

  // --- LS discovery ---

  function discoverLs(ctx) {
    var result = ctx.host.ls.discover({
      processName: "language_server",
      markers: ["antigravity", "antigravity-ide"],
      csrfFlag: "--csrf_token",
      portFlag: "--extension_server_port",
    })
    if (result) return result
    return ctx.host.ls.discover({
      processName: "language_server",
      markers: ["antigravity", "antigravity-ide"],
      csrfFlag: "--csrf_token",
      portFlag: null,
    })
  }

  function discoverAgyLs(ctx) {
    return ctx.host.ls.discover({
      processName: "agy",
      markers: [],
      csrfFlag: "",
      portFlag: null,
    })
  }

  function probePort(ctx, scheme, port, csrf) {
    ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/GetUnleashData",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify({
        context: {
          properties: {
            devMode: "false",
            extensionVersion: "unknown",
            ide: "antigravity",
            ideVersion: "unknown",
            os: "macos",
          },
        },
      }),
      timeoutMs: 5000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    // Any HTTP response means this port is alive (even 400 validation errors).
    return true
  }

  function findWorkingPort(ctx, discovery) {
    var ports = discovery.ports || []
    for (var i = 0; i < ports.length; i++) {
      var port = ports[i]
      // Try HTTPS first (LS may use self-signed cert), then HTTP
      try { if (probePort(ctx, "https", port, discovery.csrf)) return { port: port, scheme: "https" } } catch (e) { /* ignore */ }
      try { if (probePort(ctx, "http", port, discovery.csrf)) return { port: port, scheme: "http" } } catch (e) { /* ignore */ }
      ctx.host.log.info("port " + port + " probe failed on both schemes")
    }
    if (discovery.extensionPort) return { port: discovery.extensionPort, scheme: "http" }
    return null
  }

  function callLs(ctx, port, scheme, csrf, method, body) {
    var resp = ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/" + method,
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify(body || {}),
      timeoutMs: 10000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("callLs " + method + " returned " + resp.status)
      return null
    }
    return ctx.util.tryParseJson(resp.bodyText)
  }

  // --- Line builders ---

  var SESSION_LABEL = "Session"
  var CLAUDE_LABEL = "Claude"
  var QUOTA_PERIOD_MS = 5 * 60 * 60 * 1000 // 5 hours
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000

  function normalizeLabel(label) {
    // "Gemini 3 Pro (High)" -> "Gemini 3 Pro"
    return label.replace(/\s*\([^)]*\)\s*$/, "").trim()
  }

  function poolLabel(normalizedLabel) {
    // Gemini Pro and Flash share one pool; Claude, GPT-OSS and any other model share the other.
    return normalizedLabel.toLowerCase().indexOf("gemini") !== -1 ? SESSION_LABEL : CLAUDE_LABEL
  }

  // Legacy per-model quota does not say which pool or period Argon draws from.
  function isArgonModel(label, modelId) {
    var values = [label, modelId || ""]
    for (var i = 0; i < values.length; i++) {
      if (values[i] === "MODEL_PLACEHOLDER_M421") return true
      var normalized = String(values[i]).toLowerCase().replace(/ /g, "-")
      if (normalized === "gemini-4-argon" || normalized.indexOf("gemini-4-argon-") === 0) return true
    }
    return false
  }

  function modelLine(ctx, label, remainingFraction, resetTime, periodMs) {
    var clamped = Math.max(0, Math.min(1, remainingFraction))
    var used = Math.round((1 - clamped) * 100)
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetTime || undefined,
      periodDurationMs: periodMs || QUOTA_PERIOD_MS,
    })
  }

  function buildModelLines(ctx, configs) {
    var deduped = {}
    for (var i = 0; i < configs.length; i++) {
      var c = configs[i]
      var label = (typeof c.label === "string") ? c.label.trim() : ""
      if (!label) continue
      var modelId = (c.modelOrAlias && c.modelOrAlias.model) || c.modelId
      if (isArgonModel(label, modelId)) {
        ctx.host.log.warn("skipping legacy Argon quota: its pool and period are unknown")
        continue
      }
      var qi = c.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      var pool = poolLabel(normalizeLabel(label))
      if (!deduped[pool] || frac < deduped[pool].remainingFraction) {
        deduped[pool] = { remainingFraction: frac, resetTime: rtime }
      }
    }

    var lines = []
    var order = [SESSION_LABEL, CLAUDE_LABEL]
    for (var j = 0; j < order.length; j++) {
      var m = deduped[order[j]]
      if (m) lines.push(modelLine(ctx, order[j], m.remainingFraction, m.resetTime))
    }
    return lines
  }

  // --- Quota summary (RetrieveUserQuotaSummary) ---

  // Shared-pool buckets match exact ids only, so a new bucket never joins a pool by accident.
  var SUMMARY_BUCKETS = [
    { id: "gemini-5h", label: SESSION_LABEL, periodMs: QUOTA_PERIOD_MS },
    { id: "gemini-weekly", label: "Weekly", periodMs: WEEK_MS },
    { id: "3p-5h", label: CLAUDE_LABEL, periodMs: QUOTA_PERIOD_MS },
    { id: "3p-weekly", label: "Claude Weekly", periodMs: WEEK_MS },
  ]
  var ARGON_GROUP_NAME = "Gemini 4 Argon"
  var ARGON_WEEKLY_LABEL = "Argon Weekly"

  function summaryBucketSpec(id) {
    for (var i = 0; i < SUMMARY_BUCKETS.length; i++) {
      if (SUMMARY_BUCKETS[i].id === id) return SUMMARY_BUCKETS[i]
    }
    return null
  }

  function usableFraction(bucket) {
    var f = bucket && bucket.remainingFraction
    return typeof f === "number" && Number.isFinite(f) ? f : null
  }

  // Cloud Code returns { groups }; the local server wraps it as { response: { groups } }.
  function summaryGroups(body) {
    if (!body || typeof body !== "object") return null
    if (body.response && Array.isArray(body.response.groups)) return body.response.groups
    if (Array.isArray(body.groups)) return body.groups
    return null
  }

  function groupBuckets(group) {
    if (!group || typeof group !== "object" || !Array.isArray(group.buckets)) return []
    return group.buckets.filter(function (b) { return b && typeof b === "object" })
  }

  // One unambiguous, enabled weekly bucket with its own id, or nothing.
  function argonWeekly(ctx, groups) {
    var buckets = []
    for (var i = 0; i < groups.length; i++) {
      if (groups[i] && groups[i].displayName === ARGON_GROUP_NAME) buckets = buckets.concat(groupBuckets(groups[i]))
    }
    if (buckets.length === 0) return null
    var weekly = buckets.filter(function (b) { return b.window === "weekly" })
    var bucket = weekly[0]
    if (weekly.length !== 1 || typeof bucket.bucketId !== "string" || !bucket.bucketId || summaryBucketSpec(bucket.bucketId)) {
      ctx.host.log.warn("Argon quota group has no unambiguous separate weekly bucket")
      return null
    }
    if (bucket.disabled === true) return null
    if (bucket.disabled !== undefined && bucket.disabled !== null && typeof bucket.disabled !== "boolean") return null
    var fraction = usableFraction(bucket)
    if (fraction === null) {
      ctx.host.log.warn("Argon weekly quota has no usable remainingFraction")
      return null
    }
    return { fraction: fraction, resetTime: bucket.resetTime }
  }

  function keepLower(current, next) {
    return !current || next.fraction < current.fraction ? next : current
  }

  // Null when no body is a summary, so the caller may use per-model quota. Otherwise authoritative,
  // even with no lines: per-model quota reads missing quota as fully used.
  // The two Cloud Code hosts can disagree on one bucket; the lower remaining fraction applies first.
  function parseQuotaSummaries(ctx, bodies) {
    var lists = []
    for (var i = 0; i < bodies.length; i++) {
      var groups = summaryGroups(bodies[i])
      if (groups) lists.push(groups)
      else ctx.host.log.warn("quota summary response has no groups")
    }
    if (lists.length === 0) return null

    var pooled = {}
    var argon = null
    for (var l = 0; l < lists.length; l++) {
      for (var g = 0; g < lists[l].length; g++) {
        var group = lists[l][g]
        if (!group || group.displayName === ARGON_GROUP_NAME) continue
        var buckets = groupBuckets(group)
        for (var b = 0; b < buckets.length; b++) {
          var spec = summaryBucketSpec(buckets[b].bucketId)
          if (!spec) {
            ctx.host.log.warn("quota summary: skipping unknown bucket " + String(buckets[b].bucketId))
            continue
          }
          var fraction = usableFraction(buckets[b])
          if (fraction === null) continue
          pooled[spec.id] = keepLower(pooled[spec.id], { fraction: fraction, resetTime: buckets[b].resetTime })
        }
      }
      var hostArgon = argonWeekly(ctx, lists[l])
      if (hostArgon) argon = keepLower(argon, hostArgon)
    }

    var lines = []
    for (var s = 0; s < SUMMARY_BUCKETS.length; s++) {
      var item = SUMMARY_BUCKETS[s]
      if (item.label === CLAUDE_LABEL && argon) {
        lines.push(modelLine(ctx, ARGON_WEEKLY_LABEL, argon.fraction, argon.resetTime, WEEK_MS))
        argon = null
      }
      var entry = pooled[item.id]
      if (entry) lines.push(modelLine(ctx, item.label, entry.fraction, entry.resetTime, item.periodMs))
    }
    if (argon) lines.push(modelLine(ctx, ARGON_WEEKLY_LABEL, argon.fraction, argon.resetTime, WEEK_MS))
    return lines
  }

  // --- Cloud Code API ---

  // One host: parsed JSON, { _authFailed: true }, or null for any other failure.
  function requestCloudCodeHost(ctx, base, path, token, userAgent, body) {
    try {
      var resp = ctx.host.http.request({
        method: "POST",
        url: base + path,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "User-Agent": userAgent || "antigravity",
        },
        bodyText: JSON.stringify(body || {}),
        timeoutMs: 15000,
      })
      if (!resp || typeof resp.status !== "number" || !Number.isFinite(resp.status)) {
        ctx.host.log.warn("Cloud Code returned invalid response shape (" + base + ")")
        return null
      }
      if (ctx.util.isAuthStatus(resp.status)) return { _authFailed: true }
      if (resp.status >= 200 && resp.status < 300) {
        var json = ctx.util.tryParseJson(resp.bodyText)
        if (!json || typeof json !== "object") {
          ctx.host.log.warn("Cloud Code returned invalid JSON (" + base + ")")
          return null
        }
        return json
      }
    } catch (e) {
      ctx.host.log.warn("Cloud Code request failed (" + base + "): " + String(e))
    }
    return null
  }

  function requestCloudCodeJson(ctx, path, token, userAgent, body) {
    for (var i = 0; i < CLOUD_CODE_URLS.length; i++) {
      var json = requestCloudCodeHost(ctx, CLOUD_CODE_URLS[i], path, token, userAgent, body)
      if (json) return json
    }
    return null
  }

  // Every host: the hosts can disagree, so callers merge their answers.
  function requestCloudCodeAllHosts(ctx, path, token, userAgent, body) {
    var bodies = []
    var authFailed = false
    for (var i = 0; i < CLOUD_CODE_URLS.length; i++) {
      var json = requestCloudCodeHost(ctx, CLOUD_CODE_URLS[i], path, token, userAgent, body)
      if (json && json._authFailed) authFailed = true
      else if (json) bodies.push(json)
    }
    return { bodies: bodies, authFailed: authFailed }
  }

  function probeCloudCode(ctx, token, userAgent) {
    return requestCloudCodeJson(ctx, FETCH_MODELS_PATH, token, userAgent, {})
  }

  function parseCloudCodeModels(data) {
    var modelsObj = data && data.models
    if (!modelsObj || typeof modelsObj !== "object") return []
    var keys = Object.keys(modelsObj)
    var configs = []
    for (var i = 0; i < keys.length; i++) {
      var m = modelsObj[keys[i]]
      if (!m || typeof m !== "object") continue
      if (m.isInternal) continue
      var modelId = m.model || keys[i]
      if (CC_MODEL_BLACKLIST[modelId]) continue
      var displayName =
        (typeof m.displayName === "string" && m.displayName.trim()) ||
        (typeof m.label === "string" && m.label.trim()) ||
        ""
      if (!displayName) continue
      var qi = m.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      configs.push({
        label: displayName,
        modelId: modelId,
        quotaInfo: { remainingFraction: frac, resetTime: rtime },
      })
    }
    return configs
  }

  function readAgyPlan(loadData) {
    var paidTier = loadData && loadData.paidTier
    if (paidTier && typeof paidTier.name === "string" && paidTier.name.trim()) {
      return paidTier.name.trim()
    }
    var currentTier = loadData && loadData.currentTier
    if (currentTier && typeof currentTier.name === "string" && currentTier.name.trim()) {
      return currentTier.name.trim()
    }
    // Fallback for live API response shape: allowedTiers array (no paidTier/currentTier)
    var allowedTiers = loadData && loadData.allowedTiers
    if (Array.isArray(allowedTiers) && allowedTiers.length > 0) {
      var firstTier = allowedTiers[0]
      if (firstTier && typeof firstTier.name === "string" && firstTier.name.trim()) {
        return firstTier.name.trim()
      }
    }
    return null
  }

  function parseAgyQuotaBuckets(data) {
    var buckets = data && data.buckets
    if (!Array.isArray(buckets)) return []
    var configs = []
    for (var i = 0; i < buckets.length; i++) {
      var bucket = buckets[i]
      if (!bucket || typeof bucket !== "object") continue
      var modelId = (typeof bucket.modelId === "string" && bucket.modelId.trim()) || ""
      if (!modelId) continue
      var frac = (typeof bucket.remainingFraction === "number") ? bucket.remainingFraction : 0
      configs.push({
        label: modelId,
        modelId: modelId,
        quotaInfo: { remainingFraction: frac, resetTime: bucket.resetTime || undefined },
      })
    }
    return configs
  }

  function projectOf(loadData) {
    var project = loadData && loadData.cloudaicompanionProject
    return typeof project === "string" && project.trim() ? project.trim() : null
  }

  // { load, lines } when a summary parsed, { load } when no host returned one, { _authFailed } when
  // loadCodeAssist rejected the token. A rejected summary alone leaves the per-model calls to decide.
  function probeQuotaSummary(ctx, token) {
    var loadData = requestCloudCodeJson(ctx, LOAD_CODE_ASSIST_PATH, token, CLIENT_USER_AGENT, LOAD_CODE_ASSIST_BODY)
    if (loadData && loadData._authFailed) return loadData
    var project = projectOf(loadData)
    var all = requestCloudCodeAllHosts(ctx, QUOTA_SUMMARY_PATH, token, CLIENT_USER_AGENT, project ? { project: project } : {})
    var lines = parseQuotaSummaries(ctx, all.bodies)
    if (lines) return { load: loadData, lines: lines }
    return { load: loadData }
  }

  // Summary first, then fetchAvailableModels. Null for a transient failure; { _noLines } when the
  // per-model reply parsed but gave no lines, which ends the probe like before.
  function probeCloudCodeToken(ctx, token) {
    var summary = probeQuotaSummary(ctx, token)
    if (summary._authFailed) return summary
    var plan = readAgyPlan(summary.load)
    if (summary.lines) return { plan: plan, lines: summary.lines }

    var data = probeCloudCode(ctx, token)
    if (!data || data._authFailed) return data
    var lines = buildModelLines(ctx, parseCloudCodeModels(data))
    if (lines.length === 0) return { _noLines: true }
    return { plan: plan, lines: lines }
  }

  function probeAgyCloudCode(ctx, token) {
    var summary = probeQuotaSummary(ctx, token)
    if (summary._authFailed) return summary
    if (summary.lines) return { plan: readAgyPlan(summary.load), lines: summary.lines }

    var loadData = summary.load
    if (!loadData) return null
    var project = projectOf(loadData)
    var quotaData = null
    if (project) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", { project: project })
    }
    if (!quotaData || quotaData._authFailed) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", {})
    }
    if (!quotaData || quotaData._authFailed) return quotaData

    var lines = buildModelLines(ctx, parseAgyQuotaBuckets(quotaData))
    if (lines.length === 0) return null
    return { plan: readAgyPlan(loadData), lines: lines }
  }

  // --- LS probe ---

  function probeDiscovery(ctx, discovery) {
    if (!discovery) return null

    var found = findWorkingPort(ctx, discovery)
    if (!found) return null

    ctx.host.log.info("using LS at " + found.scheme + "://127.0.0.1:" + found.port)

    var metadata = {
      ideName: "antigravity",
      extensionName: "antigravity",
      ideVersion: "unknown",
      locale: "en",
    }

    // Try GetUserStatus first, fall back to GetCommandModelConfigs
    var data = null
    try {
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetUserStatus", { metadata: metadata })
    } catch (e) {
      ctx.host.log.warn("GetUserStatus threw: " + String(e))
    }
    var hasUserStatus = data && data.userStatus
    var plan = hasUserStatus ? userStatusPlan(data.userStatus) : null

    // A summary, even one with no lines, does not need the per-model calls.
    var summaryLines = null
    try {
      summaryLines = parseQuotaSummaries(ctx, [callLs(ctx, found.port, found.scheme, discovery.csrf, "RetrieveUserQuotaSummary", { metadata: metadata })])
    } catch (e) {
      ctx.host.log.warn("RetrieveUserQuotaSummary threw: " + String(e))
    }
    if (summaryLines) return { plan: plan, lines: summaryLines }

    if (!hasUserStatus) {
      ctx.host.log.warn("GetUserStatus failed, trying GetCommandModelConfigs")
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetCommandModelConfigs", { metadata: metadata })
    }

    // Parse model configs
    var configs
    if (hasUserStatus) {
      configs = (data.userStatus.cascadeModelConfigData || {}).clientModelConfigs || []
    } else if (data && data.clientModelConfigs) {
      configs = data.clientModelConfigs
    } else {
      return null
    }

    var filtered = []
    for (var j = 0; j < configs.length; j++) {
      var mid = configs[j].modelOrAlias && configs[j].modelOrAlias.model
      if (mid && CC_MODEL_BLACKLIST[mid]) continue
      filtered.push(configs[j])
    }

    var lines = buildModelLines(ctx, filtered)
    if (lines.length === 0) return null
    return { plan: plan, lines: lines }
  }

  // Prefer userTier.name (Google's own subscription system) over the legacy
  // planInfo.planName field inherited from Windsurf/Codeium, which always
  // returns "Pro" for all paid tiers including Google AI Ultra.
  function userStatusPlan(userStatus) {
    var ut = userStatus.userTier
    if (ut && typeof ut.name === "string" && ut.name.trim()) return ut.name.trim()
    var pi = (userStatus.planStatus || {}).planInfo || {}
    return typeof pi.planName === "string" && pi.planName.trim() ? pi.planName.trim() : null
  }

  function probeLs(ctx) {
    return probeDiscovery(ctx, discoverLs(ctx))
  }

  function probeAgyLs(ctx) {
    return probeDiscovery(ctx, discoverAgyLs(ctx))
  }

  function emailFromIdToken(ctx, idToken) {
    if (!idToken || typeof idToken !== "string") return null
    var payload = ctx.jwt.decodePayload(idToken)
    if (!payload || typeof payload !== "object") return null
    var email =
      (typeof payload.email === "string" && payload.email.trim()) ||
      (typeof payload.email_address === "string" && payload.email_address.trim()) ||
      ""
    return email || null
  }

  function resolvePinnedCliAccountEmail(ctx) {
    if (readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CONFIG_DIR")) return null
    var pinnedCliHome = readEnvText(ctx, "OPENUSAGE_ANTIGRAVITY_CLI_HOME")
    var home = pinnedCliHome || readEnvText(ctx, "HOME")
    if (!home) return null
    var tokenPath = joinPath(home, ".gemini/antigravity-cli/antigravity-oauth-token")
    try {
      if (ctx.host.fs && typeof ctx.host.fs.exists === "function" && ctx.host.fs.exists(tokenPath)) {
        var parsed = ctx.util.tryParseJson(ctx.host.fs.readText(tokenPath))
        if (parsed && typeof parsed.id_token === "string") {
          return emailFromIdToken(ctx, parsed.id_token)
        }
      }
      return null
    } catch (e) {
      ctx.host.log.warn("failed to read antigravity account email: " + String(e))
      return null
    }
  }

  function attachAccountBadge(ctx, result) {
    if (!result || !Array.isArray(result.lines)) return result
    var email = resolvePinnedCliAccountEmail(ctx)
    if (!email) return result
    var lines = result.lines.slice()
    lines.unshift(ctx.line.badge({ label: "Account", text: email }))
    return { plan: result.plan, lines: lines }
  }

  // --- Probe ---

  function probe(ctx) {
    if (!hasPinnedAntigravityHome(ctx)) {
      var lsResult = probeLs(ctx)
      if (lsResult) return attachAccountBadge(ctx, lsResult)

      var agyLsResult = probeAgyLs(ctx)
      if (agyLsResult) return attachAccountBadge(ctx, agyLsResult)
    }

    var dbTokenCandidates = loadOAuthTokenCandidates(ctx)

    var tokens = []
    var nowSec = Math.floor(Date.now() / 1000)
    for (var i = 0; i < dbTokenCandidates.length; i++) {
      var dbTokens = dbTokenCandidates[i]
      if (dbTokens.accessToken && (!dbTokens.expirySeconds || dbTokens.expirySeconds > nowSec)) {
        if (tokens.indexOf(dbTokens.accessToken) === -1) tokens.push(dbTokens.accessToken)
      }
    }

    var cached = loadCachedToken(ctx)
    if (cached && tokens.indexOf(cached) === -1) tokens.push(cached)

    var result = null
    var sawAuthFailure = false
    for (var i = 0; i < tokens.length; i++) {
      var nextResult = probeCloudCodeToken(ctx, tokens[i])
      if (nextResult && !nextResult._authFailed) {
        result = nextResult
        break
      }
      if (nextResult && nextResult._authFailed) sawAuthFailure = true
    }
    if (result && result._noLines) throw LOGIN_MESSAGE

    // Only refresh on evidence of an auth failure, or when there were no tokens to try.
    // probeCloudCodeToken returns null for transient failures (5xx/timeouts); without this
    // guard a Cloud Code incident would trigger a Google OAuth refresh every probe cycle
    // instead of ~once per token lifetime — risking refresh-token throttling or rotation.
    if (!result && (sawAuthFailure || tokens.length === 0)) {
      var refreshTokens = []
      for (var j = 0; j < dbTokenCandidates.length; j++) {
        var refreshToken = dbTokenCandidates[j].refreshToken
        if (refreshToken && refreshTokens.indexOf(refreshToken) === -1) refreshTokens.push(refreshToken)
      }
      for (var k = 0; k < refreshTokens.length; k++) {
        var refreshed = refreshAccessToken(ctx, refreshTokens[k])
        if (!refreshed) continue
        var refreshedResult = probeCloudCodeToken(ctx, refreshed)
        if (refreshedResult && !refreshedResult._authFailed) {
          result = refreshedResult
          break
        }
      }
      if (result && result._noLines) throw LOGIN_MESSAGE
    }

    if (!result) {
      // Multi-account homes must not fall back to the global keychain (cross-account bleed).
      var agyToken = hasPinnedAntigravityHome(ctx) ? null : loadAgyKeychainToken(ctx)
      if (agyToken) {
        var agyResult = probeAgyCloudCode(ctx, agyToken)
        if (agyResult && !agyResult._authFailed) result = agyResult
      }
    }

    if (result) return attachAccountBadge(ctx, result)

    throw LOGIN_MESSAGE
  }

  globalThis.__openusage_plugin = { id: "antigravity", probe: probe }
})()
