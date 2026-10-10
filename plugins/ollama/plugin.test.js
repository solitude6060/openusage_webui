import crypto from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const KEY_PATH = "~/.ollama/id_ed25519"
const NOW_ISO = "2023-11-14T22:13:20.000Z" // unix seconds 1700000000
const BALANCE_URL = "https://ollama.com/api/balance?ts=1700000000"
const ME_URL = "https://ollama.com/api/me?ts=1700000000"
const PLAN_WARNING = "Couldn't read your Ollama plan. Usage below is still up to date."

const MSG_MISSING = "No Ollama key found. Install Ollama and run `ollama signin` to track cloud usage."
const MSG_UNREADABLE = "Couldn't read ~/.ollama/id_ed25519. Check the file's permissions."
const MSG_INVALID_KEY = "~/.ollama/id_ed25519 isn't a usable Ollama signing key."
const MSG_NOT_SIGNED_IN = "Not signed in to Ollama Cloud. Run `ollama signin` to see usage."
const MSG_CONNECTION = "Usage request failed. Check your connection."
const MSG_INVALID_RESPONSE = "Usage response invalid. Try again later."

const LEGACY_BALANCE = {
  included: {
    session: { remaining_percent: 75, resets_at: "2026-10-01T07:00:00Z" },
    weekly: { remaining_percent: 40, resets_at: "2026-10-05T00:00:00Z" },
  },
  purchased: { balance_usd: 25 },
}
const MONTHLY_BALANCE = {
  included: {
    balance_usd: 72.5,
    allowance_usd: 100,
    period: { from: "2026-09-15T09:30:00Z", until: "2026-10-15T09:30:00Z" },
  },
  purchased: { balance_usd: 25 },
}
// Called directly, ollama.com capitalizes the keys of /api/me.
const ME_BODY = { ID: "id-5f3a9c1b", Email: "alice.secret@example.com", Name: "alice-secret-name", Plan: "pro" }

// --- Test key: an unencrypted OpenSSH ed25519 container built per run (no key is committed). ---

const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const sshString = (value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")
  return Buffer.concat([u32(bytes.length), bytes])
}

function makeKey(opts = {}) {
  const jwk = crypto.generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" })
  const seed = Buffer.from(jwk.d, "base64url")
  const pub = Buffer.from(jwk.x, "base64url")
  const keyType = opts.keyType ?? "ssh-ed25519"
  const publicKeyBlob = Buffer.concat([sshString(keyType), sshString(opts.declaredPublicKey ?? pub)])

  let priv = Buffer.concat([
    u32(0x12345678),
    u32(0x12345678),
    sshString(keyType),
    sshString(pub),
    sshString(opts.privateBlob ?? Buffer.concat([seed, opts.privatePublicHalf ?? pub])),
    sshString(""),
  ])
  for (let pad = 1; priv.length % 8 !== 0; pad++) priv = Buffer.concat([priv, Buffer.from([pad])])

  const blob = Buffer.concat([
    Buffer.from(opts.magic ?? "openssh-key-v1\0", "latin1"),
    sshString(opts.cipher ?? "none"),
    sshString(opts.kdf ?? "none"),
    sshString(""),
    u32(opts.keyCount ?? 1),
    sshString(publicKeyBlob),
    sshString(priv),
  ])
  const body = blob.toString("base64")
  const wrapped = body.match(/.{1,64}/g).join("\n")
  return {
    pem: `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`,
    body,
    seed,
    pub,
    publicKeyBlobBase64: publicKeyBlob.toString("base64"),
    publicKeyObject: crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" }),
  }
}

const json = (value) => ({ status: 200, headers: {}, bodyText: JSON.stringify(value) })
const status = (code, bodyText = "") => ({ status: code, headers: {}, bodyText })

// Routes by path so the required balance call and the best-effort account call can differ.
function routeHttp(ctx, { balance = json(LEGACY_BALANCE), me = json(ME_BODY) } = {}) {
  ctx.host.http.request.mockImplementation((opts) => {
    const reply = new URL(opts.url).pathname === "/api/balance" ? balance : me
    if (reply instanceof Error) throw reply
    return reply
  })
}

const labels = (result) => result.lines.map((line) => line.label)
const lineByLabel = (result, label) => result.lines.find((line) => line.label === label)

function allLogText(ctx) {
  return ["trace", "debug", "info", "warn", "error"]
    .flatMap((level) => ctx.host.log[level].mock.calls.map((args) => args.map(String).join(" ")))
    .join("\n")
}

describe("ollama plugin", () => {
  let ctx
  let plugin
  let key

  const withKey = (k = key) => ctx.host.fs.writeText(KEY_PATH, k.pem)
  const probeError = (c = ctx) => {
    try {
      plugin.probe(c)
    } catch (e) {
      return String(e)
    }
    throw new Error("probe did not throw")
  }

  beforeEach(async () => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
    await import("./plugin.js")
    plugin = globalThis.__openusage_plugin
    ctx = makeCtx()
    ctx.nowIso = NOW_ISO
    key = makeKey()
    withKey()
    routeHttp(ctx)
  })

  it("registers as the ollama plugin", () => {
    expect(plugin.id).toBe("ollama")
  })

  describe("signing key", () => {
    it("reads ~/.ollama/id_ed25519 and succeeds with a valid unencrypted key", () => {
      expect(() => plugin.probe(ctx)).not.toThrow()
    })

    it("reports a missing key without any network call", () => {
      ctx = makeCtx()
      ctx.nowIso = NOW_ISO
      expect(probeError()).toBe(MSG_MISSING)
      expect(ctx.host.http.request).not.toHaveBeenCalled()
    })

    it("treats a whitespace-only key file as missing", () => {
      ctx.host.fs.writeText(KEY_PATH, " \n\n")
      expect(probeError()).toBe(MSG_MISSING)
    })

    it("reports an unreadable key file by its permissions, not as a logout", () => {
      ctx.host.fs.readText = () => {
        throw new Error("EACCES: permission denied")
      }
      expect(probeError()).toBe(MSG_UNREADABLE)
      expect(ctx.host.http.request).not.toHaveBeenCalled()
    })

    const badKeys = {
      garbage: () => "not a key at all",
      "wrong container": () => "-----BEGIN OPENSSH PRIVATE KEY-----\nZm9v\n-----END OPENSSH PRIVATE KEY-----",
      "truncated body": () => {
        const k = makeKey()
        const half = k.body.slice(0, Math.floor(k.body.length / 2))
        return `-----BEGIN OPENSSH PRIVATE KEY-----\n${half}\n-----END OPENSSH PRIVATE KEY-----`
      },
      "wrong magic": () => makeKey({ magic: "openssh-key-v2\0" }).pem,
      "encrypted (aes256-ctr + bcrypt)": () => makeKey({ cipher: "aes256-ctr", kdf: "bcrypt" }).pem,
      "two keys in one file": () => makeKey({ keyCount: 2 }).pem,
      "not an ed25519 key": () => makeKey({ keyType: "ssh-rsa" }).pem,
      "private blob not 64 bytes": () => makeKey({ privateBlob: Buffer.alloc(40, 1) }).pem,
      "private section public half differs": () =>
        makeKey({ privatePublicHalf: crypto.randomBytes(32) }).pem,
      // The outer public key is what the Authorization header carries; a mismatch would sign
      // correctly and then be rejected as "not signed in", which signing in again cannot fix.
      "outer public key differs from the private half": () =>
        makeKey({ declaredPublicKey: crypto.randomBytes(32) }).pem,
    }
    for (const [name, build] of Object.entries(badKeys)) {
      it(`rejects ${name} as an unusable key without calling the network`, () => {
        ctx.host.fs.writeText(KEY_PATH, build())
        expect(probeError()).toBe(MSG_INVALID_KEY)
        expect(ctx.host.http.request).not.toHaveBeenCalled()
      })
    }

    it("reports a clear error when the host cannot sign (Tauri desktop host)", () => {
      delete ctx.host.crypto.ed25519Sign
      const message = probeError()
      expect(message).toContain("WebUI")
      expect(message).toContain("Ed25519")
      expect(ctx.host.http.request).not.toHaveBeenCalled()
    })
  })

  describe("signed requests", () => {
    it("signs GET /api/balance and POST /api/me with the SSH public key blob and the right challenge", () => {
      plugin.probe(ctx)

      const calls = ctx.host.http.request.mock.calls.map(([opts]) => opts)
      expect(calls.map((c) => [c.method, c.url])).toEqual([
        ["GET", BALANCE_URL],
        ["POST", ME_URL],
      ])
      for (const call of calls) {
        expect(call.timeoutMs).toBe(15000)
        expect(call.headers.Accept).toBe("application/json")
        const separator = call.headers.Authorization.indexOf(":")
        const blob = call.headers.Authorization.slice(0, separator)
        const signature = Buffer.from(call.headers.Authorization.slice(separator + 1), "base64")
        expect(blob).toBe(key.publicKeyBlobBase64)
        expect(Buffer.from(blob, "base64")).toHaveLength(51)
        const path = new URL(call.url).pathname + new URL(call.url).search
        expect(crypto.verify(null, Buffer.from(`${call.method},${path}`), key.publicKeyObject, signature)).toBe(true)
      }
    })

    it("takes the timestamp from ctx.nowIso", () => {
      ctx.nowIso = "2026-02-02T00:00:00.000Z"
      plugin.probe(ctx)
      expect(ctx.host.http.request.mock.calls[0][0].url).toBe("https://ollama.com/api/balance?ts=1769990400")
    })

    it("has no OLLAMA_API_KEY Bearer path", () => {
      ctx.host.env.get.mockImplementation((name) => (name === "OLLAMA_API_KEY" ? "env-token" : null))
      plugin.probe(ctx)
      for (const [opts] of ctx.host.http.request.mock.calls) {
        expect(opts.headers.Authorization).not.toMatch(/Bearer|env-token/)
      }
      expect(ctx.host.env.get).not.toHaveBeenCalledWith("OLLAMA_API_KEY")
    })
  })

  describe("usage mapping", () => {
    it("maps a legacy plan to Session, Weekly and Purchased Credits", () => {
      const result = plugin.probe(ctx)

      expect(result.plan).toBe("Pro")
      expect(result.lines).toEqual([
        {
          type: "progress",
          label: "Session",
          used: 25,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: "2026-10-01T07:00:00.000Z",
          periodDurationMs: 5 * 60 * 60 * 1000,
        },
        {
          type: "progress",
          label: "Weekly",
          used: 60,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: "2026-10-05T00:00:00.000Z",
          periodDurationMs: 7 * 24 * 60 * 60 * 1000,
        },
        { type: "text", label: "Purchased Credits", value: "$25.00" },
      ])
    })

    it("maps a current plan to Monthly credits and Purchased Credits", () => {
      routeHttp(ctx, { balance: json(MONTHLY_BALANCE) })
      const result = plugin.probe(ctx)

      expect(result.lines).toEqual([
        {
          type: "progress",
          label: "Monthly",
          used: 27.5,
          limit: 100,
          format: { kind: "dollars" },
          resetsAt: "2026-10-15T09:30:00.000Z",
          periodDurationMs: 30 * 24 * 60 * 60 * 1000,
        },
        { type: "text", label: "Purchased Credits", value: "$25.00" },
      ])
    })

    it("orders every row Session, Weekly, Monthly, Purchased Credits", () => {
      routeHttp(ctx, {
        balance: json({
          included: {
            session: { remaining_percent: 90 },
            weekly: { remaining_percent: 80 },
            balance_usd: 10,
            allowance_usd: 60,
          },
          purchased: { balance_usd: 0 },
        }),
      })
      expect(labels(plugin.probe(ctx))).toEqual(["Session", "Weekly", "Monthly", "Purchased Credits"])
    })

    it("keeps unused and overspent allowances inside the meter", () => {
      routeHttp(ctx, { balance: json({ included: { balance_usd: 60, allowance_usd: 60 } }) })
      expect(lineByLabel(plugin.probe(ctx), "Monthly")).toMatchObject({ used: 0, limit: 60 })

      routeHttp(ctx, { balance: json({ included: { balance_usd: -5, allowance_usd: 60 } }) })
      expect(lineByLabel(plugin.probe(ctx), "Monthly")).toMatchObject({ used: 60, limit: 60 })
    })

    it("omits the period when the reset time is missing or the period is not positive", () => {
      routeHttp(ctx, {
        balance: json({ included: { weekly: { remaining_percent: 50 }, balance_usd: 10, allowance_usd: 60 } }),
      })
      const result = plugin.probe(ctx)
      expect(result.lines).toEqual([
        { type: "progress", label: "Weekly", used: 50, limit: 100, format: { kind: "percent" } },
        { type: "progress", label: "Monthly", used: 50, limit: 60, format: { kind: "dollars" } },
      ])

      routeHttp(ctx, {
        balance: json({
          included: {
            balance_usd: 10,
            allowance_usd: 60,
            period: { from: "2026-10-15T09:30:00Z", until: "2026-09-15T09:30:00Z" },
          },
        }),
      })
      const monthly = lineByLabel(plugin.probe(ctx), "Monthly")
      expect(monthly.resetsAt).toBe("2026-09-15T09:30:00.000Z")
      expect(monthly.periodDurationMs).toBeUndefined()
    })

    it("does not invent a Monthly meter from a missing or unusable allowance", () => {
      for (const extra of [
        { balance_usd: 10 },
        { allowance_usd: 60 },
        { balance_usd: 10, allowance_usd: 0 },
        { balance_usd: "x", allowance_usd: 60 },
      ]) {
        routeHttp(ctx, { balance: json({ included: { weekly: { remaining_percent: 50 }, ...extra } }) })
        expect(labels(plugin.probe(ctx))).toEqual(["Weekly"])
      }
    })

    it("accepts numeric strings but not booleans for numbers", () => {
      routeHttp(ctx, {
        balance: json({ included: { balance_usd: "40", allowance_usd: " 100 " }, purchased: { balance_usd: true } }),
      })
      const result = plugin.probe(ctx)
      expect(lineByLabel(result, "Monthly")).toMatchObject({ used: 60, limit: 100 })
      expect(lineByLabel(result, "Purchased Credits")).toBeUndefined()
    })

    it("clamps legacy percent into 0-100", () => {
      routeHttp(ctx, {
        balance: json({ included: { session: { remaining_percent: 130 }, weekly: { remaining_percent: -20 } } }),
      })
      const result = plugin.probe(ctx)
      expect(lineByLabel(result, "Session").used).toBe(0)
      expect(lineByLabel(result, "Weekly").used).toBe(100)
    })

    it("shows a real zero of purchased credits and floors negatives at zero", () => {
      routeHttp(ctx, { balance: json({ ...MONTHLY_BALANCE, purchased: { balance_usd: -3 } }) })
      expect(lineByLabel(plugin.probe(ctx), "Purchased Credits")).toMatchObject({ value: "$0.00" })

      routeHttp(ctx, { balance: json({ included: MONTHLY_BALANCE.included }) })
      expect(lineByLabel(plugin.probe(ctx), "Purchased Credits")).toBeUndefined()
    })

    it("fails loudly on a body without a readable allowance", () => {
      for (const body of [
        "not json",
        "[]",
        JSON.stringify({ limits: { session: { usage: 0.349 } } }),
        JSON.stringify({ purchased: { balance_usd: 25 } }),
        JSON.stringify({ included: {}, purchased: { balance_usd: 25 } }),
      ]) {
        routeHttp(ctx, { balance: status(200, body) })
        expect(probeError()).toBe(MSG_INVALID_RESPONSE)
      }
    })
  })

  describe("plan", () => {
    const planFor = (me) => {
      routeHttp(ctx, { me })
      return plugin.probe(ctx)
    }

    it("title-cases the plan and accepts both key spellings", () => {
      expect(planFor(status(200, '{"Plan":"pro"}')).plan).toBe("Pro")
      expect(planFor(status(200, '{"plan":"max"}')).plan).toBe("Max")
      expect(planFor(status(200, '{"Plan":"  FREE  "}')).plan).toBe("Free")
    })

    it("treats an explicitly empty plan as an account without one, with no warning", () => {
      const result = planFor(status(200, '{"Name":"x","Plan":""}'))
      expect(result.plan == null).toBe(true)
      expect(labels(result)).not.toContain("Status")
    })

    it("warns once, above the meters, when the plan response cannot be read", () => {
      for (const body of ["not json", "[]", '{"Name":"user"}', '{"Plan":42}']) {
        const result = planFor(status(200, body))
        expect(result.plan == null).toBe(true)
        expect(result.lines[0]).toEqual({ type: "badge", label: "Status", text: PLAN_WARNING, color: "#f59e0b" })
        expect(labels(result).slice(1)).toEqual(["Session", "Weekly", "Purchased Credits"])
        expect(labels(result).filter((l) => l === "Status")).toHaveLength(1)
      }
    })

    it("keeps the meters and shows the same warning when the plan request fails", () => {
      for (const me of [status(500), status(401), new Error("socket hang up")]) {
        const result = planFor(me)
        expect(result.plan == null).toBe(true)
        expect(result.lines[0]).toMatchObject({ type: "badge", label: "Status", text: PLAN_WARNING })
        expect(labels(result).slice(1)).toEqual(["Session", "Weekly", "Purchased Credits"])
      }
    })

    it("logs the failed plan lookup and shows no warning on success", () => {
      planFor(status(500))
      expect(ctx.host.log.warn).toHaveBeenCalled()
      expect(labels(planFor(json(ME_BODY)))).not.toContain("Status")
    })
  })

  describe("errors", () => {
    it("reports 401 and 403 from /api/balance as not signed in", () => {
      for (const code of [401, 403]) {
        routeHttp(ctx, { balance: status(code) })
        expect(probeError()).toBe(MSG_NOT_SIGNED_IN)
      }
    })

    it("reports other non-2xx statuses with the code", () => {
      routeHttp(ctx, { balance: status(503) })
      expect(probeError()).toBe("Usage request failed (HTTP 503). Try again later.")
    })

    it("reports a transport failure as a connection problem", () => {
      routeHttp(ctx, { balance: new Error("getaddrinfo ENOTFOUND ollama.com") })
      expect(probeError()).toBe(MSG_CONNECTION)
    })
  })

  describe("secret handling", () => {
    // Every channel a secret could leave the plugin through: log calls, the thrown message and
    // the returned snapshot. The host never logs request headers, so the plugin must not either.
    const scenarios = {
      success: () => {},
      "plan lookup fails": (c) => routeHttp(c, { me: status(500) }),
      "plan unreadable": (c) => routeHttp(c, { me: status(200, "not json") }),
      "not signed in": (c) => routeHttp(c, { balance: status(401) }),
      "server error": (c) => routeHttp(c, { balance: status(500, "oops") }),
      "invalid balance body": (c) => routeHttp(c, { balance: status(200, "{}") }),
    }

    function secretsOf(k, ctxInstance) {
      const headers = ctxInstance.host.http.request.mock.calls.map(([opts]) => opts.headers.Authorization)
      const signatures = headers.map((h) => h.slice(h.indexOf(":") + 1))
      return [
        k.body,
        k.pem.split("\n")[1],
        k.seed.toString("base64"),
        k.seed.toString("hex"),
        k.seed.toString("base64url"),
        ...headers,
        ...signatures,
      ]
    }

    for (const [name, arrange] of Object.entries(scenarios)) {
      it(`never emits key material, signatures or account fields (${name})`, () => {
        arrange(ctx)
        let outcome
        try {
          outcome = JSON.stringify(plugin.probe(ctx))
        } catch (e) {
          outcome = String(e)
        }
        const channels = [allLogText(ctx), outcome]
        const secrets = [...secretsOf(key, ctx), "alice.secret@example.com", "alice-secret-name", "id-5f3a9c1b"]

        expect(ctx.host.http.request).toHaveBeenCalled()
        for (const secret of secrets) {
          expect(secret.length).toBeGreaterThan(8)
          for (const channel of channels) expect(channel).not.toContain(secret)
        }
        for (const channel of channels) {
          expect(channel).not.toContain("BEGIN OPENSSH PRIVATE KEY")
        }
      })
    }

    it("does not forward exception text from the host (a host error could echo headers or the seed)", () => {
      const seedB64 = key.seed.toString("base64")
      ctx.host.http.request.mockImplementation((opts) => {
        throw new Error(`request failed ${JSON.stringify(opts.headers)} seed=${seedB64}`)
      })
      expect(probeError()).toBe(MSG_CONNECTION)
      expect(allLogText(ctx)).not.toContain(seedB64)
      expect(allLogText(ctx)).not.toContain("Authorization")
    })

    it("does not forward exception text from a failing signer", () => {
      const seedB64 = key.seed.toString("base64")
      ctx.host.crypto.ed25519Sign.mockImplementation(() => {
        throw new Error(`cannot sign with ${seedB64}`)
      })
      expect(probeError()).toBe(MSG_INVALID_KEY)
      expect(allLogText(ctx)).not.toContain(seedB64)
      expect(ctx.host.http.request).not.toHaveBeenCalled()
    })

    it("never logs a response body", () => {
      routeHttp(ctx, { balance: json({ ...LEGACY_BALANCE, marker: "BODY-MARKER-77" }), me: status(500, "ME-BODY-MARKER") })
      plugin.probe(ctx)
      expect(allLogText(ctx)).not.toMatch(/BODY-MARKER-77|ME-BODY-MARKER/)
    })
  })
})
