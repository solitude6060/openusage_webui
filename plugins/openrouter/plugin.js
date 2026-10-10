(function () {
  // Port of robinebers/openusage OpenRouter provider (Swift, commit bb7de176):
  // OpenRouterAuthStore + UserAPIKeyStore.loadKey, OpenRouterUsageClient,
  // OpenRouterUsageMapper and the refresh logic in OpenRouterProvider.
  var CREDITS_URL = "https://openrouter.ai/api/v1/credits";
  var KEY_URL = "https://openrouter.ai/api/v1/key";

  // Checked in order; the first readable key wins. Config files beat the environment so a
  // rotated key in the file is not shadowed by a stale exported variable.
  var CONFIG_PATHS = ["~/.config/openusage/openrouter.json", "~/.config/openrouter/key.json"];
  var ENV_NAMES = ["OPENROUTER_API_KEY", "OPENROUTER_KEY"];

  var MSG_MISSING_KEY =
    "No OpenRouter API key. Set OPENROUTER_API_KEY or add it to ~/.config/openusage/openrouter.json.";
  var MSG_INVALID_KEY = "OpenRouter API key invalid. Check your key at openrouter.ai/keys.";
  var MSG_CONNECTION = "Couldn't reach OpenRouter. Check your connection.";
  var MSG_UNAVAILABLE = "OpenRouter usage data unavailable. Try again later.";

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Permissive numeric read: finite numbers and numeric strings; booleans, blanks and
  // everything else are rejected (upstream ProviderParse.number).
  function num(value) {
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (typeof value === "string") {
      var text = value.trim();
      if (!text) return null;
      var parsed = Number(text);
      return isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function dollars(amount) {
    return "$" + amount.toFixed(2);
  }

  // A JSON object with apiKey / api_key / key, or a plain-text file holding only the key.
  function keyFromConfigText(ctx, text) {
    var parsed = ctx.util.safeJsonParse(text);
    if (parsed.ok && isObject(parsed.value)) {
      var fields = ["apiKey", "api_key", "key"];
      for (var i = 0; i < fields.length; i++) {
        var value = parsed.value[fields[i]];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return null;
    }
    var trimmed = String(text).trim();
    return !trimmed || trimmed.indexOf("{") !== -1 ? null : trimmed;
  }

  function loadApiKey(ctx) {
    for (var i = 0; i < CONFIG_PATHS.length; i++) {
      var text;
      try {
        if (!ctx.host.fs.exists(CONFIG_PATHS[i])) continue;
        text = ctx.host.fs.readText(CONFIG_PATHS[i]);
      } catch (e) {
        ctx.host.log.warn("Failed to read " + CONFIG_PATHS[i] + ": " + e);
        continue;
      }
      var key = keyFromConfigText(ctx, text);
      if (key) return key;
    }
    for (var j = 0; j < ENV_NAMES.length; j++) {
      var envValue = ctx.host.env.get(ENV_NAMES[j]);
      if (typeof envValue === "string" && envValue.trim()) return envValue.trim();
    }
    return null;
  }

  // One endpoint, classified as { data } on 2xx, { auth: true } on 401/403, or { failure }.
  // OpenRouter gates some endpoints by key type, so each call is judged on its own.
  function load(ctx, url, apiKey) {
    var result;
    try {
      result = ctx.util.requestJson({
        method: "GET",
        url: url,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 15000,
      });
    } catch (e) {
      ctx.host.log.warn("OpenRouter request to " + url + " failed: " + e);
      return { failure: MSG_CONNECTION };
    }
    var status = result.resp.status;
    if (ctx.util.isAuthStatus(status)) return { auth: true };
    if (status < 200 || status >= 300) {
      return { failure: "OpenRouter request failed (HTTP " + status + ")." };
    }
    // OpenRouter wraps every payload in { "data": { ... } }.
    var data = result.json ? result.json.data : null;
    if (!isObject(data)) return { failure: MSG_UNAVAILABLE };
    return { data: data };
  }

  // Credits meter + Balance from /credits. Empty when there is no usable total_usage.
  function creditsLines(ctx, data) {
    var totalUsage = num(data.total_usage);
    if (totalUsage === null) return [];

    var used = Math.max(0, totalUsage);
    var totalCredits = Math.max(0, num(data.total_credits) || 0);
    var lines = [];
    // A never-topped-up account reports 0 credits: no meter, but Balance still shows.
    if (totalCredits > 0) {
      lines.push(ctx.line.progress({
        label: "Credits",
        used: used,
        limit: totalCredits,
        format: { kind: "dollars" },
      }));
    }
    lines.push(ctx.line.text({
      label: "Balance",
      value: dollars(Math.max(0, totalCredits - used)),
    }));
    return lines;
  }

  function spendLine(ctx, label, value) {
    var amount = num(value);
    if (amount === null) return null;
    return ctx.line.text({ label: label, value: dollars(Math.max(0, amount)) });
  }

  // Period spend, optional per-key cap and the tier (plan) from /key.
  function keyMetrics(ctx, data) {
    var lines = [];
    var spends = [
      ["Today", data.usage_daily],
      ["This Week", data.usage_weekly],
      ["This Month", data.usage_monthly],
    ];
    for (var i = 0; i < spends.length; i++) {
      var spend = spendLine(ctx, spends[i][0], spends[i][1]);
      if (spend) lines.push(spend);
    }

    // limit_remaining is the current window (daily/weekly/monthly or lifetime); `usage` is
    // lifetime spend and would overstate the cap after a reset, so it is not used.
    var limit = num(data.limit);
    if (limit !== null && limit > 0) {
      var remaining = Math.max(0, num(data.limit_remaining) || 0);
      lines.push(ctx.line.progress({
        label: "Key Limit",
        used: Math.max(0, limit - remaining),
        limit: limit,
        format: { kind: "dollars" },
      }));
    }

    var plan = null;
    if (typeof data.is_free_tier === "boolean") plan = data.is_free_tier ? "Free tier" : "Pay as you go";
    return { plan: plan, lines: lines };
  }

  function probe(ctx) {
    var apiKey = loadApiKey(ctx);
    if (!apiKey) throw MSG_MISSING_KEY;

    var credits = load(ctx, CREDITS_URL, apiKey);
    var key = load(ctx, KEY_URL, apiKey);

    var lines = [];
    var plan = null;
    if (credits.data) lines = lines.concat(creditsLines(ctx, credits.data));
    if (key.data) {
      var mapped = keyMetrics(ctx, key.data);
      plan = mapped.plan;
      lines = lines.concat(mapped.lines);
    }

    if (lines.length > 0) {
      var out = { lines: lines };
      if (plan) out.plan = plan;
      return out;
    }

    // Only call the key invalid when BOTH endpoints rejected it; a single 403 means the key
    // is valid but gated for that endpoint.
    if (credits.auth && key.auth) throw MSG_INVALID_KEY;
    throw credits.failure || key.failure || MSG_UNAVAILABLE;
  }

  globalThis.__openusage_plugin = { id: "openrouter", probe: probe };
})();
