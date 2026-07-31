(function () {
  const STATE_DBS = [
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    "~/.config/Cursor/User/globalStorage/state.vscdb",
  ]
  const KEYCHAIN_ACCESS_TOKEN_SERVICE = "cursor-access-token"
  const KEYCHAIN_REFRESH_TOKEN_SERVICE = "cursor-refresh-token"
  const BASE_URL = "https://api2.cursor.sh"
  const USAGE_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
  const PLAN_URL = BASE_URL + "/aiserver.v1.DashboardService/GetPlanInfo"
  const REFRESH_URL = BASE_URL + "/oauth/token"
  const CREDITS_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCreditGrantsBalance"
  const REST_USAGE_URL = "https://cursor.com/api/usage"
  const STRIPE_URL = "https://cursor.com/api/auth/stripe"
  const EVENTS_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events"
  const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
  const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiration
  const LOGIN_HINT = "Sign in via Cursor app or run `agent login`."
  const EVENTS_PAGE_SIZE = 200
  const EVENTS_MAX_PAGES = 10
  const MODEL_BREAKDOWN_LIMIT = 5
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

  function readStateValueFrom(ctx, dbPath, key) {
    try {
      const sql =
        "SELECT value FROM ItemTable WHERE key = '" + key + "' LIMIT 1;"
      const json = ctx.host.sqlite.query(dbPath, sql)
      const rows = ctx.util.tryParseJson(json)
      if (!Array.isArray(rows)) {
        throw new Error("sqlite returned invalid json")
      }
      if (rows.length > 0 && rows[0].value) {
        return rows[0].value
      }
    } catch (e) {
      ctx.host.log.warn("sqlite read failed for " + key + " from " + dbPath + ": " + String(e))
    }
    return null
  }

  function writeStateValue(ctx, dbPath, key, value) {
    try {
      // Escape single quotes in value for SQL
      const escaped = String(value).replace(/'/g, "''")
      const sql =
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('" +
        key +
        "', '" +
        escaped +
        "');"
      ctx.host.sqlite.exec(dbPath, sql)
      return true
    } catch (e) {
      ctx.host.log.warn("sqlite write failed for " + key + " to " + dbPath + ": " + String(e))
      return false
    }
  }

  function readEnvText(ctx, name) {
    if (!ctx.host.env || typeof ctx.host.env.get !== "function") return null
    try {
      const value = ctx.host.env.get(name)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.warn(name + " read failed: " + String(e))
      return null
    }
  }

  function joinPath(base, relativePath) {
    const root = String(base || "").replace(/\/+$/, "")
    const rel = String(relativePath || "").replace(/^\/+/, "")
    if (!root) return rel
    if (!rel) return root
    return root + "/" + rel
  }

  function stateDbCandidates(ctx) {
    const explicitDb = readEnvText(ctx, "OPENUSAGE_CURSOR_STATE_DB")
    if (explicitDb) return [explicitDb]
    const configDir = readEnvText(ctx, "OPENUSAGE_CURSOR_CONFIG_DIR")
    if (configDir) return [joinPath(configDir, "User/globalStorage/state.vscdb")]
    return STATE_DBS.slice()
  }

  function hasPinnedCursorHome(ctx) {
    return !!(
      readEnvText(ctx, "OPENUSAGE_CURSOR_CONFIG_DIR") ||
      readEnvText(ctx, "OPENUSAGE_CURSOR_STATE_DB")
    )
  }

  function resolveSqliteDb(ctx) {
    const candidates = stateDbCandidates(ctx)
    for (let i = 0; i < candidates.length; i++) {
      const dbPath = candidates[i]
      const accessToken = readStateValueFrom(ctx, dbPath, "cursorAuth/accessToken")
      const refreshToken = readStateValueFrom(ctx, dbPath, "cursorAuth/refreshToken")
      if (accessToken || refreshToken) {
        return {
          dbPath: dbPath,
          accessToken: accessToken,
          refreshToken: refreshToken,
        }
      }
    }
    return null
  }

  function readKeychainValue(ctx, service) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      const value = ctx.host.keychain.readGenericPassword(service)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.info("keychain read failed for " + service + ": " + String(e))
      return null
    }
  }

  function writeKeychainValue(ctx, service, value) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.writeGenericPassword !== "function") {
      ctx.host.log.warn("keychain write unsupported")
      return false
    }
    try {
      ctx.host.keychain.writeGenericPassword(service, String(value))
      return true
    } catch (e) {
      ctx.host.log.warn("keychain write failed for " + service + ": " + String(e))
      return false
    }
  }

  function loadAuthState(ctx) {
    const pinnedHome = hasPinnedCursorHome(ctx)
    const sqliteAuth = resolveSqliteDb(ctx)
    const sqliteAccessToken = sqliteAuth ? sqliteAuth.accessToken : null
    const sqliteRefreshToken = sqliteAuth ? sqliteAuth.refreshToken : null
    const sqliteDbPath = sqliteAuth ? sqliteAuth.dbPath : null
    const sqliteMembershipTypeRaw = sqliteDbPath
      ? readStateValueFrom(ctx, sqliteDbPath, "cursorAuth/stripeMembershipType")
      : null
    const sqliteMembershipType = typeof sqliteMembershipTypeRaw === "string"
      ? sqliteMembershipTypeRaw.trim().toLowerCase()
      : null

    // Multi-account homes must not fall back to the global keychain (cross-account bleed).
    const keychainAccessToken = pinnedHome
      ? null
      : readKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE)
    const keychainRefreshToken = pinnedHome
      ? null
      : readKeychainValue(ctx, KEYCHAIN_REFRESH_TOKEN_SERVICE)

    const sqliteSubject = getTokenSubject(ctx, sqliteAccessToken)
    const keychainSubject = getTokenSubject(ctx, keychainAccessToken)
    const hasDifferentSubjects = !!sqliteSubject && !!keychainSubject && sqliteSubject !== keychainSubject
    const sqliteLooksFree = sqliteMembershipType === "free"

    if (sqliteAccessToken || sqliteRefreshToken) {
      if ((keychainAccessToken || keychainRefreshToken) && sqliteLooksFree && hasDifferentSubjects) {
        ctx.host.log.info("sqlite auth looks free and differs from keychain account; preferring keychain token")
        return {
          accessToken: keychainAccessToken,
          refreshToken: keychainRefreshToken,
          source: "keychain",
          sqliteDbPath: null,
        }
      }

      return {
        accessToken: sqliteAccessToken,
        refreshToken: sqliteRefreshToken,
        source: "sqlite",
        sqliteDbPath: sqliteDbPath,
      }
    }

    if (keychainAccessToken || keychainRefreshToken) {
      return {
        accessToken: keychainAccessToken,
        refreshToken: keychainRefreshToken,
        source: "keychain",
        sqliteDbPath: null,
      }
    }

    return {
      accessToken: null,
      refreshToken: null,
      source: null,
      sqliteDbPath: null,
    }
  }

  function getTokenSubject(ctx, token) {
    if (!token) return null
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.sub !== "string") return null
    const subject = payload.sub.trim()
    return subject || null
  }

  function persistAccessToken(ctx, source, accessToken, sqliteDbPath) {
    if (source === "keychain") {
      return writeKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE, accessToken)
    }
    if (!sqliteDbPath) {
      ctx.host.log.warn("sqlite persist skipped: no source database path")
      return false
    }
    return writeStateValue(ctx, sqliteDbPath, "cursorAuth/accessToken", accessToken)
  }

  function getTokenExpiration(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000 // Convert to milliseconds
  }

  function needsRefresh(ctx, accessToken, nowMs) {
    if (!accessToken) return true
    const expiresAt = getTokenExpiration(ctx, accessToken)
    return ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: expiresAt,
      bufferMs: REFRESH_BUFFER_MS,
    })
  }

  function refreshToken(ctx, refreshTokenValue, source, sqliteDbPath) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting token refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/json" },
        bodyText: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshTokenValue,
        }),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401) {
        let errorInfo = null
        errorInfo = ctx.util.tryParseJson(resp.bodyText)
        const shouldLogout = errorInfo && errorInfo.shouldLogout === true
        ctx.host.log.error("refresh failed: status=" + resp.status + " shouldLogout=" + shouldLogout)
        if (shouldLogout) {
          throw "Session expired. " + LOGIN_HINT
        }
        throw "Token expired. " + LOGIN_HINT
      }

      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("refresh returned unexpected status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body) {
        ctx.host.log.warn("refresh response not valid JSON")
        return null
      }

      // Check if server wants us to logout
      if (body.shouldLogout === true) {
        ctx.host.log.error("refresh response indicates shouldLogout=true")
        throw "Session expired. " + LOGIN_HINT
      }

      const newAccessToken = body.access_token
      if (!newAccessToken) {
        ctx.host.log.warn("refresh response missing access_token")
        return null
      }

      // Persist updated access token to source where auth was loaded from.
      persistAccessToken(ctx, source, newAccessToken, sqliteDbPath)
      ctx.host.log.info("refresh succeeded, token persisted")

      // Note: Cursor refresh returns access_token which is used as both
      // access and refresh token in some flows
      return newAccessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("refresh exception: " + String(e))
      return null
    }
  }

  function connectPost(ctx, url, token) {
    return ctx.util.request({
      method: "POST",
      url: url,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      bodyText: "{}",
      timeoutMs: 10000,
    })
  }

  function buildSessionToken(ctx, accessToken) {
    var payload = ctx.jwt.decodePayload(accessToken)
    if (!payload || !payload.sub) return null
    var parts = String(payload.sub).split("|")
    var userId = parts.length > 1 ? parts[1] : parts[0]
    if (!userId) return null
    return { userId: userId, sessionToken: userId + "%3A%3A" + accessToken }
  }

  function fetchRequestBasedUsage(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("request-based: cannot build session token")
      return null
    }
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: REST_USAGE_URL + "?user=" + encodeURIComponent(session.userId),
        headers: {
          Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("request-based usage returned status=" + resp.status)
        return null
      }
      return ctx.util.tryParseJson(resp.bodyText)
    } catch (e) {
      ctx.host.log.warn("request-based usage fetch failed: " + String(e))
      return null
    }
  }

  function fetchStripeBalance(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("stripe: cannot build session token")
      return null
    }
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: STRIPE_URL,
        headers: {
          Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("stripe balance returned status=" + resp.status)
        return null
      }
      var stripe = ctx.util.tryParseJson(resp.bodyText)
      if (!stripe) return null
      var customerBalanceCents = Number(stripe.customerBalance)
      if (!Number.isFinite(customerBalanceCents)) return null
      // Stripe stores customer credits as a negative balance.
      return customerBalanceCents < 0 ? Math.abs(customerBalanceCents) : 0
    } catch (e) {
      ctx.host.log.warn("stripe balance fetch failed: " + String(e))
      return null
    }
  }

  function finiteNumber(value) {
    if (value == null || value === "") return null
    var n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function eventCostCents(event) {
    if (!event || typeof event !== "object") return 0
    var charged = finiteNumber(event.chargedCents)
    var totalCents = null
    if (event.tokenUsage && typeof event.tokenUsage === "object") {
      totalCents = finiteNumber(event.tokenUsage.totalCents)
    }
    // Prefer a positive charged amount; if charged is missing/zero but totalCents
    // is positive, use totalCents (Cursor sometimes reports free chargedCents).
    if (charged != null && charged > 0) return charged
    if (totalCents != null && totalCents > 0) return totalCents
    if (charged != null) return charged
    if (totalCents != null) return totalCents
    if (typeof event.usageBasedCosts === "string") {
      var parsed = Number(String(event.usageBasedCosts).replace(/[^0-9.-]/g, ""))
      if (Number.isFinite(parsed)) return parsed * 100
    }
    return 0
  }

  function eventTokens(event) {
    if (!event || typeof event !== "object" || !event.tokenUsage || typeof event.tokenUsage !== "object") {
      return 0
    }
    var tu = event.tokenUsage
    var totalTokens = finiteNumber(tu.totalTokens)
    if (totalTokens != null && totalTokens >= 0) {
      return totalTokens
    }
    var sum = 0
    var keys = ["inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens"]
    for (var i = 0; i < keys.length; i++) {
      var value = finiteNumber(tu[keys[i]])
      if (value != null && value > 0) sum += value
    }
    return sum
  }

  function formatUsdFromCents(cents) {
    var dollars = (Number.isFinite(cents) ? cents : 0) / 100
    return "$" + dollars.toFixed(2)
  }

  function formatTokenCount(tokens) {
    var n = Number(tokens) || 0
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B"
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K"
    return String(Math.round(n))
  }

  function shortenModelLabel(model) {
    var name = String(model || "unknown")
    if (name.length <= 28) return name
    return "…" + name.slice(-27)
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n)
  }

  function startOfLocalDayMs(ms) {
    var d = new Date(ms)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }

  function dayKeyFromMs(ms) {
    var d = new Date(ms)
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }

  function dayLabelFromMs(ms) {
    var d = new Date(ms)
    return (d.getMonth() + 1) + "/" + d.getDate()
  }

  function aggregateEventsByModel(events) {
    var byModel = Object.create(null)
    var totalCents = 0
    var totalTokens = 0
    for (var i = 0; i < events.length; i++) {
      var event = events[i]
      var model = typeof event.model === "string" && event.model.trim() ? event.model.trim() : "unknown"
      var cost = eventCostCents(event)
      var tokens = eventTokens(event)
      totalCents += cost
      totalTokens += tokens
      if (!byModel[model]) {
        byModel[model] = { model: model, count: 0, costCents: 0, tokens: 0 }
      }
      byModel[model].count += 1
      byModel[model].costCents += cost
      byModel[model].tokens += tokens
    }
    var ranked = Object.keys(byModel)
      .map(function (key) { return byModel[key] })
      .sort(function (a, b) {
        if (b.costCents !== a.costCents) return b.costCents - a.costCents
        return b.count - a.count
      })
    return { totalCents: totalCents, totalTokens: totalTokens, models: ranked }
  }

  function buildDailyBuckets(events, startMs, endMs) {
    var buckets = Object.create(null)
    var order = []
    var cursorDate = new Date(startOfLocalDayMs(startMs))
    var endDay = startOfLocalDayMs(endMs)
    while (cursorDate.getTime() <= endDay) {
      var key = dayKeyFromMs(cursorDate.getTime())
      buckets[key] = {
        key: key,
        label: dayLabelFromMs(cursorDate.getTime()),
        costCents: 0,
        tokens: 0,
        count: 0,
      }
      order.push(key)
      cursorDate = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
      )
    }
    for (var i = 0; i < events.length; i++) {
      var event = events[i]
      var ts = Number(event && event.timestamp)
      if (!Number.isFinite(ts)) continue
      var dayKey = dayKeyFromMs(ts)
      if (!buckets[dayKey]) continue
      buckets[dayKey].costCents += eventCostCents(event)
      buckets[dayKey].tokens += eventTokens(event)
      buckets[dayKey].count += 1
    }
    return order.map(function (key) { return buckets[key] })
  }

  function pushDailyCharts(ctx, lines, events, startMs, endMs, labelPrefix, note) {
    if (!events.length) return
    var days = buildDailyBuckets(events, startMs, endMs)
    if (!days.length) return

    var costPoints = days.map(function (day) {
      return {
        label: day.label,
        value: Math.round(day.costCents) / 100,
        valueLabel: formatUsdFromCents(day.costCents),
      }
    })
    lines.push(ctx.line.barChart({
      label: labelPrefix + " Cost",
      points: costPoints,
      note: note,
    }))

    var hasTokens = false
    for (var i = 0; i < days.length; i++) {
      if (days[i].tokens > 0) {
        hasTokens = true
        break
      }
    }
    if (!hasTokens) return

    var tokenPoints = days.map(function (day) {
      return {
        label: day.label,
        value: day.tokens,
        valueLabel: formatTokenCount(day.tokens) + " tokens",
      }
    })
    lines.push(ctx.line.barChart({
      label: labelPrefix + " Tokens",
      points: tokenPoints,
      note: note,
    }))
  }

  function pushWindowModelLines(ctx, lines, windowLabel, events, modelLimit, partial) {
    if (!events.length) return
    var summary = aggregateEventsByModel(events)
    var summaryValue = formatUsdFromCents(summary.totalCents) + " · " + events.length + " calls"
    if (summary.totalTokens > 0) {
      summaryValue += " · " + formatTokenCount(summary.totalTokens) + " tokens"
    }
    if (partial) summaryValue += " · partial"
    lines.push(ctx.line.text({
      label: windowLabel,
      value: summaryValue,
    }))
    var limit = typeof modelLimit === "number" ? modelLimit : MODEL_BREAKDOWN_LIMIT
    for (var i = 0; i < summary.models.length && i < limit; i++) {
      var row = summary.models[i]
      var modelValue = formatUsdFromCents(row.costCents) + " · " + row.count + " calls"
      if (row.tokens > 0) {
        modelValue += " · " + formatTokenCount(row.tokens) + " tokens"
      }
      lines.push(ctx.line.text({
        label: shortenModelLabel(row.model),
        value: modelValue,
      }))
    }
  }

  function fetchFilteredUsageEvents(ctx, accessToken, startMs, endMs) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("usage events: cannot build session token")
      return { events: [], truncated: false, incomplete: false }
    }
    var all = []
    var truncated = false
    var incomplete = false
    for (var page = 1; page <= EVENTS_MAX_PAGES; page++) {
      try {
        var resp = ctx.util.request({
          method: "POST",
          url: EVENTS_URL,
          headers: {
            Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
            "Content-Type": "application/json",
            Origin: "https://cursor.com",
          },
          bodyText: JSON.stringify({
            startDate: String(Math.floor(startMs)),
            endDate: String(Math.floor(endMs)),
            page: page,
            pageSize: EVENTS_PAGE_SIZE,
          }),
          timeoutMs: 15000,
        })
        if (resp.status < 200 || resp.status >= 300) {
          ctx.host.log.warn("usage events returned status=" + resp.status)
          if (all.length > 0) incomplete = true
          break
        }
        var data = ctx.util.tryParseJson(resp.bodyText)
        var batch = data && Array.isArray(data.usageEventsDisplay) ? data.usageEventsDisplay : []
        for (var i = 0; i < batch.length; i++) all.push(batch[i])
        var total =
          data && typeof data.totalUsageEventsCount === "number"
            ? data.totalUsageEventsCount
            : null
        if (batch.length < EVENTS_PAGE_SIZE) {
          if (total != null && all.length < total) truncated = true
          break
        }
        if (total != null && all.length >= total) break
        if (page === EVENTS_MAX_PAGES && (total == null || all.length < total)) {
          truncated = true
        }
      } catch (e) {
        ctx.host.log.warn("usage events fetch failed: " + String(e))
        if (all.length > 0) incomplete = true
        break
      }
    }
    return { events: all, truncated: truncated, incomplete: incomplete }
  }

  function appendUsageEventBreakdown(ctx, lines, accessToken, usage) {
    try {
      var endMs = Date.now()
      var sevenStart = endMs - SEVEN_DAYS_MS
      var cycleStart = Number(usage && usage.billingCycleStart)
      if (!Number.isFinite(cycleStart) || cycleStart <= 0) {
        cycleStart = sevenStart
      }
      var fetchStart = Math.min(sevenStart, cycleStart)
      var fetched = fetchFilteredUsageEvents(ctx, accessToken, fetchStart, endMs)
      if (!fetched.events.length) return

      var last7 = []
      var cycle = []
      for (var i = 0; i < fetched.events.length; i++) {
        var event = fetched.events[i]
        var ts = Number(event && event.timestamp)
        if (!Number.isFinite(ts)) continue
        if (ts >= sevenStart) last7.push(event)
        if (ts >= cycleStart) cycle.push(event)
      }

      var partialSample = !!(fetched.truncated || fetched.incomplete)
      pushWindowModelLines(ctx, lines, "Last 7 Days", last7, MODEL_BREAKDOWN_LIMIT, partialSample)
      pushDailyCharts(
        ctx,
        lines,
        last7,
        sevenStart,
        endMs,
        "Last 7 Days",
        "From Cursor usage events (API price / tokens).",
      )
      // Only add a second window when the billing cycle reaches earlier than 7 days.
      if (cycleStart < sevenStart - 60 * 1000) {
        pushWindowModelLines(ctx, lines, "Billing Cycle", cycle, MODEL_BREAKDOWN_LIMIT, partialSample)
        pushDailyCharts(
          ctx,
          lines,
          cycle,
          cycleStart,
          endMs,
          "Billing Cycle",
          "From Cursor usage events (API price / tokens).",
        )
      }
      if (fetched.incomplete) {
        lines.push(ctx.line.text({
          label: "Events Note",
          value: "Partial sample (incomplete fetch)",
        }))
      } else if (fetched.truncated) {
        lines.push(ctx.line.text({
          label: "Events Note",
          value: "Partial sample (page cap)",
        }))
      }
    } catch (e) {
      ctx.host.log.warn("usage event breakdown skipped: " + String(e))
    }
  }

  function buildRequestBasedResult(ctx, accessToken, planName, unavailableMessage) {
    var requestUsage = fetchRequestBasedUsage(ctx, accessToken)
    var lines = []

    if (requestUsage) {
      var gpt4 = requestUsage["gpt-4"]
      if (gpt4 && typeof gpt4.maxRequestUsage === "number" && gpt4.maxRequestUsage > 0) {
        var used = gpt4.numRequests || 0
        var limit = gpt4.maxRequestUsage

        var billingPeriodMs = 30 * 24 * 60 * 60 * 1000
        var cycleStart = requestUsage.startOfMonth
          ? ctx.util.parseDateMs(requestUsage.startOfMonth)
          : null
        var cycleEndMs = cycleStart ? cycleStart + billingPeriodMs : null

        lines.push(ctx.line.progress({
          label: "Requests",
          used: used,
          limit: limit,
          format: { kind: "count", suffix: "requests" },
          resetsAt: ctx.util.toIso(cycleEndMs),
          periodDurationMs: billingPeriodMs,
        }))
      }
    }

    if (lines.length === 0) {
      ctx.host.log.warn("request-based: no usage data available")
      throw unavailableMessage
    }

    appendUsageEventBreakdown(ctx, lines, accessToken, {
      billingCycleStart: requestUsage && requestUsage.startOfMonth
        ? ctx.util.parseDateMs(requestUsage.startOfMonth)
        : null,
    })

    var plan = null
    if (planName) {
      var planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) plan = planLabel
    }

    return { plan: plan, lines: lines }
  }

  function buildEnterpriseResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Enterprise usage data unavailable. Try again later."
    )
  }

  function buildTeamRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Team request-based usage data unavailable. Try again later."
    )
  }

  function buildUnknownRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Cursor request-based usage data unavailable. Try again later."
    )
  }

  function probe(ctx) {
    const authState = loadAuthState(ctx)
    let accessToken = authState.accessToken
    const refreshTokenValue = authState.refreshToken
    const authSource = authState.source
    const sqliteDbPath = authState.sqliteDbPath

    if (!accessToken && !refreshTokenValue) {
      ctx.host.log.error("probe failed: no access or refresh token in sqlite/keychain")
      throw "Not logged in. " + LOGIN_HINT
    }

    ctx.host.log.info(
      "tokens loaded from " +
        authSource +
        (sqliteDbPath ? " (" + sqliteDbPath + ")" : "") +
        ": accessToken=" +
        (accessToken ? "yes" : "no") +
        " refreshToken=" +
        (refreshTokenValue ? "yes" : "no")
    )

    const nowMs = Date.now()

    // Proactively refresh if token is expired or about to expire
    if (needsRefresh(ctx, accessToken, nowMs)) {
      ctx.host.log.info("token needs refresh (expired or expiring soon)")
      let refreshed = null
      try {
        refreshed = refreshToken(ctx, refreshTokenValue, authSource, sqliteDbPath)
      } catch (e) {
        // If refresh fails but we have an access token, try it anyway
        ctx.host.log.warn("refresh failed but have access token, will try: " + String(e))
        if (!accessToken) throw e
      }
      if (refreshed) {
        accessToken = refreshed
      } else if (!accessToken) {
        ctx.host.log.error("refresh failed and no access token available")
        throw "Not logged in. " + LOGIN_HINT
      }
    }

    let usageResp
    let didRefresh = false
    try {
      usageResp = ctx.util.retryOnceOnAuth({
        request: (token) => {
          try {
            return connectPost(ctx, USAGE_URL, token || accessToken)
          } catch (e) {
            ctx.host.log.error("usage request exception: " + String(e))
            if (didRefresh) {
              throw "Usage request failed after refresh. Try again."
            }
            throw "Usage request failed. Check your connection."
          }
        },
        refresh: () => {
          ctx.host.log.info("usage returned 401, attempting refresh")
          didRefresh = true
          const refreshed = refreshToken(ctx, refreshTokenValue, authSource, sqliteDbPath)
          if (refreshed) accessToken = refreshed
          return refreshed
        },
      })
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("usage request failed: " + String(e))
      throw "Usage request failed. Check your connection."
    }

    if (ctx.util.isAuthStatus(usageResp.status)) {
      ctx.host.log.error("usage returned auth error after all retries: status=" + usageResp.status)
      throw "Token expired. " + LOGIN_HINT
    }

    if (usageResp.status < 200 || usageResp.status >= 300) {
      ctx.host.log.error("usage returned error: status=" + usageResp.status)
      throw "Usage request failed (HTTP " + String(usageResp.status) + "). Try again later."
    }

    ctx.host.log.info("usage fetch succeeded")

    const usage = ctx.util.tryParseJson(usageResp.bodyText)
    if (usage === null) {
      throw "Usage response invalid. Try again later."
    }

    // Fetch plan info early (needed for request-based fallback detection)
    let planName = ""
    let planInfoUnavailable = false
    try {
      const planResp = connectPost(ctx, PLAN_URL, accessToken)
      if (planResp.status >= 200 && planResp.status < 300) {
        const plan = ctx.util.tryParseJson(planResp.bodyText)
        if (plan && plan.planInfo && plan.planInfo.planName) {
          planName = plan.planInfo.planName
        }
      } else {
        planInfoUnavailable = true
        ctx.host.log.warn("plan info returned error: status=" + planResp.status)
      }
    } catch (e) {
      planInfoUnavailable = true
      ctx.host.log.warn("plan info fetch failed: " + String(e))
    }

    const normalizedPlanName = typeof planName === "string"
      ? planName.toLowerCase()
      : ""

    const hasPlanUsage = !!usage.planUsage
    const hasPlanUsageLimit = hasPlanUsage &&
      typeof usage.planUsage.limit === "number" &&
      Number.isFinite(usage.planUsage.limit)
    const planUsageLimitMissing = hasPlanUsage && !hasPlanUsageLimit
    const hasTotalUsagePercent = hasPlanUsage &&
      typeof usage.planUsage.totalPercentUsed === "number" &&
      Number.isFinite(usage.planUsage.totalPercentUsed)

    // Enterprise and some Team request-based accounts can return no planUsage
    // or a planUsage object without limit from the Connect API.
    const needsRequestBasedFallback = usage.enabled !== false && (!hasPlanUsage || planUsageLimitMissing) && (
      normalizedPlanName === "enterprise" ||
      normalizedPlanName === "team"
    )
    if (needsRequestBasedFallback) {
      if (normalizedPlanName === "enterprise") {
        ctx.host.log.info("detected enterprise account, using REST usage API")
        return buildEnterpriseResult(ctx, accessToken, planName)
      }
      ctx.host.log.info("detected team request-based account, using REST usage API")
      return buildTeamRequestBasedResult(ctx, accessToken, planName)
    }

    const needsFallbackWithoutPlanInfo = usage.enabled !== false &&
      (!hasPlanUsage || planUsageLimitMissing) &&
      !hasTotalUsagePercent &&
      !normalizedPlanName &&
      planInfoUnavailable
    if (needsFallbackWithoutPlanInfo) {
      ctx.host.log.info("plan info unavailable with missing planUsage, attempting REST usage API fallback")
      return buildUnknownRequestBasedResult(ctx, accessToken, planName)
    }

    if (usage.enabled !== false && planUsageLimitMissing && !hasTotalUsagePercent) {
      ctx.host.log.warn("planUsage.limit missing, attempting REST usage API fallback")
      try {
        return buildUnknownRequestBasedResult(ctx, accessToken, planName)
      } catch (e) {
        ctx.host.log.warn("REST usage fallback unavailable: " + String(e))
      }
    }

    // Team plans may omit `enabled` even with valid plan usage data.
    if (usage.enabled === false || !usage.planUsage) {
      throw "No active Cursor subscription."
    }

    let creditGrants = null
    try {
      const creditsResp = connectPost(ctx, CREDITS_URL, accessToken)
      if (creditsResp.status >= 200 && creditsResp.status < 300) {
        creditGrants = ctx.util.tryParseJson(creditsResp.bodyText)
      }
    } catch (e) {
      ctx.host.log.warn("credit grants fetch failed: " + String(e))
    }

    const stripeBalanceCents = fetchStripeBalance(ctx, accessToken) || 0

    let plan = null
    if (planName) {
      const planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) {
        plan = planLabel
      }
    }

    const lines = []
    const pu = usage.planUsage

    // Credits first (if available) - highest priority primary metric
    const hasCreditGrants = creditGrants && creditGrants.hasCreditGrants === true
    const grantTotalCents = hasCreditGrants ? parseInt(creditGrants.totalCents, 10) : 0
    const grantUsedCents = hasCreditGrants ? parseInt(creditGrants.usedCents, 10) : 0
    const hasValidGrantData = hasCreditGrants &&
      grantTotalCents > 0 &&
      !isNaN(grantTotalCents) &&
      !isNaN(grantUsedCents)
    const combinedTotalCents = (hasValidGrantData ? grantTotalCents : 0) + stripeBalanceCents

    if (combinedTotalCents > 0) {
      lines.push(ctx.line.progress({
        label: "Credits",
        used: ctx.fmt.dollars(hasValidGrantData ? grantUsedCents : 0),
        limit: ctx.fmt.dollars(combinedTotalCents),
        format: { kind: "dollars" },
      }))
    }

    // Total usage (always present) - fallback primary metric
    if (!hasPlanUsageLimit && !hasTotalUsagePercent) {
      throw "Total usage limit missing from API response."
    }
    const planUsed = hasPlanUsageLimit
      ? (typeof pu.totalSpend === "number"
        ? pu.totalSpend
        : pu.limit - (pu.remaining ?? 0))
      : 0
    const computedPercentUsed = hasPlanUsageLimit && pu.limit > 0
      ? (planUsed / pu.limit) * 100
      : 0
    const totalUsagePercent = hasTotalUsagePercent
      ? pu.totalPercentUsed
      : computedPercentUsed

    // Calculate billing cycle period duration
    var billingPeriodMs = 30 * 24 * 60 * 60 * 1000 // 30 days default
    var cycleStart = Number(usage.billingCycleStart)
    var cycleEnd = Number(usage.billingCycleEnd)
    if (Number.isFinite(cycleStart) && Number.isFinite(cycleEnd) && cycleEnd > cycleStart) {
      billingPeriodMs = cycleEnd - cycleStart // already in ms
    }

    const su = usage.spendLimitUsage
    const isTeamAccount = (
      normalizedPlanName === "team" ||
      (su && su.limitType === "team") ||
      (su && typeof su.pooledLimit === "number" && su.pooledLimit > 0)
    )

    if (isTeamAccount) {
      if (!hasPlanUsageLimit) {
        ctx.host.log.warn("team-inferred account missing planUsage.limit, attempting REST usage API fallback")
        return buildUnknownRequestBasedResult(ctx, accessToken, planName)
      }
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: ctx.fmt.dollars(planUsed),
        limit: ctx.fmt.dollars(pu.limit),
        format: { kind: "dollars" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))

      if (typeof pu.bonusSpend === "number" && pu.bonusSpend > 0) {
        lines.push(ctx.line.text({
          label: "Bonus spend",
          value: formatUsdFromCents(pu.bonusSpend),
        }))
      }
    } else {
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: totalUsagePercent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    if (typeof pu.autoPercentUsed === "number" && Number.isFinite(pu.autoPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "Auto usage",
        used: pu.autoPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    if (typeof pu.apiPercentUsed === "number" && Number.isFinite(pu.apiPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "API usage",
        used: pu.apiPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    // On-demand (if available) - not a primary candidate
    if (su) {
      const limit = su.individualLimit ?? su.pooledLimit ?? 0
      const remaining = su.individualRemaining ?? su.pooledRemaining ?? 0
      if (limit > 0) {
        const used = limit - remaining
        lines.push(ctx.line.progress({
          label: "On-demand",
          used: ctx.fmt.dollars(used),
          limit: ctx.fmt.dollars(limit),
          format: { kind: "dollars" },
        }))
      }
    }

    appendUsageEventBreakdown(ctx, lines, accessToken, usage)

    return { plan: plan, lines: lines }
  }

  globalThis.__openusage_plugin = { id: "cursor", probe }
})()
