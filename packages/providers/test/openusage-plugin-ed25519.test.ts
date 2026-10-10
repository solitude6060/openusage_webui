import { describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { OpenUsagePluginProvider } from "../src/index";

// RFC 8032 section 7.1, TEST 1 (empty message) and TEST 2 (one byte, 0x72 = "r").
const RFC8032_VECTORS = [
  {
    seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    message: "",
    signature:
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    message: "r",
    signature:
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
] as const;

const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

// Runs `body` as a plugin probe and returns the lines it produced as { label: value }.
async function runProbe(body: string): Promise<Record<string, string>> {
  const provider = new OpenUsagePluginProvider({
    providerId: "synthetic",
    name: "Synthetic",
    scriptText: `(function () {
      function probe(ctx) {
        var lines = [];
        function put(label, value) { lines.push(ctx.line.text({ label: label, value: String(value) })); }
        ${body}
        return { plan: "t", lines: lines };
      }
      globalThis.__openusage_plugin = { id: "ed25519-test", probe: probe };
    })();`,
    request: () => ({ status: 204, headers: {}, bodyText: "" }),
  });
  const [record] = await provider.refresh();
  const lines = (record?.raw as { lines: Array<{ label: string; value: string }> }).lines;
  return Object.fromEntries(lines.map((line) => [line.label, line.value]));
}

describe("host.crypto.ed25519Sign", () => {
  test.each(RFC8032_VECTORS)("matches RFC 8032 vector for message %j", async (vector) => {
    const out = await runProbe(`
      var r = ctx.host.crypto.ed25519Sign(${JSON.stringify(b64(vector.seed))}, ${JSON.stringify(vector.message)});
      put("sig", r.signatureBase64);
      put("pub", r.publicKeyBase64);
    `);

    expect(out.sig).toBe(b64(vector.signature));
    expect(out.pub).toBe(b64(vector.publicKey));
  });

  test("signs the UTF-8 bytes of the message and the signature verifies", async () => {
    const seed = b64("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
    const message = "GET,/api/balance?ts=1700000000 é";
    const out = await runProbe(`
      var r = ctx.host.crypto.ed25519Sign(${JSON.stringify(seed)}, ${JSON.stringify(message)});
      put("sig", r.signatureBase64);
      put("pub", r.publicKeyBase64);
    `);

    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(out.pub!, "base64").toString("base64url") },
      format: "jwk",
    });
    expect(verify(null, Buffer.from(message, "utf8"), key, Buffer.from(out.sig!, "base64"))).toBe(true);
  });

  test("rejects a seed that is not 32 bytes without echoing the seed back", async () => {
    const badSeed = Buffer.from("not-a-valid-ed25519-seed-material").toString("base64");
    const out = await runProbe(`
      try { ctx.host.crypto.ed25519Sign(${JSON.stringify(badSeed)}, "x"); put("error", "none"); }
      catch (e) { put("error", e instanceof Error ? e.message : String(e)); }
    `);

    expect(out.error).toBe("Invalid Ed25519 seed.");
    expect(out.error).not.toContain(badSeed);
  });
});
