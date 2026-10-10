(function () {
  const AUTH_PATH = "~/.grok/auth.json"
  const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
  const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
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

    return { plan: fetchPlanName(ctx, auth.token), lines }
  }

  globalThis.__openusage_plugin = { id: "grok", probe }
})()
