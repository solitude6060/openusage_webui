import crypto from "node:crypto"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

// Helpers for keychain hash regression tests.
const expectedHash = (path) =>
  crypto.createHash("sha256").update(path).digest("hex").slice(0, 8)
const TEST_CONFIG_DIR = "/Users/test/.claude"
const HASHED_CONFIG_SERVICE = "Claude Code-credentials-" + expectedHash(TEST_CONFIG_DIR)

let plugin = null

beforeAll(async () => {
  await import("./plugin.js")
  plugin = globalThis.__openusage_plugin
})

beforeEach(() => {
  // Reset module-scope rate-limit state so tests don't bleed into each other
  plugin?._resetState()
})

const loadPlugin = async () => plugin

describe("claude plugin", () => {
  it("throws when no credentials", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("throws when credentials are unreadable", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => "{bad json"
    ctx.host.keychain.readGenericPassword.mockReturnValue("{bad}")
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("treats credentials file read failures as missing credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => {
      throw new Error("disk read failed")
    }
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })

  it("warns when credentials file exists but lacks a usable access token", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { refreshToken: "only-refresh" } })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })

  it("treats keychain read errors as missing credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockImplementation(() => {
      throw new Error("keychain unavailable")
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    expect(ctx.host.log.info).toHaveBeenCalled()
  })

  it("prefers current-user keychain credentials when available", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    // No CLAUDE_CONFIG_DIR → upstream uses the legacy unhashed service name only.
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      "Claude Code-credentials"
    )
    expect(ctx.host.keychain.readGenericPassword).not.toHaveBeenCalled()
  })

  it("falls back to legacy keychain lookup when current-user lookup misses", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation(() => {
      throw new Error("keychain item not found")
    })
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    // No CLAUDE_CONFIG_DIR → upstream uses the legacy unhashed service name only.
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("Claude Code-credentials")
  })

  it("prefers keychain over a stale credentials file (regression for #444)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = vi.fn(() =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "stale-file-token",
          refreshToken: "stale-file-refresh",
          expiresAt: Date.now() - 1000,
          subscriptionType: "pro",
        },
      })
    )
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockReturnValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "keychain-token",
          refreshToken: "keychain-refresh",
          expiresAt: Date.now() + 60 * 60 * 1000,
          subscriptionType: "pro",
        },
      })
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        throw new Error("stale file refresh should not be attempted")
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    // Keychain wins, so the stale credentials file stays unread. The live cache file may still be read.
    expect(ctx.host.fs.readText.mock.calls.some((call) => String(call[0]).endsWith("/.credentials.json"))).toBe(false)
    expect(ctx.host.http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer keychain-token" }),
      })
    )
  })

  it("falls back to keychain when credentials file is corrupt", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => "{bad json"
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
  })

  it("reads credentials from CLAUDE_CONFIG_DIR and passes it to ccusage", async () => {
    const ctx = makeCtx()
    const configDir = "/tmp/custom-claude-home"
    const configCredFile = configDir + "/.credentials.json"
    const credsJson = JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.env.get.mockImplementation((name) => (name === "CLAUDE_CONFIG_DIR" ? configDir : null))
    ctx.host.fs.exists = vi.fn((path) => path === configCredFile)
    ctx.host.fs.readText = vi.fn((path) => {
      if (path !== configCredFile) {
        throw new Error("unexpected readText path: " + path)
      }
      return credsJson
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    ctx.host.ccusage.query = vi.fn(() => ({ status: "ok", data: { daily: [] } }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.fs.readText).toHaveBeenCalledWith(configCredFile)
    expect(ctx.host.ccusage.query).toHaveBeenCalledWith(
      expect.objectContaining({ homePath: configDir })
    )
  })

  it("looks up Claude Code-staging-oauth-credentials in keychain", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.env.get.mockImplementation((name) => {
      if (name === "USER_TYPE") return "ant"
      if (name === "USE_STAGING_OAUTH") return "1"
      return null
    })
    ctx.host.keychain.readGenericPassword.mockImplementation((service) => {
      if (service === "Claude Code-staging-oauth-credentials") {
        return JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
      }
      if (service === "Claude Code-credentials") {
        return JSON.stringify({ claudeAiOauth: { refreshToken: "fallback-only" } })
      }
      return null
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith(
      "Claude Code-staging-oauth-credentials"
    )
  })

  it("finds the hashed keychain entry when CLAUDE_CONFIG_DIR is set (regression for #423)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.env.get.mockImplementation((name) =>
      name === "CLAUDE_CONFIG_DIR" ? TEST_CONFIG_DIR : null
    )
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation((service) => {
      if (service === HASHED_CONFIG_SERVICE) {
        return JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
      }
      return null
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      HASHED_CONFIG_SERVICE
    )
  })

  it("falls back to legacy unhashed entry when CLAUDE_CONFIG_DIR is set but no hashed entry exists", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.env.get.mockImplementation((name) =>
      name === "CLAUDE_CONFIG_DIR" ? TEST_CONFIG_DIR : null
    )
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation((service) => {
      if (service === "Claude Code-credentials") {
        return JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
      }
      return null  // hashed lookup misses → legacy candidate is tried next
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      HASHED_CONFIG_SERVICE
    )
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      "Claude Code-credentials"
    )
  })

  it("does NOT compute a hash when CLAUDE_CONFIG_DIR is unset (matches upstream)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)
    // Only the legacy unhashed service is consulted — no hashed candidate.
    const calls = ctx.host.keychain.readGenericPasswordForCurrentUser.mock.calls.map((c) => c[0])
    expect(calls).toEqual(["Claude Code-credentials"])
  })

  it("composes the staging-oauth keychain hash correctly", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.env.get.mockImplementation((name) => {
      if (name === "CLAUDE_CONFIG_DIR") return TEST_CONFIG_DIR
      if (name === "USER_TYPE") return "ant"
      if (name === "USE_STAGING_OAUTH") return "1"
      return null
    })
    const hashedStagingService =
      "Claude Code-staging-oauth-credentials-" + expectedHash(TEST_CONFIG_DIR)
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation((service) => {
      if (service === hashedStagingService) {
        return JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
      }
      return null
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      hashedStagingService
    )
  })

  it("hashes CLAUDE_CONFIG_DIR verbatim (no tilde expansion, NFC-normalized)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    // Raw, tilde-prefixed value: hashed verbatim. Upstream applies .normalize("NFC"),
    // which is a no-op for ASCII so the hash matches a plain sha256 of the string.
    const rawConfigDir = "~/some-custom-claude-home"
    ctx.host.env.get.mockImplementation((name) =>
      name === "CLAUDE_CONFIG_DIR" ? rawConfigDir : null
    )
    const hashedService = "Claude Code-credentials-" + expectedHash(rawConfigDir)
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation((service) => {
      if (service === hashedService) {
        return JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
      }
      return null
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPasswordForCurrentUser).toHaveBeenCalledWith(
      hashedService
    )
  })

  it("uses env-injected OAuth tokens without hitting /api/oauth/usage", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.fs.readText = () => {
      throw new Error("unexpected file read")
    }
    ctx.host.env.get.mockImplementation((name) =>
      name === "CLAUDE_CODE_OAUTH_TOKEN" ? "env-oauth-token" : null
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    ctx.host.ccusage.query = vi.fn(() => ({
      status: "ok",
      data: {
        daily: [
          {
            date: "2024-01-01",
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 150,
            totalCost: 0.25,
          },
        ],
      },
    }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(
      ctx.host.http.request.mock.calls.some((call) => String(call[0]?.url).includes("/api/oauth/usage"))
    ).toBe(false)
    expect(result.lines.find((line) => line.label === "Last 30 Days")?.value).toContain("150 tokens")
  })

  it("renders usage lines from response", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        seven_day: { utilization: 20, resets_at: "2099-01-01T00:00:00.000Z" },
        extra_usage: { is_enabled: true, used_credits: 500, monthly_limit: 1000 },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Pro")
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(result.lines.find((line) => line.label === "Weekly")).toBeTruthy()
  })

  it("appends max rate limit tier to the plan label when present", async () => {
    const runCase = async (rateLimitTier, expectedPlan) => {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => true
      ctx.host.fs.readText = () =>
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "token",
            subscriptionType: "max",
            rateLimitTier,
          },
        })
      ctx.host.http.request.mockReturnValue({
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      })

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.plan).toBe(expectedPlan)
    }

    await runCase("claude_max_subscription_20x", "Max 20x")
    await runCase("claude_max_subscription_5x", "Max 5x")
  })

  it("omits resetsAt when resets_at is missing", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 0 },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const sessionLine = result.lines.find((line) => line.label === "Session")
    expect(sessionLine).toBeTruthy()
    expect(sessionLine.resetsAt).toBeUndefined()
  })

  it("throws token expired on 401", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({ status: 401, bodyText: "" })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  it("shows rate limited badge on 429 without throwing", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({ status: 429, bodyText: "", headers: {} })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const statusLine = result.lines.find((line) => line.label === "Status")
    expect(statusLine).toBeTruthy()
    expect(statusLine.text).toContain("Rate limited")
    expect(result.lines.find((line) => line.label === "Note")).toBeTruthy()
  })

  it("shows Retry-After info on 429 when header is present", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 429,
      bodyText: "",
      headers: { "Retry-After": "600" }, // 10 minutes
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const statusLine = result.lines.find((line) => line.label === "Status")
    expect(statusLine).toBeTruthy()
    expect(statusLine.text).toContain("10m")
    const noteLine = result.lines.find((line) => line.label === "Note")
    expect(noteLine).toBeTruthy()
    expect(noteLine.value).toContain("10m")
  })

  it("shows generic rate limited message when Retry-After is missing", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({ status: 429, bodyText: "", headers: {} })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const statusLine = result.lines.find((line) => line.label === "Status")
    expect(statusLine).toBeTruthy()
    expect(statusLine.text).toContain("try again later")
  })

  it("shows retry-now when Retry-After: 0", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 429,
      bodyText: "",
      headers: { "Retry-After": "0" },
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const statusLine = result.lines.find((line) => line.label === "Status")
    expect(statusLine).toBeTruthy()
    expect(statusLine.text).toContain("~now")
    const noteLine = result.lines.find((line) => line.label === "Note")
    expect(noteLine).toBeTruthy()
    expect(noteLine.value).toContain("~now")
  })

  it("uses keychain credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_sonnet: { utilization: 5, resets_at: "2099-01-01T00:00:00.000Z" },
        extra_usage: { is_enabled: true, used_credits: 250 },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Sonnet")).toBeTruthy()
    expect(result.lines.find((line) => line.label === "Extra usage spent")).toBeTruthy()
  })

  it("renders Claude Design line from seven_day_omelette with normalized resetsAt", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_omelette: { utilization: 7, resets_at: "2099-01-01 00:00:00 UTC" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Claude Design")
    expect(line).toBeTruthy()
    expect(line.used).toBe(7)
    expect(line.limit).toBe(100)
    expect(line.format).toEqual({ kind: "percent" })
    expect(line.resetsAt).toBe("2099-01-01T00:00:00.000Z")
  })

  it("renders Fable Weekly line from seven_day_fable with normalized resetsAt", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_fable: { utilization: 11, resets_at: "2099-01-01 00:00:00 UTC" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Fable Weekly")
    expect(line).toBeTruthy()
    expect(line.used).toBe(11)
    expect(line.limit).toBe(100)
    expect(line.format).toEqual({ kind: "percent" })
    expect(line.resetsAt).toBe("2099-01-01T00:00:00.000Z")
  })

  it("renders Fable Weekly from a limits[] weekly_scoped entry", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        seven_day: { utilization: 61, resets_at: "2099-01-08T00:00:00.000Z" },
        seven_day_sonnet: null,
        seven_day_opus: null,
        limits: [
          { kind: "session", group: "session", percent: 10, resets_at: "2099-01-01T00:00:00.000Z", scope: null },
          { kind: "weekly_all", group: "weekly", percent: 61, resets_at: "2099-01-08T00:00:00.000Z", scope: null },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 44,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Fable" }, surface: null },
          },
        ],
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const fableLines = result.lines.filter((line) => line.label === "Fable Weekly")
    expect(fableLines).toHaveLength(1)
    expect(fableLines[0].used).toBe(44)
    expect(fableLines[0].limit).toBe(100)
    expect(fableLines[0].format).toEqual({ kind: "percent" })
    expect(fableLines[0].resetsAt).toBe("2099-01-08T18:59:59.734Z")
    expect(fableLines[0].periodDurationMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("skips a limits[] weekly entry whose percent is null and keeps a numeric sibling", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: null,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Fable" }, surface: null },
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 44,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Sonnet" }, surface: null },
          },
        ],
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Fable Weekly")).toBeUndefined()
    const sonnetLines = result.lines.filter((line) => line.label === "Sonnet Weekly")
    expect(sonnetLines).toHaveLength(1)
    expect(sonnetLines[0].used).toBe(44)
  })

  it("emits one Fable Weekly line when legacy seven_day_fable and limits[] both exist", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_fable: { utilization: 11, resets_at: "2099-01-01T00:00:00.000Z" },
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 44,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Fable" }, surface: null },
          },
        ],
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const fableLines = result.lines.filter((line) => line.label === "Fable Weekly")
    expect(fableLines).toHaveLength(1)
    expect(fableLines[0].used).toBe(11)
  })

  it("emits one Sonnet weekly line when legacy seven_day_sonnet and limits[] both exist", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_sonnet: { utilization: 5, resets_at: "2099-01-01T00:00:00.000Z" },
        seven_day_omelette: { utilization: 7, resets_at: "2099-01-01T00:00:00.000Z" },
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 44,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Sonnet" }, surface: null },
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 9,
            resets_at: "2099-01-08T18:59:59.734Z",
            scope: { model: { id: null, display_name: "Claude Design" }, surface: null },
          },
        ],
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const sonnetLines = result.lines.filter(
      (line) => line.label === "Sonnet" || line.label === "Sonnet Weekly",
    )
    expect(sonnetLines).toHaveLength(1)
    expect(sonnetLines[0].label).toBe("Sonnet")
    expect(sonnetLines[0].used).toBe(5)
    const designLines = result.lines.filter(
      (line) => line.label === "Claude Design" || line.label === "Claude Design Weekly",
    )
    expect(designLines).toHaveLength(1)
    expect(designLines[0].label).toBe("Claude Design")
    expect(designLines[0].used).toBe(7)
  })

  it("accepts the misspelled falbe usage window from the Claude API", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_falbe: { utilization: 12, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Fable Weekly")
    expect(line).toBeTruthy()
    expect(line.used).toBe(12)
  })

  it("finds nested Fable weekly quota windows from the Claude API", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        quotas: {
          models: {
            fable: { used: 22, limit: 100, reset_at: "2099-01-01T00:00:00.000Z" },
          },
        },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Fable Weekly")
    expect(line).toBeTruthy()
    expect(line.used).toBe(22)
    expect(line.resetsAt).toBe("2099-01-01T00:00:00.000Z")
  })

  it("normalizes string utilization values from the Claude API", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_fable: { utilization: "13", resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Fable Weekly")
    expect(line).toBeTruthy()
    expect(line.used).toBe(13)
  })

  it("omits Claude Design line when seven_day_omelette has no utilization", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_omelette: {},
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((l) => l.label === "Claude Design")).toBeUndefined()
  })

  it("omits Claude Design line when seven_day_omelette utilization is non-numeric", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        seven_day_omelette: { utilization: "5", resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((l) => l.label === "Claude Design")).toBeUndefined()
  })

  it("omits extra usage line when used credits are zero and no limit exists", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        extra_usage: { is_enabled: true, used_credits: 0, monthly_limit: null },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Extra usage spent")).toBeUndefined()
  })

  it("uses keychain credentials when value is hex-encoded JSON", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    const json = JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } }, null, 2)
    const hex = Buffer.from(json, "utf8").toString("hex")
    ctx.host.keychain.readGenericPassword.mockReturnValue(hex)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 1, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
  })

  it("accepts 0x-prefixed hex keychain credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    const json = JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } }, null, 2)
    const hex = "0x" + Buffer.from(json, "utf8").toString("hex")
    ctx.host.keychain.readGenericPassword.mockReturnValue(hex)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 1, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
  })

  it("decodes hex-encoded UTF-8 correctly (non-ascii json)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    const json = JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pró" } }, null, 2)
    const hex = Buffer.from(json, "utf8").toString("hex")
    ctx.host.keychain.readGenericPassword.mockReturnValue(hex)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 1, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
  })

  it("decodes 3-byte and 4-byte UTF-8 in hex-encoded JSON", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    const json = JSON.stringify(
      { claudeAiOauth: { accessToken: "token", subscriptionType: "pro€🙂" } },
      null,
      2
    )
    const hex = Buffer.from(json, "utf8").toString("hex")
    ctx.host.keychain.readGenericPassword.mockReturnValue(hex)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 1, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
  })

  it("uses custom UTF-8 decoder when TextDecoder is unavailable", async () => {
    const original = globalThis.TextDecoder
    // Force plugin to use its fallback decoder.
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      const json = JSON.stringify(
        { claudeAiOauth: { accessToken: "token", subscriptionType: "pró€🙂" } },
        null,
        2
      )
      const hex = Buffer.from(json, "utf8").toString("hex")
      ctx.host.keychain.readGenericPassword.mockReturnValue(hex)
      ctx.host.http.request.mockReturnValue({
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 1, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      })
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).not.toThrow()
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder tolerates invalid byte sequences", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      // Invalid UTF-8 bytes (will produce replacement chars).
      ctx.host.keychain.readGenericPassword.mockReturnValue("c200ff")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder handles truncated 3-byte sequences in hex payloads", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      ctx.host.keychain.readGenericPassword.mockReturnValue("e282")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder handles truncated 2-byte sequences in hex payloads", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      ctx.host.keychain.readGenericPassword.mockReturnValue("c2")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder handles invalid 3-byte continuation sequences in hex payloads", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      ctx.host.keychain.readGenericPassword.mockReturnValue("e228a1")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder handles invalid 4-byte sequences in hex payloads", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      ctx.host.keychain.readGenericPassword.mockReturnValue("f0808080")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("custom decoder handles truncated 4-byte sequences in hex payloads", async () => {
    const original = globalThis.TextDecoder
    // eslint-disable-next-line no-undef
    delete globalThis.TextDecoder
    try {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => false
      ctx.host.keychain.readGenericPassword.mockReturnValue("f09f98")
      const plugin = await loadPlugin()
      expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    } finally {
      globalThis.TextDecoder = original
    }
  })

  it("treats invalid hex credentials as not logged in", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockReturnValue("0x123") // odd length
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("throws on http errors and parse failures", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValueOnce({ status: 500, bodyText: "" })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("HTTP 500")

    // Reset lastUsageFetchMs so the second probe is not throttled by min-interval guard
    plugin._resetState()
    ctx.host.http.request.mockReturnValueOnce({ status: 200, bodyText: "not-json" })
    expect(() => plugin.probe(ctx)).toThrow("Usage response invalid")
  })

  it("throws on request errors", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockImplementation(() => {
      throw new Error("boom")
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed")
  })

  it("shows status badge when no usage data and ccusage is unavailable", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockImplementation((opts) => {
      const url = String(opts && opts.url)
      // Profile and reset-grant reads are separate requests. Fail them so this
      // test still covers an empty usage card, not a reset-grant row.
      if (url.includes("/api/oauth/profile") || url.includes("cedar_ember=1")) {
        return { status: 500, bodyText: "", headers: {} }
      }
      return { status: 200, bodyText: JSON.stringify({}), headers: {} }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((l) => l.label === "Today")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Yesterday")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Last 30 Days")).toBeUndefined()
    const statusLine = result.lines.find((l) => l.label === "Status")
    expect(statusLine).toBeTruthy()
    expect(statusLine.text).toBe("No usage data")
  })

  it("passes resetsAt through as ISO when present", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
    ctx.host.fs.exists = () => true
    const now = new Date("2026-02-02T00:00:00.000Z").getTime()
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now)
    const fiveHourIso = new Date(now + 30_000).toISOString()
    const sevenDayIso = new Date(now + 5 * 60_000).toISOString()
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: fiveHourIso },
        seven_day: { utilization: 20, resets_at: sevenDayIso },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")?.resetsAt).toBe(fiveHourIso)
    expect(result.lines.find((line) => line.label === "Weekly")?.resetsAt).toBe(sevenDayIso)
    nowSpy.mockRestore()
  })

  it("normalizes resets_at without timezone (microseconds) into ISO for resetsAt", async () => {
    const ctx = makeCtx()
    ctx.host.fs.readText = () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "pro" } })
    ctx.host.fs.exists = () => true
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.123456" },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")?.resetsAt).toBe(
      "2099-01-01T00:00:00.123Z"
    )
  })

  it("refreshes token when expired and persists updated credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
          subscriptionType: "pro",
        },
      })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600, refresh_token: "refresh2" }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(ctx.host.fs.writeText).toHaveBeenCalled()
  })

  it("includes user:file_upload in the OAuth refresh scope", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
          subscriptionType: "pro",
        },
      })

    let refreshBody = null
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        refreshBody = JSON.parse(opts.bodyText)
        return {
          status: 200,
          bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600, refresh_token: "refresh2" }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(refreshBody.scope).toContain("user:file_upload")
  })

  it("refreshes keychain credentials and writes back to keychain", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
          subscriptionType: "pro",
        },
      })
    )

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600 }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
    expect(ctx.host.keychain.writeGenericPassword).toHaveBeenCalled()
  })

  it("retries usage request after 401 by refreshing once", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60_000,
          subscriptionType: "pro",
        },
      })

    let usageCalls = 0
    let firstUsageHeaders = null
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/api/oauth/usage")) {
        // The reset-grant read uses the same path with cedar_ember. It is not a usage retry.
        if (!String(opts.url).includes("cedar_ember")) {
          usageCalls += 1
          if (!firstUsageHeaders) firstUsageHeaders = opts.headers
          if (usageCalls === 1) {
            return { status: 401, bodyText: "" }
          }
        }
        return {
          status: 200,
          bodyText: JSON.stringify({
            five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
          }),
        }
      }
      // Refresh
      return {
        status: 200,
        bodyText: JSON.stringify({ access_token: "token2", expires_in: 3600 }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(usageCalls).toBe(2)
    expect(firstUsageHeaders["User-Agent"]).toBe("claude-code/2.1.69")
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
  })

  it("throws session expired when refresh returns invalid_grant", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1,
        },
      })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 400, bodyText: JSON.stringify({ error: "invalid_grant" }) }
      }
      return { status: 500, bodyText: "" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Session expired")
  })

  it("throws token expired when usage remains unauthorized after refresh", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60_000,
        },
      })

    let usageCalls = 0
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/api/oauth/usage")) {
        usageCalls += 1
        if (usageCalls === 1) return { status: 401, bodyText: "" }
        return { status: 403, bodyText: "" }
      }
      return { status: 200, bodyText: JSON.stringify({ access_token: "token2", expires_in: 3600 }) }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  it("throws token expired when refresh is unauthorized", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1,
        },
      })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 401, bodyText: JSON.stringify({ error: "nope" }) }
      }
      return { status: 500, bodyText: "" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  it("logs when saving keychain credentials fails", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
        },
      })
    )
    ctx.host.keychain.writeGenericPassword.mockImplementation(() => {
      throw new Error("write fail")
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600 }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
    expect(ctx.host.log.error).toHaveBeenCalled()
  })

  it("writes refreshed credentials back to the current-user keychain source", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockReturnValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
        },
      })
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600 }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
    expect(ctx.host.keychain.writeGenericPasswordForCurrentUser).toHaveBeenCalled()
    expect(ctx.host.keychain.writeGenericPassword).not.toHaveBeenCalled()
  })

  it("writes refreshed credentials back to the legacy keychain source after fallback", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPasswordForCurrentUser.mockImplementation(() => {
      throw new Error("keychain item not found")
    })
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
        },
      })
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600 }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
    expect(ctx.host.keychain.writeGenericPassword).toHaveBeenCalled()
    expect(ctx.host.keychain.writeGenericPasswordForCurrentUser).not.toHaveBeenCalled()
  })

  it("logs when saving credentials file fails", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "old-token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1000,
        },
      })
    ctx.host.fs.writeText.mockImplementation(() => {
      throw new Error("disk full")
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: "new-token", expires_in: 3600 }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
    expect(ctx.host.log.error).toHaveBeenCalled()
  })

  it("continues when refresh request throws non-string error (returns null)", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1,
        },
      })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        throw new Error("network")
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
        }),
      }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
  })

  it("falls back to keychain when file oauth exists but has no access token", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { refreshToken: "only-refresh" } })
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { accessToken: "keychain-token", subscriptionType: "pro" } })
    )
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
  })

  it("treats keychain oauth without access token as not logged in", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => false
    ctx.host.keychain.readGenericPassword.mockReturnValue(
      JSON.stringify({ claudeAiOauth: { refreshToken: "only-refresh" } })
    )
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("continues with existing token when refresh cannot return a usable token", async () => {
    const baseCreds = JSON.stringify({
      claudeAiOauth: {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() - 1,
      },
    })

    const runCase = async (refreshResp) => {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => true
      ctx.host.fs.readText = () => baseCreds
      ctx.host.http.request.mockImplementation((opts) => {
        if (String(opts.url).includes("/v1/oauth/token")) return refreshResp
        return {
          status: 200,
          bodyText: JSON.stringify({
            five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
          }),
        }
      })

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    }

    await runCase({ status: 500, bodyText: "" })
    await runCase({ status: 200, bodyText: "not-json" })
    await runCase({ status: 200, bodyText: JSON.stringify({}) })
  })

  it("skips proactive refresh when token is not near expiry", async () => {
    const ctx = makeCtx()
    const now = 1_700_000_000_000
    vi.spyOn(Date, "now").mockReturnValue(now)
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: now + 24 * 60 * 60 * 1000,
          subscriptionType: "pro",
        },
      })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)
    expect(
      ctx.host.http.request.mock.calls.some((call) => String(call[0]?.url).includes("/v1/oauth/token"))
    ).toBe(false)
  })

  it("handles malformed ccusage payload shape as runner_failed", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token", subscriptionType: "   " } })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
      }),
    })
    ctx.host.ccusage.query = vi.fn(() => ({ status: "ok", data: {} }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeNull()
    expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
    expect(result.lines.find((line) => line.label === "Today")).toBeUndefined()
  })

  it("throws usage request failed after refresh when retry errors", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60_000,
        },
      })

    let usageCalls = 0
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/api/oauth/usage")) {
        usageCalls += 1
        if (usageCalls === 1) return { status: 401, bodyText: "" }
        throw new Error("boom")
      }
      return { status: 200, bodyText: JSON.stringify({ access_token: "token2", expires_in: 3600 }) }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed after refresh")
  })

  it("throws usage request failed when retryOnceOnAuth throws a non-string error", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60_000,
        },
      })

    ctx.util.retryOnceOnAuth = () => {
      throw new Error("network blew up")
    }

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed. Check your connection.")
  })

  it("throws token expired when refresh response cannot be parsed", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = () => true
    ctx.host.fs.readText = () =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "token",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1,
        },
      })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/v1/oauth/token")) {
        return { status: 400, bodyText: "not-json" }
      }
      return { status: 500, bodyText: "" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  describe("token usage: ccusage integration", () => {
    const CRED_JSON = JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
    const USAGE_RESPONSE = JSON.stringify({
      five_hour: { utilization: 30, resets_at: "2099-01-01T00:00:00.000Z" },
      seven_day: { utilization: 50, resets_at: "2099-01-01T00:00:00.000Z" },
    })

    function makeProbeCtx({ ccusageResult = { status: "runner_failed" } } = {}) {
      const ctx = makeCtx()
      ctx.host.fs.exists = () => true
      ctx.host.fs.readText = () => CRED_JSON
      ctx.host.http.request.mockReturnValue({ status: 200, bodyText: USAGE_RESPONSE })
      ctx.host.ccusage.query = vi.fn(() => ccusageResult)
      return ctx
    }

    function okUsage(daily) {
      return { status: "ok", data: { daily: daily } }
    }

    function localDayKey(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      return year + "-" + month + "-" + day
    }

    function localCompactDayKey(date) {
      const year = String(date.getFullYear())
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const day = String(date.getDate()).padStart(2, "0")
      return year + month + day
    }

    it("omits token lines when ccusage reports no_runner", async () => {
      const ctx = makeProbeCtx({ ccusageResult: { status: "no_runner" } })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.lines.find((l) => l.label === "Today")).toBeUndefined()
      expect(result.lines.find((l) => l.label === "Yesterday")).toBeUndefined()
      expect(result.lines.find((l) => l.label === "Last 30 Days")).toBeUndefined()
    })

    it("rate-limit lines still appear when ccusage reports runner_failed", async () => {
      const ctx = makeProbeCtx({ ccusageResult: { status: "runner_failed" } })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.lines.find((l) => l.label === "Session")).toBeTruthy()
      expect(result.lines.find((l) => l.label === "Today")).toBeUndefined()
      expect(result.lines.find((l) => l.label === "Yesterday")).toBeUndefined()
    })

    it("adds Today line when ccusage returns today's data", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, totalCost: 0.75 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.type).toBe("text")
      expect(todayLine.value).toContain("150 tokens")
      expect(todayLine.value).toContain("$0.75")
    })

    it("adds Yesterday line when ccusage returns yesterday's data", async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayKey = localDayKey(yesterday)
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: yesterdayKey, inputTokens: 80, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 120, totalCost: 0.6 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const yesterdayLine = result.lines.find((l) => l.label === "Yesterday")
      expect(yesterdayLine).toBeTruthy()
      expect(yesterdayLine.value).toContain("120 tokens")
      expect(yesterdayLine.value).toContain("$0.60")
    })

    it("matches locale-formatted dates for today and yesterday (regression)", async () => {
      const now = new Date()
      const monthToday = now.toLocaleString("en-US", { month: "short" })
      const dayToday = String(now.getDate()).padStart(2, "0")
      const yearToday = now.getFullYear()
      const todayLabel = monthToday + " " + dayToday + ", " + yearToday

      const yesterday = new Date(now.getTime())
      yesterday.setDate(yesterday.getDate() - 1)
      const monthYesterday = yesterday.toLocaleString("en-US", { month: "short" })
      const dayYesterday = String(yesterday.getDate()).padStart(2, "0")
      const yearYesterday = yesterday.getFullYear()
      const yesterdayLabel = monthYesterday + " " + dayYesterday + ", " + yearYesterday

      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayLabel, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, totalCost: 0.75 },
            { date: yesterdayLabel, inputTokens: 80, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 120, totalCost: 0.6 },
          ]),
      })

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)

      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("150 tokens")
      expect(todayLine.value).toContain("$0.75")

      const yesterdayLine = result.lines.find((l) => l.label === "Yesterday")
      expect(yesterdayLine).toBeTruthy()
      expect(yesterdayLine.value).toContain("120 tokens")
      expect(yesterdayLine.value).toContain("$0.60")
    })

    it("matches UTC timestamp day keys at month boundary (regression)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0))
      try {
        const ctx = makeProbeCtx({
          ccusageResult: okUsage([
              { date: "2026-03-01T12:00:00Z", inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 10, totalCost: 0.1 },
            ]),
        })
        const plugin = await loadPlugin()
        const result = plugin.probe(ctx)
        const todayLine = result.lines.find((l) => l.label === "Today")
        expect(todayLine).toBeTruthy()
        expect(todayLine.value).toContain("10 tokens")
      } finally {
        vi.useRealTimers()
      }
    })

    it("matches UTC+9 timestamp day keys at month boundary (regression)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0))
      try {
        const ctx = makeProbeCtx({
          ccusageResult: okUsage([
              { date: "2026-03-01T00:30:00+09:00", inputTokens: 20, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 20, totalCost: 0.2 },
            ]),
        })
        const plugin = await loadPlugin()
        const result = plugin.probe(ctx)
        const todayLine = result.lines.find((l) => l.label === "Today")
        expect(todayLine).toBeTruthy()
        expect(todayLine.value).toContain("20 tokens")
      } finally {
        vi.useRealTimers()
      }
    })

    it("matches UTC-8 timestamp day keys at day boundary (regression)", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0))
      try {
        const ctx = makeProbeCtx({
          ccusageResult: okUsage([
              { date: "2026-03-01T23:30:00-08:00", inputTokens: 30, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30, totalCost: 0.3 },
            ]),
        })
        const plugin = await loadPlugin()
        const result = plugin.probe(ctx)
        const todayLine = result.lines.find((l) => l.label === "Today")
        expect(todayLine).toBeTruthy()
        expect(todayLine.value).toContain("30 tokens")
      } finally {
        vi.useRealTimers()
      }
    })

    it("adds Last 30 Days line summing all daily entries", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, totalCost: 0.5 },
            { date: "2026-02-01", inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 300, totalCost: 1.0 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const last30 = result.lines.find((l) => l.label === "Last 30 Days")
      expect(last30).toBeTruthy()
      expect(last30.value).toContain("450 tokens")
      expect(last30.value).toContain("$1.50")
    })

    it("shows empty Today/Yesterday and Last 30 Days when today has no entry", async () => {
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: "2026-02-01", inputTokens: 500, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 600, totalCost: 2.0 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("$0.00")
      expect(todayLine.value).toContain("0 tokens")
      const yesterdayLine = result.lines.find((l) => l.label === "Yesterday")
      expect(yesterdayLine).toBeTruthy()
      expect(yesterdayLine.value).toContain("$0.00")
      expect(yesterdayLine.value).toContain("0 tokens")
      const last30 = result.lines.find((l) => l.label === "Last 30 Days")
      expect(last30).toBeTruthy()
      expect(last30.value).toContain("600 tokens")
    })

    it("shows empty Today state when ccusage returns ok with empty daily array", async () => {
      const ctx = makeProbeCtx({ ccusageResult: okUsage([]) })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("$0.00")
      expect(todayLine.value).toContain("0 tokens")
      const yesterdayLine = result.lines.find((l) => l.label === "Yesterday")
      expect(yesterdayLine).toBeTruthy()
      expect(yesterdayLine.value).toContain("$0.00")
      expect(yesterdayLine.value).toContain("0 tokens")
      expect(result.lines.find((l) => l.label === "Last 30 Days")).toBeUndefined()
    })

    it("omits cost when totalCost is null", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 500, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 600, totalCost: null },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).not.toContain("$")
      expect(todayLine.value).toContain("600 tokens")
    })

    it("shows empty Today state when today's totals are zero (regression)", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("$0.00")
      expect(todayLine.value).toContain("0 tokens")
    })

    it("shows empty Yesterday state when yesterday's totals are zero (regression)", async () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayKey = localDayKey(yesterday)
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: yesterdayKey, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const yesterdayLine = result.lines.find((l) => l.label === "Yesterday")
      expect(yesterdayLine).toBeTruthy()
      expect(yesterdayLine.value).toContain("$0.00")
      expect(yesterdayLine.value).toContain("0 tokens")
    })

    it("queries ccusage on each probe", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, totalCost: 0.5 },
          ]),
      })
      const plugin = await loadPlugin()
      plugin.probe(ctx)
      plugin.probe(ctx)
      expect(ctx.host.ccusage.query).toHaveBeenCalledTimes(2)
    })

    it("queries ccusage with a 31-day inclusive since window", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-02-20T16:00:00.000Z"))
      try {
        const ctx = makeProbeCtx({ ccusageResult: okUsage([]) })
        const plugin = await loadPlugin()
        plugin.probe(ctx)
        expect(ctx.host.ccusage.query).toHaveBeenCalled()

        const firstCall = ctx.host.ccusage.query.mock.calls[0][0]
        const since = new Date()
        since.setDate(since.getDate() - 30)
        expect(firstCall.since).toBe(localCompactDayKey(since))
      } finally {
        vi.useRealTimers()
      }
    })

    it("matches compact day keys and falls back from invalid totalCost to costUSD", async () => {
      const today = new Date()
      const todayKey = localCompactDayKey(today)
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
          {
            date: todayKey,
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 150,
            totalCost: "not-a-number",
            costUSD: 0.25,
          },
        ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("150 tokens")
      expect(todayLine.value).toContain("$0.25")
    })

    it("includes cache tokens in total", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
            { date: todayKey, inputTokens: 100, outputTokens: 50, cacheCreationTokens: 200, cacheReadTokens: 300, totalTokens: 650, totalCost: 1.0 },
          ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      expect(todayLine).toBeTruthy()
      expect(todayLine.value).toContain("650 tokens")
    })

    it("formats compact token values with decimal and rounded K suffixes", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
          {
            date: todayKey,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 1500,
            totalCost: 0.5,
          },
          {
            date: "2026-02-01",
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 10500,
            totalCost: 1.5,
          },
        ]),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const todayLine = result.lines.find((l) => l.label === "Today")
      const last30 = result.lines.find((l) => l.label === "Last 30 Days")
      expect(todayLine.value).toContain("1.5K tokens")
      expect(last30.value).toContain("12K tokens")
    })

    it("shows rate limited status after all retries exhausted", async () => {
      const todayKey = localDayKey(new Date())
      const ctx = makeProbeCtx({
        ccusageResult: okUsage([
          { date: todayKey, inputTokens: 100, outputTokens: 50, totalTokens: 150, totalCost: 0.25 },
        ]),
      })
      // All calls return 429
      ctx.host.http.request.mockReturnValue({
        status: 429,
        bodyText: '{"error":"rate limited"}',
        headers: { "Retry-After": "1200" }, // 20 minutes
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.lines.find((line) => line.label === "Today")).toBeTruthy()
      const statusLine = result.lines.find((line) => line.label === "Status")
      expect(statusLine).toBeTruthy()
      expect(statusLine.text).toContain("20m")
      const noteLine = result.lines.find((line) => line.label === "Note")
      expect(noteLine).toBeTruthy()
      expect(noteLine.value).toContain("20m")
    })
  })

  describe("rate limiting (429)", () => {
    it("parses Retry-After HTTP-date header", async () => {
      // Freeze time so HTTP-date parsing is deterministic
      const frozenNow = new Date("2026-04-14T10:00:00.000Z")
      vi.useFakeTimers()
      vi.setSystemTime(frozenNow)
      try {
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        // 15 minutes after frozenNow → expect "~15m"
        ctx.host.http.request.mockReturnValue({
          status: 429,
          bodyText: "",
          headers: { "Retry-After": "Mon, 14 Apr 2026 10:15:00 GMT" },
        })
        const plugin = await loadPlugin()
        const result = plugin.probe(ctx)
        const noteLine = result.lines.find((line) => line.label === "Note")
        expect(noteLine).toBeTruthy()
        expect(noteLine.value).toBe("Live usage rate limited — retry in ~15m")
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not call API again while rate-limit window is active", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        ctx.host.http.request.mockReturnValue({
          status: 429,
          bodyText: "",
          headers: { "Retry-After": "300" }, // 5 minutes
        })
        const plugin = await loadPlugin()

        // First probe — gets 429, stores rateLimitedUntilMs
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(1)

        // Second probe 60 s later — still within window, must NOT call API
        vi.setSystemTime(new Date("2026-04-14T10:01:00.000Z"))
        const result2 = plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(1) // no new request
        const statusLine = result2.lines.find((l) => l.label === "Status")
        expect(statusLine).toBeTruthy()
        expect(statusLine.text).toMatch(/4m/) // ~4 minutes remaining
      } finally {
        vi.useRealTimers()
      }
    })

    it("resumes API calls after rate-limit window expires", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        const usageBody = JSON.stringify({ five_hour: { utilization: 50, resets_at: null } })
        ctx.host.http.request
          .mockReturnValueOnce({ status: 429, bodyText: "", headers: { "Retry-After": "60" } })
          .mockReturnValue({ status: 200, bodyText: usageBody, headers: {} })
        const plugin = await loadPlugin()

        // First probe → 429
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(1)

        // 90 s later — window expired. Usage, profile, and reset grants each request once.
        vi.setSystemTime(new Date("2026-04-14T10:01:30.000Z"))
        const result2 = plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(4)
        // No rate-limited badge after success (amber color = rate-limited)
        expect(result2.lines.find((l) => l.label === "Status" && l.color === "#f59e0b")).toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it("skips API call when minimum fetch interval has not elapsed", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        ctx.host.http.request.mockReturnValue({ status: 200, bodyText: "{}", headers: {} })
        const plugin = await loadPlugin()

        // First probe — usage, then one profile read and one reset-grant read
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(3)

        // 30 s later — within MIN_USAGE_FETCH_INTERVAL_MS (5 min), no new request
        vi.setSystemTime(new Date("2026-04-14T10:00:30.000Z"))
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(3)

        // 5+ minutes later — usage interval elapsed; profile and reset grants stay cached
        vi.setSystemTime(new Date("2026-04-14T10:05:01.000Z"))
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(4)
      } finally {
        vi.useRealTimers()
      }
    })

    it("shows cached plan data while rate-limited", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const successBody = JSON.stringify({
          five_hour: { utilization: 42, resets_at: null },
        })
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        ctx.host.http.request
          .mockReturnValueOnce({ status: 200, bodyText: successBody, headers: {} })
          .mockReturnValue({ status: 429, bodyText: "", headers: { "Retry-After": "300" } })
        const plugin = await loadPlugin()

        // First probe succeeds → data cached
        const result1 = plugin.probe(ctx)
        expect(result1.lines.find((l) => l.label === "Session")).toBeTruthy()

        // Second probe — 429, but cached data is shown alongside rate-limit badge
        vi.setSystemTime(new Date("2026-04-14T10:05:01.000Z")) // past min interval
        const result2 = plugin.probe(ctx)
        expect(result2.lines.find((l) => l.label === "Session")).toBeTruthy()
        expect(result2.lines.find((l) => l.label === "Status")).toBeTruthy()
      } finally {
        vi.useRealTimers()
      }
    })

    it("uses default 5-minute backoff when no Retry-After header on 429", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        ctx.host.fs.readText = () => JSON.stringify({ claudeAiOauth: { accessToken: "token" } })
        ctx.host.fs.exists = () => true
        ctx.host.http.request
          .mockReturnValueOnce({ status: 429, bodyText: "", headers: {} }) // no Retry-After
          .mockReturnValue({ status: 200, bodyText: "{}", headers: {} })
        const plugin = await loadPlugin()

        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(1)

        // 4 min 59 s later — default 5 min backoff still active
        vi.setSystemTime(new Date("2026-04-14T10:04:59.000Z"))
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(1)

        // 5 min 1 s later — backoff expired. Usage, profile, and reset grants each request once.
        vi.setSystemTime(new Date("2026-04-14T10:05:01.000Z"))
        plugin.probe(ctx)
        expect(ctx.host.http.request).toHaveBeenCalledTimes(4)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe("track A resets, dollar credits, and profile plan", () => {
    const USAGE = {
      five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00.000Z" },
    }
    const GRANT_ENDS = "2026-10-22T16:00:00.000Z"
    const CLI_USER_AGENT = "claude-cli/2.1.303 (external, cli)"

    function withCreds(ctx, oauth) {
      ctx.host.fs.exists = () => true
      ctx.host.fs.readText = () =>
        JSON.stringify({
          claudeAiOauth: Object.assign(
            {
              accessToken: "token-a",
              subscriptionType: "max",
              rateLimitTier: "default_claude_max_5x",
            },
            oauth || {},
          ),
        })
    }

    function route(ctx, handlers) {
      ctx.host.http.request.mockImplementation((opts) => {
        const url = String(opts && opts.url)
        if (url.includes("cedar_ember=1")) return handlers.cedar(opts)
        if (url.includes("/api/oauth/profile")) return handlers.profile(opts)
        return handlers.usage(opts)
      })
    }

    function jsonResponse(status, body) {
      return { status, bodyText: JSON.stringify(body), headers: {} }
    }

    function grantFixture(grants, extra) {
      return {
        cedar_ember: Object.assign(
          { eligible: true, ineligible_reason: null, grants: grants },
          extra || {},
        ),
      }
    }

    function resetLine(result) {
      return result.lines.find((line) => line.label === "Rate Limit Resets")
    }

    it("reads reset grants with the Claude CLI user agent and shows the soonest deadline", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, { organization: { rate_limit_tier: "default_claude_max_5x" } }),
        cedar: () =>
          jsonResponse(
            200,
            grantFixture([
              { id: "test-grant-1", resets_left: 1, ends_at: GRANT_ENDS },
              { id: "test-grant-later", resets_left: 2, ends_at: "2026-11-01T00:00:00.000Z" },
              { id: "test-grant-open", resets_left: 4 },
            ]),
          ),
      })

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const cedarCall = ctx.host.http.request.mock.calls.find((call) =>
        String(call[0].url).includes("cedar_ember=1"),
      )
      expect(cedarCall).toBeTruthy()
      expect(String(cedarCall[0].url)).toContain("/api/oauth/usage?cedar_ember=1&skip_spend=1")
      expect(cedarCall[0].method).toBe("GET")
      expect(cedarCall[0].headers["User-Agent"]).toBe(CLI_USER_AGENT)
      expect(cedarCall[0].headers.Authorization).toBe("Bearer token-a")
      expect(cedarCall[0].headers.Accept).toBe("application/json")
      expect(cedarCall[0].headers["Content-Type"]).toBe("application/json")
      expect(cedarCall[0].headers["anthropic-beta"]).toBe("oauth-2025-04-20")

      const usageCall = ctx.host.http.request.mock.calls.find(
        (call) => String(call[0].url).includes("/api/oauth/usage") && !String(call[0].url).includes("cedar_ember"),
      )
      expect(usageCall[0].headers["User-Agent"]).toBe("claude-code/2.1.69")
      expect(ctx.host.http.request.mock.calls.some((call) => String(call[0].url).includes("reset_rate_limits"))).toBe(false)
      expect(ctx.host.http.request.mock.calls.some((call) => call[0].method === "POST")).toBe(false)

      const line = resetLine(result)
      expect(line).toBeTruthy()
      expect(line.type).toBe("text")
      // Host text lines cannot carry resetsAt. The soonest ends_at is baked into the value.
      expect(line.value).toBe("7 available · by Oct 22")
      expect(line.resetsAt).toBeUndefined()
    })

    it("accepts a top-level cedar block and a grant with no deadline", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, {}),
        cedar: () =>
          jsonResponse(200, {
            eligible: true,
            grants: [{ id: "test-grant-1", resets_left: 1 }],
          }),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(resetLine(result).value).toBe("1 available")
    })

    it("shows 0 available when the account is ineligible and has no grants", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, {}),
        cedar: () =>
          jsonResponse(200, {
            cedar_ember: { eligible: false, ineligible_reason: "surface", grants: [] },
          }),
      })
      const plugin = await loadPlugin()
      expect(resetLine(plugin.probe(ctx)).value).toBe("0 available")
    })

    it("shows No data and drops the block when any grant lacks a string id or numeric resets_left", async () => {
      const cases = [
        [{ resets_left: 1, ends_at: GRANT_ENDS }],
        [{ id: "test-grant-1", resets_left: "1" }],
        [
          { id: "test-grant-1", resets_left: 1, ends_at: GRANT_ENDS },
          { id: 15, resets_left: 2 },
        ],
      ]
      const plugin = await loadPlugin()
      for (const grants of cases) {
        const ctx = makeCtx()
        withCreds(ctx)
        route(ctx, {
          usage: () => jsonResponse(200, USAGE),
          profile: () => jsonResponse(200, {}),
          cedar: () => jsonResponse(200, grantFixture(grants)),
        })
        plugin._resetState()
        const result = plugin.probe(ctx)
        expect(resetLine(result).value).toBe("No data")
        expect(JSON.stringify(result)).not.toContain("test-grant-1")
      }
    })

    it("shows No data when the cedar response does not include a grant block", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, {}),
        cedar: () => jsonResponse(200, { five_hour: { utilization: 1 } }),
      })
      const plugin = await loadPlugin()
      expect(resetLine(plugin.probe(ctx)).value).toBe("No data")
    })

    it("asks for reset grants at most once an hour per access token and keeps the last value", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        withCreds(ctx)
        let cedarStatus = 200
        route(ctx, {
          usage: () => jsonResponse(200, USAGE),
          profile: () => jsonResponse(200, {}),
          cedar: () =>
            cedarStatus === 200
              ? jsonResponse(200, grantFixture([{ id: "test-grant-1", resets_left: 1, ends_at: GRANT_ENDS }]))
              : { status: 500, bodyText: "", headers: {} },
        })
        const plugin = await loadPlugin()
        const cedarCalls = () =>
          ctx.host.http.request.mock.calls.filter((call) => String(call[0].url).includes("cedar_ember=1")).length

        expect(resetLine(plugin.probe(ctx)).value).toBe("1 available · by Oct 22")
        expect(cedarCalls()).toBe(1)

        vi.setSystemTime(new Date("2026-04-14T10:30:00.000Z"))
        expect(resetLine(plugin.probe(ctx)).value).toBe("1 available · by Oct 22")
        expect(cedarCalls()).toBe(1)

        vi.setSystemTime(new Date("2026-04-14T11:00:01.000Z"))
        cedarStatus = 500
        expect(resetLine(plugin.probe(ctx)).value).toBe("1 available · by Oct 22")
        expect(cedarCalls()).toBe(2)
        expect(ctx.host.log.warn.mock.calls.some((call) => String(call[0]).includes("reset grants"))).toBe(true)

        withCreds(ctx, { accessToken: "token-b" })
        cedarStatus = 200
        expect(resetLine(plugin.probe(ctx)).value).toBe("1 available · by Oct 22")
        expect(cedarCalls()).toBe(3)
        const lastCedar = ctx.host.http.request.mock.calls.filter((call) =>
          String(call[0].url).includes("cedar_ember=1"),
        ).at(-1)
        expect(lastCedar[0].headers.Authorization).toBe("Bearer token-b")
      } finally {
        vi.useRealTimers()
      }
    })

    it("logs a failed first reset-grant read and does not invent a count", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, {}),
        cedar: () => {
          throw new Error("socket closed")
        },
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(resetLine(result)).toBeUndefined()
      expect(result.lines.find((line) => line.label === "Session")).toBeTruthy()
      expect(ctx.host.log.warn.mock.calls.some((call) => String(call[0]).includes("reset grants"))).toBe(true)
    })

    it("renders dollar credit lines and skips extra usage and spend", async () => {
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () =>
          jsonResponse(200, {
            five_hour: USAGE.five_hour,
            iguana_necktie: {
              limit_dollars: 250,
              used_dollars: 0,
              resets_at: "2026-11-05T07:59:00.000Z",
            },
            cinder_cove: { limit_dollars: 40, used_dollars: 12.5, resets_at: "2026-12-01T00:00:00.000Z" },
            wattle_ember: { label: "Launch Credit", limit_dollars: 15, resets_at: "2026-12-15T00:00:00.000Z" },
            second_credit: { limit_dollars: 8, used_dollars: 1 },
            labeled_again: { label: "Launch Credit", limit_dollars: 3, used_dollars: 0 },
            empty_label: { label: "   ", limit_dollars: 6, used_dollars: 2 },
            seven_day_sonnet: null,
            extra_usage: { is_enabled: true, used_credits: 500, monthly_limit: 1000, limit_dollars: 999 },
            spend: { limit_dollars: 50, used_dollars: 4, resets_at: "2026-12-01T00:00:00.000Z" },
          }),
        profile: () => jsonResponse(200, {}),
        cedar: () => jsonResponse(200, { cedar_ember: null }),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const credits = result.lines.filter((line) => line.format && line.format.kind === "dollars" && line.label !== "Extra usage spent")
      expect(credits.map((line) => line.label)).toEqual([
        "Cloud Credit",
        "Claude Code And Cowork Credit",
        "Launch Credit",
        "Credit",
        "Launch Credit 2",
        "Credit 2",
      ])
      expect(credits[0]).toMatchObject({
        type: "progress",
        used: 0,
        limit: 250,
        format: { kind: "dollars" },
        resetsAt: "2026-11-05T07:59:00.000Z",
      })
      expect(credits[1].used).toBe(12.5)
      expect(credits[1].limit).toBe(40)
      expect(credits[2].used).toBe(0)
      expect(credits[2].resetsAt).toBe("2026-12-15T00:00:00.000Z")
      expect(result.lines.find((line) => line.label === "Extra usage spent")).toBeTruthy()
      expect(result.lines.some((line) => line.limit === 999 || line.limit === 50)).toBe(false)
    })

    it("uses the profile rate limit tier after a successful usage fetch, once per access token", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        withCreds(ctx, { subscriptionType: "pro", rateLimitTier: "default_claude_max_5x" })
        let usageStatus = 429
        route(ctx, {
          usage: () =>
            usageStatus === 200
              ? jsonResponse(200, USAGE)
              : { status: 429, bodyText: "", headers: { "Retry-After": "60" } },
          profile: (opts) => {
            expect(opts.method).toBe("GET")
            expect(String(opts.url)).toContain("/api/oauth/profile")
            expect(opts.headers["User-Agent"]).toBe("claude-code/2.1.69")
            expect(opts.headers.Authorization).toBe("Bearer token-a")
            return jsonResponse(200, {
              organization: {
                rate_limit_tier: "default_claude_max_20x",
                uuid: "11111111-2222-4333-8444-555555555555",
                email: "person@example.com",
              },
            })
          },
          cedar: () => jsonResponse(200, grantFixture([{ id: "test-grant-1", resets_left: 1 }])),
        })
        const plugin = await loadPlugin()
        const profileCalls = () =>
          ctx.host.http.request.mock.calls.filter((call) => String(call[0].url).includes("/api/oauth/profile")).length

        const blocked = plugin.probe(ctx)
        expect(profileCalls()).toBe(0)
        expect(blocked.plan).toBe("Pro 5x")

        vi.setSystemTime(new Date("2026-04-14T10:01:30.000Z"))
        usageStatus = 200
        const live = plugin.probe(ctx)
        expect(live.plan).toBe("Max 20x")
        expect(profileCalls()).toBe(1)

        vi.setSystemTime(new Date("2026-04-14T10:08:00.000Z"))
        expect(plugin.probe(ctx).plan).toBe("Max 20x")
        expect(profileCalls()).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("falls back to the saved credential plan when the profile cannot be read", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        withCreds(ctx)
        route(ctx, {
          usage: () => jsonResponse(200, USAGE),
          profile: () => ({ status: 503, bodyText: "", headers: {} }),
          cedar: () => jsonResponse(200, { cedar_ember: { eligible: false } }),
        })
        const plugin = await loadPlugin()
        const profileCalls = () =>
          ctx.host.http.request.mock.calls.filter((call) => String(call[0].url).includes("/api/oauth/profile")).length

        expect(plugin.probe(ctx).plan).toBe("Max 5x")
        expect(profileCalls()).toBe(1)
        expect(ctx.host.log.warn.mock.calls.some((call) => String(call[0]).includes("profile"))).toBe(true)

        vi.setSystemTime(new Date("2026-04-14T11:30:00.000Z"))
        expect(plugin.probe(ctx).plan).toBe("Max 5x")
        expect(profileCalls()).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not put event props, grant ids, organization ids, or emails on the probe output", async () => {
      const secretEvent = "event-prop-do-not-leak"
      const grantId = "test-grant-1"
      const orgId = "11111111-2222-4333-8444-555555555555"
      const email = "person@example.com"
      const ctx = makeCtx()
      withCreds(ctx)
      route(ctx, {
        usage: () =>
          jsonResponse(200, {
            five_hour: USAGE.five_hour,
            event_props: { campaign: secretEvent, email: email },
            iguana_necktie: { limit_dollars: 250, used_dollars: 0, label: "Pool Credit" },
          }),
        profile: () =>
          jsonResponse(200, {
            organization: { uuid: orgId, rate_limit_tier: "default_claude_max_20x", name: email },
            email: email,
          }),
        cedar: () =>
          jsonResponse(
            200,
            grantFixture(
              [{ id: grantId, resets_left: 1, ends_at: GRANT_ENDS }],
              { next_grant_id: grantId, event_props: { id: orgId } },
            ),
          ),
      })
      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      expect(result.plan).toBe("Max 20x")
      expect(resetLine(result).value).toBe("1 available · by Oct 22")
      expect(result.lines.find((line) => line.label === "Pool Credit")).toBeTruthy()
      const encoded = JSON.stringify(result)
      expect(encoded).not.toContain(secretEvent)
      expect(encoded).not.toContain(grantId)
      expect(encoded).not.toContain(orgId)
      expect(encoded).not.toContain(email)
      expect(encoded).not.toContain("event_props")
    })

    const LIVE_CACHE_TOKEN = "sk-ant-live-cache-SECRET-token-value"
    const LIVE_CACHE_PATH_SUFFIX = "/live-cache.json"

    function seedFileCreds(ctx, accessToken) {
      ctx.host.fs.writeText(
        "~/.claude/.credentials.json",
        JSON.stringify({
          claudeAiOauth: {
            accessToken: accessToken,
            subscriptionType: "max",
            rateLimitTier: "default_claude_max_5x",
          },
        }),
      )
    }

    function liveCacheText(ctx) {
      return ctx.host.fs.readText(ctx.app.pluginDataDir + LIVE_CACHE_PATH_SUFFIX)
    }

    function countUrl(ctx, part) {
      return ctx.host.http.request.mock.calls.filter((call) => String(call[0].url).includes(part)).length
    }

    it("reuses the saved reset grant and profile plan after a fresh worker within one hour", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        seedFileCreds(ctx, LIVE_CACHE_TOKEN)
        let resetsLeft = 1
        let tier = "default_claude_max_20x"
        route(ctx, {
          usage: () => jsonResponse(200, USAGE),
          profile: () => jsonResponse(200, { organization: { rate_limit_tier: tier } }),
          cedar: () =>
            jsonResponse(200, grantFixture([{ id: "test-grant-1", resets_left: resetsLeft, ends_at: GRANT_ENDS }])),
        })
        const plugin = await loadPlugin()

        const first = plugin.probe(ctx)
        expect(resetLine(first).value).toBe("1 available · by Oct 22")
        expect(first.plan).toBe("Max 20x")
        expect(countUrl(ctx, "cedar_ember=1")).toBe(1)
        expect(countUrl(ctx, "/api/oauth/profile")).toBe(1)

        resetsLeft = 9
        tier = "default_claude_pro"
        plugin._resetState()
        vi.setSystemTime(new Date("2026-04-14T10:30:00.000Z"))
        const second = plugin.probe(ctx)

        expect(countUrl(ctx, "cedar_ember=1")).toBe(1)
        expect(countUrl(ctx, "/api/oauth/profile")).toBe(1)
        expect(resetLine(second).value).toBe("1 available · by Oct 22")
        expect(second.plan).toBe("Max 20x")
      } finally {
        vi.useRealTimers()
      }
    })

    it("does not write the access token into the live cache file", async () => {
      const ctx = makeCtx()
      seedFileCreds(ctx, LIVE_CACHE_TOKEN)
      route(ctx, {
        usage: () => jsonResponse(200, USAGE),
        profile: () => jsonResponse(200, { organization: { rate_limit_tier: "default_claude_max_20x" } }),
        cedar: () =>
          jsonResponse(200, grantFixture([{ id: "test-grant-1", resets_left: 1, ends_at: GRANT_ENDS }])),
      })
      const plugin = await loadPlugin()
      plugin.probe(ctx)

      const cacheText = liveCacheText(ctx)
      const hash = crypto.createHash("sha256").update(LIVE_CACHE_TOKEN).digest("hex")
      expect(typeof cacheText).toBe("string")
      const saved = JSON.parse(cacheText)
      expect(saved.resetGrants[hash]).toMatchObject({ text: "1 available · by Oct 22" })
      expect(saved.profilePlans[hash]).toBe("Max 20x")
      expect(cacheText).not.toContain(LIVE_CACHE_TOKEN)
    })

    it("asks for reset grants again after more than one hour across a fresh worker", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-14T10:00:00.000Z"))
      try {
        const ctx = makeCtx()
        seedFileCreds(ctx, LIVE_CACHE_TOKEN)
        route(ctx, {
          usage: () => jsonResponse(200, USAGE),
          profile: () => jsonResponse(200, { organization: { rate_limit_tier: "default_claude_max_20x" } }),
          cedar: () =>
            jsonResponse(200, grantFixture([{ id: "test-grant-1", resets_left: 1, ends_at: GRANT_ENDS }])),
        })
        const plugin = await loadPlugin()

        plugin.probe(ctx)
        expect(countUrl(ctx, "cedar_ember=1")).toBe(1)

        plugin._resetState()
        vi.setSystemTime(new Date("2026-04-14T10:30:00.000Z"))
        plugin.probe(ctx)
        expect(countUrl(ctx, "cedar_ember=1")).toBe(1)
        expect(countUrl(ctx, "/api/oauth/profile")).toBe(1)

        plugin._resetState()
        vi.setSystemTime(new Date("2026-04-14T11:00:00.001Z"))
        plugin.probe(ctx)
        expect(countUrl(ctx, "cedar_ember=1")).toBe(2)
        expect(countUrl(ctx, "/api/oauth/profile")).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
