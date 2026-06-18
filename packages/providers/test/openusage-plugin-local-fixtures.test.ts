import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpenUsagePluginProvider } from "../src/index";
import {
  createJwt,
  notFoundResponse,
  readPluginScript,
  requestByUrl,
  withIsolatedHome,
  writeJson,
} from "./openusage-plugin-fixture-helpers";

describe("OpenUsagePluginProvider original local plugin fixtures", () => {
  test("adapts the original Amp plugin through local secrets and API response", async () => {
    await withIsolatedHome(async (home) => {
      writeJson(join(home, ".local/share/amp/secrets.json"), {
        "apiKey@https://ampcode.com/": "amp-token",
      });
      const provider = new OpenUsagePluginProvider({
        providerId: "amp",
        name: "Amp",
        pluginId: "amp",
        homeDir: home,
        scriptText: readPluginScript("amp"),
        request: requestByUrl({
          "https://ampcode.com/api/internal": {
            ok: true,
            result: {
              displayText: "Amp Free: $10/$20 remaining (replenishes +$1/hour)",
            },
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "amp",
        plan: "Free",
        lines: [{ type: "progress", label: "Free", used: 10, limit: 20 }],
      });
    });
  });

  test("adapts the original Cursor plugin through SQLite auth and dashboard APIs", async () => {
    await withIsolatedHome(async (home) => {
      const dbPath = join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
      mkdirSync(resolve(dbPath, ".."), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
      db.query("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("cursorAuth/accessToken", "cursor-token");
      db.close();
      const provider = new OpenUsagePluginProvider({
        providerId: "cursor",
        name: "Cursor",
        pluginId: "cursor",
        homeDir: home,
        scriptText: readPluginScript("cursor"),
        request: requestByUrl({
          "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage": {
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
            billingCycleEnd: "1775234693029",
          },
          "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo": {
            planInfo: { planName: "Pro" },
          },
          "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCreditGrantsBalance": {
            hasCreditGrants: false,
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "cursor",
        plan: "Pro",
        lines: [{ type: "progress", label: "Total usage", used: 50, limit: 100 }],
      });
    });
  });

  test("adapts the original Devin plugin through local credentials", async () => {
    await withIsolatedHome(async (home) => {
      const credentialsPath = join(home, ".local/share/devin/credentials.toml");
      mkdirSync(resolve(credentialsPath, ".."), { recursive: true });
      writeFileSync(
        credentialsPath,
        'windsurf_api_key = "devin-session-token$cli"\napi_server_url = "https://server.codeium.test"\n',
      );
      const provider = new OpenUsagePluginProvider({
        providerId: "devin",
        name: "Devin",
        pluginId: "devin",
        homeDir: home,
        scriptText: readPluginScript("devin"),
        request: requestByUrl({
          "https://server.codeium.test/exa.seat_management_pb.SeatManagementService/GetUserStatus": {
            userStatus: {
              planStatus: {
                planInfo: { planName: "Max" },
                dailyQuotaRemainingPercent: 100,
                weeklyQuotaRemainingPercent: 40,
                overageBalanceMicros: "964220000",
                dailyQuotaResetAtUnix: 1770623326,
                weeklyQuotaResetAtUnix: 1772956800,
              },
            },
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "devin",
        plan: "Max",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
        "Daily quota",
        "Weekly quota",
        "Extra usage balance",
      ]);
    });
  });

  test("adapts the original Factory plugin through local auth and usage API", async () => {
    await withIsolatedHome(async (home) => {
      writeJson(join(home, ".factory/auth.json"), {
        access_token: createJwt({ exp: 4102444800 }),
        refresh_token: "refresh",
      });
      const provider = new OpenUsagePluginProvider({
        providerId: "factory",
        name: "Factory",
        pluginId: "factory",
        homeDir: home,
        scriptText: readPluginScript("factory"),
        request: requestByUrl({
          "https://api.factory.ai/api/organization/subscription/usage": {
            usage: {
              startDate: 1770623326000,
              endDate: 1772956800000,
              standard: { orgTotalTokensUsed: 5_000_000, totalAllowance: 20_000_000 },
              premium: { orgTotalTokensUsed: 0, totalAllowance: 0 },
            },
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "factory",
        plan: "Pro",
        lines: [{ type: "progress", label: "Standard", used: 5_000_000, limit: 20_000_000 }],
      });
    });
  });

  test("adapts the original Grok plugin through auth file and billing APIs", async () => {
    await withIsolatedHome(async (home) => {
      writeJson(join(home, ".grok/auth.json"), {
        "https://auth.x.ai::client": {
          key: "grok-token",
          email: "user@example.com",
          expires_at: "2099-01-01T00:00:00Z",
        },
      });
      const provider = new OpenUsagePluginProvider({
        providerId: "grok",
        name: "Grok",
        pluginId: "grok",
        homeDir: home,
        scriptText: readPluginScript("grok"),
        request: requestByUrl({
          "https://cli-chat-proxy.grok.com/v1/billing": {
            config: {
              monthlyLimit: { val: 60000 },
              used: { val: 6000 },
              onDemandCap: { val: 0 },
              billingPeriodEnd: "2099-02-01T00:00:00Z",
            },
          },
          "https://cli-chat-proxy.grok.com/v1/settings": {
            subscription_tier_display: "SuperGrok Heavy",
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "grok",
        plan: "SuperGrok Heavy",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
        "Credits used",
        "Pay as you go",
      ]);
    });
  });

  test("adapts the original JetBrains AI Assistant plugin through local quota XML", async () => {
    await withIsolatedHome(async (home) => {
      const quotaPath = join(home, ".config/JetBrains/IntelliJIdea2025.3/options/AIAssistantQuotaManager2.xml");
      mkdirSync(resolve(quotaPath, ".."), { recursive: true });
      const quotaInfo = JSON.stringify({ current: "75", maximum: "100", available: "25" }).replace(/"/g, "&quot;");
      const nextRefill = JSON.stringify({
        next: "2026-02-08T12:00:00Z",
        tariff: { duration: "PT720H" },
      }).replace(/"/g, "&quot;");
      writeFileSync(
        quotaPath,
        `<application><component name="AIAssistantQuotaManager2"><option name="quotaInfo" value="${quotaInfo}" /><option name="nextRefill" value="${nextRefill}" /></component></application>`,
      );
      const provider = new OpenUsagePluginProvider({
        providerId: "jetbrains-ai-assistant",
        name: "JetBrains AI Assistant",
        pluginId: "jetbrains-ai-assistant",
        homeDir: home,
        scriptText: readPluginScript("jetbrains-ai-assistant"),
        request: () => {
          throw new Error("JetBrains fixture should not call HTTP");
        },
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "jetbrains-ai-assistant",
        lines: [
          { type: "progress", label: "Quota", used: 75, limit: 100 },
          { type: "text", label: "Used", value: "75" },
          { type: "text", label: "Remaining", value: "25" },
        ],
      });
    });
  });

  test("adapts the original Kimi plugin through local credentials and usage API", async () => {
    await withIsolatedHome(async (home) => {
      writeJson(join(home, ".kimi/credentials/kimi-code.json"), {
        access_token: "kimi-token",
        refresh_token: "refresh",
        expires_at: 4102444800,
      });
      const provider = new OpenUsagePluginProvider({
        providerId: "kimi",
        name: "Kimi",
        pluginId: "kimi",
        homeDir: home,
        scriptText: readPluginScript("kimi"),
        request: requestByUrl({
          "https://api.kimi.com/coding/v1/usages": {
            usage: { limit: "100", remaining: "74", resetTime: "2099-02-11T00:00:00Z" },
            limits: [
              {
                window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
                detail: { limit: "100", remaining: "85", resetTime: "2099-02-07T00:00:00Z" },
              },
            ],
            user: { membership: { level: "LEVEL_INTERMEDIATE" } },
          },
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "kimi",
        plan: "Intermediate",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual(["Session", "Weekly"]);
    });
  });

  test("adapts the original Kiro plugin through local token, state DB, and usage log", async () => {
    await withIsolatedHome(async (home) => {
      const profileArn = "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK";
      writeJson(join(home, ".aws/sso/cache/kiro-auth-token.json"), {
        accessToken: "kiro-access-token",
        refreshToken: "kiro-refresh-token",
        expiresAt: "2026-02-02T01:00:00.000Z",
        authMethod: "social",
        provider: "Google",
        profileArn,
      });

      const dbPath = join(home, "Library/Application Support/Kiro/User/globalStorage/state.vscdb");
      mkdirSync(resolve(dbPath, ".."), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
      db.query("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
        "kiro.kiroAgent",
        JSON.stringify({
          "kiro.resourceNotifications.usageState": {
            usageBreakdowns: [
              {
                type: "CREDIT",
                currentUsage: 0,
                usageLimit: 50,
                resetDate: "2026-05-01T00:00:00.000Z",
                freeTrialUsage: {
                  currentUsage: 106.11,
                  usageLimit: 500,
                  expiryDate: "2026-05-03T15:09:55.196Z",
                },
              },
            ],
            timestamp: Date.parse("2026-02-01T23:58:00.000Z"),
          },
        }),
      );
      db.close();

      const logPath = join(
        home,
        "Library/Application Support/Kiro/logs/20260406T235910/window1/exthost/kiro.kiroAgent/q-client.log",
      );
      mkdirSync(resolve(logPath, ".."), { recursive: true });
      writeFileSync(
        logPath,
        `2026-02-01 23:57:00.000 [info] ${JSON.stringify({
          clientName: "CodeWhispererRuntimeClient",
          commandName: "GetUsageLimitsCommand",
          input: {
            origin: "AI_EDITOR",
            profileArn,
            resourceType: "AGENTIC_REQUEST",
          },
          output: {
            overageConfiguration: { overageStatus: "DISABLED" },
            subscriptionInfo: { subscriptionTitle: "KIRO FREE" },
            usageBreakdownList: [],
          },
        })}\n`,
      );

      const provider = new OpenUsagePluginProvider({
        providerId: "kiro",
        name: "Kiro",
        pluginId: "kiro",
        homeDir: home,
        now: () => "2026-02-02T00:00:00.000Z",
        scriptText: readPluginScript("kiro"),
        request: () => {
          throw new Error("Kiro fixture should use local state without HTTP");
        },
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "kiro",
        plan: "Kiro Free",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
        "Credits",
        "Bonus Credits",
        "Overages",
      ]);
    });
  });

  test("adapts the original OpenCode Go plugin through local auth and empty usage DB", async () => {
    await withIsolatedHome(async (home) => {
      writeJson(join(home, ".local/share/opencode/auth.json"), {
        "opencode-go": { type: "api-key", key: "go-key" },
      });
      const dbPath = join(home, ".local/share/opencode/opencode.db");
      mkdirSync(resolve(dbPath, ".."), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec("CREATE TABLE message (data TEXT, time_created INTEGER);");
      db.close();
      const provider = new OpenUsagePluginProvider({
        providerId: "opencode-go",
        name: "OpenCode Go",
        pluginId: "opencode-go",
        homeDir: home,
        scriptText: readPluginScript("opencode-go"),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "opencode-go",
        plan: "Go",
      });
      expect((records[0]?.raw as any).lines.map((line: any) => line.label)).toEqual([
        "Session",
        "Weekly",
        "Monthly",
      ]);
    });
  });

  test("adapts the original Perplexity plugin through local cache DB and REST APIs", async () => {
    await withIsolatedHome(async (home) => {
      const dbPath = join(home, "Library/Caches/ai.perplexity.mac/Cache.db");
      mkdirSync(resolve(dbPath, ".."), { recursive: true });
      const db = new Database(dbPath, { create: true });
      db.exec(
        "CREATE TABLE cfurl_cache_response (entry_ID INTEGER PRIMARY KEY, request_key TEXT); CREATE TABLE cfurl_cache_blob_data (entry_ID INTEGER PRIMARY KEY, request_object BLOB);",
      );
      db.query("INSERT INTO cfurl_cache_response (entry_ID, request_key) VALUES (?, ?)").run(
        1,
        "https://www.perplexity.ai/api/user",
      );
      db.query("INSERT INTO cfurl_cache_blob_data (entry_ID, request_object) VALUES (?, ?)").run(
        1,
        Buffer.from(`Bearer ${createJwt({ email: "user@example.com" })}`),
      );
      db.close();
      const provider = new OpenUsagePluginProvider({
        providerId: "perplexity",
        name: "Perplexity",
        pluginId: "perplexity",
        homeDir: home,
        scriptText: readPluginScript("perplexity"),
        request: requestByUrl({
          "https://www.perplexity.ai/api/user": notFoundResponse,
          "https://www.perplexity.ai/api/user/": notFoundResponse,
          "https://www.perplexity.ai/rest/pplx-api/v2/groups": {
            orgs: [{ api_org_id: "test-group-id", is_default_org: true }],
          },
          "https://www.perplexity.ai/rest/pplx-api/v2/groups/test-group-id": {
            customerInfo: { balance: 4.99, is_pro: true },
          },
          "https://www.perplexity.ai/rest/pplx-api/v2/groups/test-group-id/usage-analytics": [
            { meter_event_summaries: [{ cost: 0.04 }] },
          ],
          "https://www.perplexity.ai/rest/rate-limit/all": notFoundResponse,
        }),
      });

      const records = await provider.refresh();

      expect(records[0]?.raw).toMatchObject({
        pluginId: "perplexity",
        plan: "Pro",
        lines: [{ type: "progress", label: "API credits", used: 0.04, limit: 4.99 }],
      });
    });
  });
});
