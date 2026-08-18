(function () {
  const AUTH_PATH = "~/.grok/auth.json"
  const DEFAULT_LOG_PATH = "~/.grok/logs/unified.jsonl"
  const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
  const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
  const SPEND_DAYS_BACK = 30
  const LONG_CONTEXT_PROMPT_TOKENS = 200000
  const MODEL_RATES = {
    "grok-4.6": { input: 2, cached: 0.5, output: 6, longInput: 4, longCached: 1, longOutput: 12 },
    "grok-4.5": { input: 2, cached: 0.3, output: 6, longInput: 4, longCached: 0.6, longOutput: 12 },
    "grok-4.3": { input: 1.25, cached: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5 },
    "grok-4.20": { input: 1.25, cached: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5 },
    "grok-build-0.1": { input: 1, cached: 0.2, output: 2, longInput: 2, longCached: 0.4, longOutput: 4 },
    "grok-build": { input: 1, cached: 0.2, output: 2, longInput: 2, longCached: 0.4, longOutput: 4 },
  }
  const REFRESH_URL = "https://auth.x.ai/oauth2/token"
  const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
  const TOKEN_AUTH_HEADER = "xai-grok-cli"
  const AUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000
  const LOGIN_HINT = "Grok auth expired. Run `grok login` again."
  const WEEKLY_PERIOD_TYPE = "USAGE_PERIOD_TYPE_WEEKLY"

  function readJson(ctx, path) {
    if (!ctx.host.fs.exists(path)) return null
    try {
      return ctx.util.tryParseJson(ctx.host.fs.readText(path))
    } catch {
      return null
    }
  }

  function entryExpiresAtMs(ctx, entry) {
    if (!entry || typeof entry !== "object") return null
    if (entry.expires_at) return ctx.util.parseDateMs(entry.expires_at)
    if (entry.expires) return ctx.util.parseDateMs(entry.expires)
    return null
  }

  function tokenExpiresAtMs(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000
  }

  function needsRefresh(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const entryNeedsRefresh = entryMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: entryMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    const tokenNeedsRefresh = tokenMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: tokenMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    return entryNeedsRefresh || tokenNeedsRefresh
  }

  function isExpired(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const expiresAtMs = tokenMs !== null ? tokenMs : entryMs
    if (expiresAtMs === null) return false
    return nowMs >= expiresAtMs
  }

  function readRefreshToken(entry) {
    if (!entry || typeof entry !== "object") return ""
    const refreshToken = typeof entry.refresh_token === "string" ? entry.refresh_token.trim() : ""
    if (refreshToken) return refreshToken
    return typeof entry.refresh === "string" ? entry.refresh.trim() : ""
  }

  function readClientId(entryKey, entry) {
    if (entry && typeof entry.oidc_client_id === "string" && entry.oidc_client_id.trim()) {
      return entry.oidc_client_id.trim()
    }
    const parts = String(entryKey || "").split("::")
    const fromKey = parts.length > 1 ? parts[parts.length - 1].trim() : ""
    return fromKey || DEFAULT_CLIENT_ID
  }

  function nowMs(ctx) {
    return ctx.util.parseDateMs(ctx.nowIso) || Date.now()
  }

  function refreshAuth(ctx, auth, entryKey, entry) {
    const refreshToken = readRefreshToken(entry)
    if (!refreshToken) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting Grok auth refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "grant_type=refresh_token" +
          "&client_id=" + encodeURIComponent(readClientId(entryKey, entry)) +
          "&refresh_token=" + encodeURIComponent(refreshToken),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        const body = ctx.util.tryParseJson(resp.bodyText)
        const code = body && ((body.error && body.error.code) || body.error || body.code)
        ctx.host.log.error("Grok auth refresh failed: status=" + resp.status + " code=" + String(code))
        return null
      }
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Grok auth refresh returned status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
        ctx.host.log.warn("Grok auth refresh response missing access_token")
        return null
      }

      const accessToken = body.access_token.trim()
      entry.key = accessToken
      if (typeof body.refresh_token === "string" && body.refresh_token.trim()) {
        entry.refresh_token = body.refresh_token.trim()
      }
      if (typeof body.id_token === "string" && body.id_token.trim()) {
        entry.id_token = body.id_token.trim()
      }

      const refreshedAtMs = nowMs(ctx)
      const expiresIn = Number(body.expires_in)
      const tokenExpiryMs = tokenExpiresAtMs(ctx, accessToken)
      const expiresAtMs = Number.isFinite(expiresIn) && expiresIn > 0
        ? refreshedAtMs + expiresIn * 1000
        : tokenExpiryMs || refreshedAtMs + 3600 * 1000
      entry.expires_at = new Date(expiresAtMs).toISOString()

      try {
        ctx.host.fs.writeText(AUTH_PATH, JSON.stringify(auth, null, 2))
        ctx.host.log.info("Grok auth refresh succeeded, token persisted")
      } catch (e) {
        ctx.host.log.warn("Grok auth refresh succeeded but failed to save auth: " + String(e))
      }

      return accessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("Grok auth refresh exception: " + String(e))
      return null
    }
  }

  function loadAuth(ctx) {
    const auth = readJson(ctx, AUTH_PATH)
    if (!auth || typeof auth !== "object") {
      throw "Grok not logged in. Run `grok login`."
    }

    const currentMs = nowMs(ctx)
    let expiredCandidate = false
    const keys = Object.keys(auth)
    for (let i = 0; i < keys.length; i++) {
      const entryKey = keys[i]
      const entry = auth[entryKey]
      if (!entry || typeof entry !== "object") continue
      const token = typeof entry.key === "string" ? entry.key.trim() : ""
      if (!token) continue
      if (needsRefresh(ctx, entry, token, currentMs)) {
        const refreshed = refreshAuth(ctx, auth, entryKey, entry)
        if (refreshed) return { auth, entryKey, entry, token: refreshed }
        if (!isExpired(ctx, entry, token, currentMs)) {
          ctx.host.log.warn("Grok refresh failed, trying existing access token")
          return { auth, entryKey, entry, token }
        }
        expiredCandidate = true
        continue
      }
      return { auth, entryKey, entry, token }
    }

    if (expiredCandidate) {
      throw LOGIN_HINT
    }
    throw "Grok auth invalid. Run `grok login` again."
  }

  function failChanged(ctx, reason) {
    ctx.host.log.error("Grok billing response changed: " + reason)
    throw "Grok billing response changed."
  }

  function readFiniteNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function readOnDemandCap(ctx, config) {
    if (!("onDemandCap" in config)) return 0
    const cap = config.onDemandCap
    if (!cap || typeof cap !== "object") {
      failChanged(ctx, "invalid onDemandCap")
    }
    if (!("val" in cap)) return 0
    const n = readFiniteNumber(cap.val)
    if (n === null) {
      failChanged(ctx, "invalid onDemandCap")
    }
    return n
  }

  function clampPercent(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 100) return 100
    return n
  }

  function fetchBillingResponse(ctx, token) {
    try {
      return ctx.util.request({
        method: "GET",
        url: CREDITS_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
    } catch {
      throw "Grok billing request failed. Check your connection."
    }
  }

  function parseBilling(ctx, resp) {
    if (ctx.util.isAuthStatus(resp.status)) {
      throw LOGIN_HINT
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Grok billing request failed (HTTP " + String(resp.status) + "). Try again later."
    }

    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!data) {
      failChanged(ctx, "invalid JSON")
    }
    return data
  }

  function parseCreditsConfig(ctx, data) {
    if (!data || typeof data !== "object") {
      failChanged(ctx, "missing object")
    }

    const config = data.config
    if (!config || typeof config !== "object") {
      failChanged(ctx, "missing config")
    }

    const period = config.currentPeriod
    if (!period || typeof period !== "object") {
      failChanged(ctx, "missing currentPeriod")
    }

    const periodType = typeof period.type === "string" ? period.type.trim() : ""
    if (!periodType) {
      failChanged(ctx, "missing currentPeriod.type")
    }

    const startMs = ctx.util.parseDateMs(period.start)
    const endMs = ctx.util.parseDateMs(period.end)
    const resetsAt = ctx.util.toIso(period.end)
    if (startMs === null || endMs === null || !resetsAt || endMs <= startMs) {
      failChanged(ctx, "invalid currentPeriod dates")
    }

    let usedPercent
    if ("creditUsagePercent" in config) {
      usedPercent = readFiniteNumber(config.creditUsagePercent)
      if (usedPercent === null) {
        failChanged(ctx, "invalid creditUsagePercent")
      }
    } else {
      usedPercent = 0
    }

    const onDemandCapUnits = readOnDemandCap(ctx, config)

    return {
      periodType,
      usedPercent: clampPercent(usedPercent),
      resetsAt,
      periodDurationMs: Math.round(endMs - startMs),
      onDemandCapUnits,
    }
  }

  function readEnv(ctx, name) {
    if (!ctx.host.env || typeof ctx.host.env.get !== "function") return ""
    const value = ctx.host.env.get(name)
    return typeof value === "string" ? value.trim() : ""
  }

  function spendLogPath(ctx) {
    const home = readEnv(ctx, "GROK_HOME")
    if (home) return home.replace(/\/+$/, "") + "/logs/unified.jsonl"
    return DEFAULT_LOG_PATH
  }

  function dayKeyFromMs(ms) {
    const date = new Date(ms)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
  }

  function fmtTokens(n) {
    const abs = Math.abs(n)
    const sign = n < 0 ? "-" : ""
    const units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ]
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]
      if (abs >= unit.threshold) {
        const scaled = abs / unit.divisor
        const formatted = scaled >= 10
          ? Math.round(scaled).toString()
          : scaled.toFixed(1).replace(/\.0$/, "")
        return sign + formatted + unit.suffix
      }
    }
    return sign + Math.round(abs).toString()
  }

  function spendValue(tokens, cost) {
    return "$" + cost.toFixed(2) + " \u00b7 " + fmtTokens(tokens) + " tokens"
  }

  function resolveRates(model) {
    const name = String(model || "").trim().toLowerCase()
    if (!name) return null
    if (MODEL_RATES[name]) return MODEL_RATES[name]
    const keys = Object.keys(MODEL_RATES).sort((a, b) => b.length - a.length)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (name.startsWith(key + "-") || name.startsWith(key + ".")) return MODEL_RATES[key]
    }
    return null
  }

  function estimateCost(model, promptTokens, cacheRead, output) {
    const rates = resolveRates(model)
    if (!rates) return null
    const long = promptTokens >= LONG_CONTEXT_PROMPT_TOKENS
    const inputNoCache = Math.max(0, promptTokens - cacheRead)
    const inputRate = long ? rates.longInput : rates.input
    const cachedRate = long ? rates.longCached : rates.cached
    const outputRate = long ? rates.longOutput : rates.output
    return (inputNoCache * inputRate + cacheRead * cachedRate + output * outputRate) / 1e6
  }

  function modelID(msg, eventCtx) {
    let raw
    if (msg === "model changed") raw = eventCtx.model
    else if (msg === "model catalog: notifying clients") raw = eventCtx.current_model_id
    else if (msg === "backend_search: model switch") {
      raw = eventCtx.model || eventCtx.current_model_id || eventCtx.model_id
    } else if (msg === "subagent model resolved") raw = eventCtx.model_id || eventCtx.model
    else return null
    if (typeof raw !== "string") return null
    const model = raw.trim()
    return model || null
  }

  function parseSpendLog(ctx, text, nowMsValue) {
    const sinceMs = nowMsValue - SPEND_DAYS_BACK * 24 * 60 * 60 * 1000
    const modelByPid = {}
    const days = {}
    const rows = String(text).split(/\r?\n/)
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i]
      if (!line || (line.indexOf("inference_done") < 0 && line.indexOf("model") < 0)) continue
      const object = ctx.util.tryParseJson(line)
      if (!object || typeof object !== "object") continue
      const msg = typeof object.msg === "string" ? object.msg : ""
      const eventCtx = object.ctx && typeof object.ctx === "object" ? object.ctx : {}
      const pid = readFiniteNumber(object.pid)
      const model = modelID(msg, eventCtx)
      if (model) {
        if (pid !== null) modelByPid[String(Math.round(pid))] = model
        continue
      }
      if (msg !== "shell.turn.inference_done") continue
      const promptTokens = readFiniteNumber(eventCtx.prompt_tokens)
      if (promptTokens === null) continue
      const tsMs = ctx.util.parseDateMs(object.ts)
      if (tsMs === null || tsMs < sinceMs) continue
      const attributed = pid === null ? null : modelByPid[String(Math.round(pid))]
      if (!attributed) continue
      const completion = readFiniteNumber(eventCtx.completion_tokens)
      const reasoning = readFiniteNumber(eventCtx.reasoning_tokens)
      const cachedRaw = readFiniteNumber(eventCtx.cached_prompt_tokens)
      const cached = Math.min(cachedRaw === null ? 0 : cachedRaw, promptTokens)
      const output = (completion === null ? 0 : completion) + (reasoning === null ? 0 : reasoning)
      const cost = estimateCost(attributed, promptTokens, cached, output)
      if (cost === null) continue
      const day = dayKeyFromMs(tsMs)
      if (!days[day]) days[day] = { tokens: 0, cost: 0 }
      days[day].tokens += Math.round(promptTokens + output)
      days[day].cost += cost
    }
    return days
  }

  function pushSpendLine(lines, ctx, label, entry) {
    if (!entry || !(entry.tokens > 0 || entry.cost > 0)) return
    lines.push(ctx.line.text({
      label: label,
      value: spendValue(entry.tokens, entry.cost),
    }))
  }

  function appendLocalSpend(ctx, lines) {
    const path = spendLogPath(ctx)
    if (!ctx.host.fs.exists(path)) return
    let text
    try {
      text = ctx.host.fs.readText(path)
    } catch {
      ctx.host.log.warn("Grok CLI log unreadable: " + path)
      return
    }
    if (typeof text !== "string" || !text.trim()) return
    const currentMs = nowMs(ctx)
    const days = parseSpendLog(ctx, text, currentMs)
    const todayKey = dayKeyFromMs(currentMs)
    const yesterday = new Date(currentMs)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = dayKeyFromMs(yesterday.getTime())
    pushSpendLine(lines, ctx, "Today", days[todayKey])
    pushSpendLine(lines, ctx, "Yesterday", days[yesterdayKey])
    let totalTokens = 0
    let totalCost = 0
    const keys = Object.keys(days)
    for (let i = 0; i < keys.length; i++) {
      totalTokens += days[keys[i]].tokens
      totalCost += days[keys[i]].cost
    }
    if (totalTokens > 0 || totalCost > 0) {
      lines.push(ctx.line.text({
        label: "Last 30 Days",
        value: spendValue(totalTokens, totalCost),
      }))
    }
  }

  function fetchPlanName(ctx, token) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: SETTINGS_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) return null
      const data = ctx.util.tryParseJson(resp.bodyText)
      const plan = data && data.subscription_tier_display
      return typeof plan === "string" && plan.trim() ? plan.trim() : null
    } catch {
      return null
    }
  }

  function probe(ctx) {
    const auth = loadAuth(ctx)
    const billingResp = ctx.util.retryOnceOnAuth({
      request: (token) => fetchBillingResponse(ctx, token || auth.token),
      refresh: () => {
        const refreshed = refreshAuth(ctx, auth.auth, auth.entryKey, auth.entry)
        if (refreshed) auth.token = refreshed
        return refreshed
      },
    })
    const credits = parseCreditsConfig(ctx, parseBilling(ctx, billingResp))
    const lines = []
    if (credits.periodType === WEEKLY_PERIOD_TYPE) {
      lines.push(ctx.line.progress({
        label: "Weekly",
        used: credits.usedPercent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: credits.resetsAt,
        periodDurationMs: credits.periodDurationMs,
      }))
    }
    lines.push(ctx.line.badge({
      label: "Pay as you go",
      text: credits.onDemandCapUnits > 0 ? String(credits.onDemandCapUnits) + " cap" : "Disabled",
      color: credits.onDemandCapUnits > 0 ? "#22c55e" : "#a3a3a3",
    }))
    appendLocalSpend(ctx, lines)

    return { plan: fetchPlanName(ctx, auth.token), lines }
  }

  globalThis.__openusage_plugin = { id: "grok", probe }
})()
