import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PluginRequestOptions, PluginRequestResponse } from "../src/index";

export function readPluginScript(pluginId: string): string {
  return readFileSync(resolve(import.meta.dir, "../../../plugins", pluginId, "plugin.js"), "utf8");
}

export async function withIsolatedHome<T>(run: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "openusage-plugin-home-"));
  try {
    return await run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

export function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

export function jsonResponse(value: unknown): PluginRequestResponse {
  return { status: 200, headers: {}, bodyText: JSON.stringify(value) };
}

export function notFoundResponse(): PluginRequestResponse {
  return { status: 404, headers: {}, bodyText: "" };
}

export function requestByUrl(routes: Record<string, unknown>): (opts: PluginRequestOptions) => PluginRequestResponse {
  return (opts) => {
    if (Object.hasOwn(routes, opts.url)) {
      const value = routes[opts.url];
      if (typeof value === "function") {
        return (value as (opts: PluginRequestOptions) => PluginRequestResponse)(opts);
      }
      return jsonResponse(value);
    }
    throw new Error(`Unexpected request: ${opts.method ?? "GET"} ${opts.url}`);
  };
}

/**
 * An unencrypted OpenSSH ed25519 private key (the file `ollama` writes to ~/.ollama/id_ed25519),
 * generated in memory so no key material is ever committed. Layout per OpenSSH PROTOCOL.key.
 */
export function createOpenSshEd25519Key(): { pem: string; publicKeyBlobBase64: string; publicKey: KeyObject } {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const seed = Buffer.from(jwk.d!, "base64url");
  const pub = Buffer.from(jwk.x!, "base64url");
  const u32 = (n: number) => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(n);
    return out;
  };
  const str = (value: Buffer | string) => {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    return Buffer.concat([u32(bytes.length), bytes]);
  };
  const publicKeyBlob = Buffer.concat([str("ssh-ed25519"), str(pub)]);
  let priv = Buffer.concat([
    u32(0x12345678), u32(0x12345678), str("ssh-ed25519"), str(pub), str(Buffer.concat([seed, pub])), str(""),
  ]);
  for (let pad = 1; priv.length % 8 !== 0; pad++) priv = Buffer.concat([priv, Buffer.from([pad])]);
  const blob = Buffer.concat([
    Buffer.from("openssh-key-v1\0", "latin1"), str("none"), str("none"), str(""), u32(1), str(publicKeyBlob), str(priv),
  ]);
  const body = blob.toString("base64").match(/.{1,64}/g)!.join("\n");
  return {
    pem: `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKeyBlobBase64: publicKeyBlob.toString("base64"),
    publicKey: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x! }, format: "jwk" }),
  };
}
