import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import type { DataStore } from "./store.js";
import { writeFileAtomic } from "./fsutil.js";

const run = promisify(execFile);

/**
 * Secrets are never stored in plaintext.
 * - Windows: DPAPI (CurrentUser scope) through PowerShell's ConvertFrom-SecureString.
 * - Other OS (dev/CI): AES-256-GCM with a local 0600 key file. This is weaker than an OS keychain
 *   and is reported as such by `backend`.
 */
export class SecretStore {
  constructor(private readonly store: DataStore) {}

  get backend(): "windows-dpapi" | "local-keyfile-aes-gcm" {
    return process.platform === "win32" ? "windows-dpapi" : "local-keyfile-aes-gcm";
  }

  private file(name: string) {
    if (!/^[a-z0-9._-]{2,64}$/i.test(name)) throw new Error(`Tên secret không hợp lệ: ${name}`);
    return this.store.p("secrets", `${name}.secret`);
  }

  private async key(): Promise<Buffer> {
    const f = this.store.p("secrets", ".keyfile");
    try {
      return Buffer.from(await fs.readFile(f, "utf8"), "base64");
    } catch {
      const k = randomBytes(32);
      await writeFileAtomic(f, k.toString("base64"), { keepBackup: false });
      await fs.chmod(f, 0o600).catch(() => undefined);
      return k;
    }
  }

  async set(name: string, value: string): Promise<void> {
    let payload: string;
    if (this.backend === "windows-dpapi") {
      const ps = `$s = ConvertTo-SecureString -String $env:TTM_SECRET -AsPlainText -Force; ConvertFrom-SecureString -SecureString $s`;
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, TTM_SECRET: value } });
      payload = JSON.stringify({ v: 1, backend: "dpapi", data: stdout.trim() });
    } else {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", await this.key(), iv);
      const enc = Buffer.concat([c.update(value, "utf8"), c.final()]);
      payload = JSON.stringify({ v: 1, backend: "aesgcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: enc.toString("base64") });
    }
    await writeFileAtomic(this.file(name), payload, { keepBackup: false });
    await fs.chmod(this.file(name), 0o600).catch(() => undefined);
    await this.store.audit({ actor: "user", action: "secret.set", subject: name }); // value never logged
  }

  async get(name: string): Promise<string | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(name), "utf8");
    } catch {
      return null;
    }
    const j = JSON.parse(raw);
    if (j.backend === "dpapi") {
      const ps = `$s = ConvertTo-SecureString -String $env:TTM_SECRET; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, TTM_SECRET: j.data } });
      return stdout.replace(/\r?\n$/, "");
    }
    const d = createDecipheriv("aes-256-gcm", await this.key(), Buffer.from(j.iv, "base64"));
    d.setAuthTag(Buffer.from(j.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(j.data, "base64")), d.final()]).toString("utf8");
  }

  async has(name: string): Promise<boolean> {
    return fs.access(this.file(name)).then(
      () => true,
      () => false,
    );
  }

  async delete(name: string): Promise<void> {
    await fs.rm(this.file(name), { force: true });
    await this.store.audit({ actor: "user", action: "secret.delete", subject: name });
  }
}

/** Mask anything that looks like a token before logging/reporting. */
export function redact(text: string): string {
  return text
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[telegram-token]")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "[google-token]")
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, "[meta-token]")
    .replace(/(access_token|refresh_token|client_secret)=([^&\s]+)/gi, "$1=[redacted]");
}
