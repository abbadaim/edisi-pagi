/**
 * Asersi UI yang tidak butuh browser — lapisan murah dari DEC-0014.
 *
 * Annex `docs/plans/001-ui-test-harness.md`:
 *   UI-01..02 asersi statis atas `public/index.html`
 *   SRV-01..02 server lokal di subpath `/edisi-pagi/`
 *   PUSH-01    payload notifikasi memakai URL relatif scope
 *
 * Tidak ada jaringan keluar; hanya 127.0.0.1 dan proses lokal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function indexHtml(): string {
  return readFileSync(join(root, "public", "index.html"), "utf8");
}

// UI-01 — DEC-0014
// Path absolut membuat app berhenti di "Memuat…" karena situs dilayani dari
// /edisi-pagi/. Bug ini tidak pernah muncul di lokal, jadi harus dikunci statis.
test("UI-01: index.html tidak memakai href/src absolut", () => {
  const html = indexHtml();
  const absolute = [...html.matchAll(/(?:href|src)\s*=\s*"(\/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(absolute, [], `path absolut akan pecah di /edisi-pagi/: ${absolute.join(", ")}`);
});

// UI-02 — DEC-0014
// GitHub Pages meng-cache app.js 10 menit. Tanpa ?v=<sha1> deploy terlihat
// tidak berubah (publish.ts menulisnya).
test("UI-02: app.js dan style.css dimuat dengan ?v=", () => {
  const html = indexHtml();
  assert.match(html, /href="style\.css\?v=[a-f0-9]+"/, "style.css tanpa ?v=");
  assert.match(html, /src="app\.js\?v=[a-f0-9]+"/, "app.js tanpa ?v=");
});

interface Served {
  /** URL akar sesuai BASE_PATH, selalu berakhiran "/". */
  url: string;
  stop(): void;
}

const ready = /http:\/\/localhost:\d+[^\s]*/;

/** Jalankan `scripts/serve.ts` di port acak (PORT=0) dan tunggu siap. */
async function serve(env: Record<string, string>): Promise<Served> {
  const child = spawn(process.execPath, [join(root, "scripts", "serve.ts")], {
    env: { ...process.env, PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stop = (): void => {
    child.kill("SIGKILL");
  };

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("server tidak siap dalam 15 detik"));
    }, 15_000);
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const match = out.match(ready);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server berhenti (exit ${code})`));
    });
  });

  return { url: url.endsWith("/") ? url : `${url}/`, stop };
}

// SRV-01 — DEC-0014
// Asersi ini menjaga dua hal sekaligus: server uji benar-benar bisa melayani
// subpath, dan ia menolak melayani di luar prefix — tanpa penolakan itu suite
// bisa lulus sambil menguji akar domain, dan bug path absolut tidak tereproduksi.
test("SRV-01: BASE_PATH=/edisi-pagi melayani aset di subpath dan menolak di luar prefix", async () => {
  const server = await serve({ BASE_PATH: "/edisi-pagi" });
  try {
    const html = await fetch(server.url);
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await html.text(), /id="feed"/, "index.html tidak terkirim");

    const css = await fetch(`${server.url}style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/, "style.css tidak ter-resolve di subpath");

    const js = await fetch(`${server.url}app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/, "app.js tidak ter-resolve di subpath");

    const outside = await fetch(`${new URL(server.url).origin}/style.css`);
    assert.equal(outside.status, 404, "server melayani di luar prefix; suite tidak menguji subpath sungguhan");
  } finally {
    server.stop();
  }
});

// SRV-02 — DEC-0014
// BASE_PATH default harus tetap "/" supaya `npm run serve` tidak berubah perilaku.
test("SRV-02: tanpa BASE_PATH server tetap melayani di akar", async () => {
  const server = await serve({ BASE_PATH: "" });
  try {
    const css = await fetch(`${server.url}style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  } finally {
    server.stop();
  }
});

// PUSH-01 — DEC-0014
// AGENTS.md §5: payload notifikasi wajib "./" (relatif scope). "/" membuka akar
// domain dan halaman yang salah. Tidak ada tes yang mengunci ini sebelumnya.
test("PUSH-01: payload notifikasi memakai URL relatif scope", async () => {
  const child = spawn(process.execPath, [join(root, "scripts", "push.ts"), "--dry"], {
    env: { ...process.env, VAPID_PRIVATE_KEY: "uji", PUSH_SUBSCRIPTION: "{}" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  assert.equal(code, 0, `push.ts --dry gagal (exit ${code}): ${stderr}`);
  const output = JSON.parse(stdout) as { payload?: { url?: string } };
  const url = output.payload?.url;
  assert.equal(typeof url, "string", `payload tanpa url: ${stdout}`);
  assert.ok(url!.startsWith("./"), `payload.url harus relatif scope ("./"), dapat "${url}"`);
  assert.notEqual(url, "/");
});
