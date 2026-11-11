const S = {
  manifest: null,
  byScope: new Map(),
  scope: null,
  edition: null,
  cards: [],
  entryIndex: 0,
  view: "feed",
  installPrompt: null,
};

const $ = (id) => document.getElementById(id);

const STATUS = {
  terkonfirmasi: "Terkonfirmasi",
  sebagian: "Terkonfirmasi sebagian",
  belum: "Belum terkonfirmasi",
  dibantah: "Dibantah",
};

const BAND = {
  hampir_pasti: "Hampir pasti",
  kemungkinan_besar: "Kemungkinan besar",
  belum_pasti: "Belum pasti",
  diragukan: "Diragukan",
  kemungkinan_tidak: "Kemungkinan tidak benar",
};

const SCOPE_LABEL = { nasional: "Nasional", lokal: "Sleman", mingguan: "Mingguan" };

const ICONS = {
  edisi:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H4z"/><path d="M17 8h3v9a2 2 0 0 1-2 2h-1"/><path d="M7 9h7M7 12h7M7 15h5"/></svg>',
  sleman:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  mingguan:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4z"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  atur:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta",
    });
  } catch { return iso; }
}

function navItems() {
  const items = [{ key: "nasional", label: "Edisi", icon: ICONS.edisi }];
  if (S.byScope.has("lokal")) items.push({ key: "lokal", label: "Sleman", icon: ICONS.sleman });
  if (S.byScope.has("mingguan")) items.push({ key: "mingguan", label: "Mingguan", icon: ICONS.mingguan });
  items.push({ key: "atur", label: "Atur", icon: ICONS.atur });
  return items;
}

function renderNav() {
  const bar = $("bottom");
  bar.hidden = false;
  bar.textContent = "";
  for (const item of navItems()) {
    const b = el("button", "it");
    b.type = "button";
    b.dataset.nav = item.key;
    b.innerHTML = item.icon;
    b.append(el("span", null, item.label));
    b.onclick = () => (item.key === "atur" ? openAtur() : openScope(item.key));
    bar.append(b);
  }
  markNav();
}

function markNav() {
  const active = S.view === "atur" ? "atur" : S.scope;
  for (const b of document.querySelectorAll(".bar .it")) {
    const on = b.dataset.nav === active;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

async function boot() {
  let manifest;
  try {
    const res = await fetch("manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch {
    $("dateline").textContent = "Edisi Pagi";
    $("empty").hidden = false;
    return;
  }

  S.manifest = manifest;
  if (!manifest.editions?.length) {
    $("dateline").textContent = "Edisi Pagi";
    $("empty").hidden = false;
    return;
  }

  const currentByScope = manifest.latest_by_scope;
  for (const e of manifest.editions) {
    // Jangan tampilkan edisi lokal/mingguan lama sebagai edisi hari ini.
    if (currentByScope && Object.prototype.hasOwnProperty.call(currentByScope, e.scope)) {
      if (currentByScope[e.scope] !== e.edition_id) continue;
    }
    const list = S.byScope.get(e.scope) ?? [];
    list.push(e);
    S.byScope.set(e.scope, list);
  }

  renderNav();
  renderInstallChip();

  if (location.hash.startsWith("#/atur")) {
    openAtur();
    return;
  }

  const preferred = ["nasional", "lokal", "mingguan"].find((s) => S.byScope.has(s));
  const fromHash = location.hash.split("/")[1];
  const initial = fromHash && S.byScope.has(fromHash) ? fromHash : preferred;
  await openScope(initial);
}

async function openScope(scope, entryIndex = 0) {
  const entries = S.byScope.get(scope);
  if (!entries?.length) return;
  S.scope = scope;
  S.entryIndex = Math.max(0, Math.min(entryIndex, entries.length - 1));
  S.view = "feed";

  const entry = entries[S.entryIndex];
  try {
    const res = await fetch(entry.path, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    S.edition = await res.json();
  } catch {
    $("dateline").textContent = "Gagal memuat edisi";
    $("subline").textContent = "Coba lagi saat ada koneksi.";
    return;
  }

  S.cards = S.edition.cards ?? [];

  $("dateline").textContent = formatDate(S.edition.published_at);
  $("subline").textContent =
    `${S.edition.card_count} kartu · ±${S.edition.reading_time_min} menit · ${SCOPE_LABEL[scope]}`;
  $("covline").textContent = `Liputan ${formatDate(S.edition.coverage.from)} · 05.00–05.00`;

  renderDates();
  showFeed();
  renderFeed();
  renderInstallChip();
}

function renderDates() {
  const box = $("dates");
  const entries = S.byScope.get(S.scope) ?? [];
  box.textContent = "";
  box.hidden = entries.length < 2;
  if (entries.length < 2) return;

  entries.forEach((entry, i) => {
    const b = el("button", "date", shortDate(entry.published_at));
    b.type = "button";
    if (i === S.entryIndex) b.classList.add("on");
    b.onclick = () => openScope(S.scope, i);
    box.append(b);
  });
}

function shortDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  } catch { return String(iso).slice(0, 10); }
}

function showFeed() {
  $("atur").hidden = true;
  $("top").hidden = false;
  $("detail").hidden = true;
  $("feed").hidden = false;
  $("bottom").hidden = false;
  S.view = "feed";
  const entries = S.byScope.get(S.scope) ?? [];
  $("dates").hidden = entries.length < 2;
  if (S.scope) location.hash = `#/${S.scope}`;
  window.scrollTo(0, 0);
  markNav();
}

function openAtur() {
  S.view = "atur";
  $("top").hidden = true;
  $("feed").hidden = true;
  $("detail").hidden = true;
  $("empty").hidden = true;
  $("atur").hidden = false;
  $("bottom").hidden = false;
  $("dates").hidden = true;
  location.hash = "#/atur";
  window.scrollTo(0, 0);
  markNav();
  renderInstall();
  renderAbout();
  setupNotifications();
}

function renderAbout() {
  const box = $("aboutBody");
  if (!box) return;
  box.textContent = "";
  box.append(
    el("p", "pmuted", "Brief harian untuk satu pembaca di Sleman. Tanpa iklan, tanpa feed tak terbatas, tanpa pelacakan."),
  );
  const m = S.manifest;
  if (m) {
    box.append(
      el(
        "p",
        "pmuted",
        `Arsip sejak ${m.retention?.oldest ?? "—"} · dibuat ${formatDate(m.generated_at)}`,
      ),
    );
  }
  const a = el("a", "pmuted", "Kode dan data di GitHub");
  a.href = "https://github.com/abbadaim/edisi-pagi";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  box.append(a);
}

const isStandalone = () =>
  Boolean(window.matchMedia?.("(display-mode: standalone)").matches) || navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function renderInstallChip() {
  const chip = $("installChip");
  if (!chip) return;
  const show = !isStandalone() && (Boolean(S.installPrompt) || isIOS());
  chip.hidden = !show;
  chip.textContent = isIOS() && !S.installPrompt ? "Cara pasang" : "Pasang";
}

async function promptInstall() {
  const prompt = S.installPrompt;
  if (!prompt) {
    openAtur();
    return;
  }
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === "accepted") S.installPrompt = null;
  renderInstallChip();
  renderInstall();
}

$("installChip").onclick = () => promptInstall();

function renderInstall() {
  const box = $("installBody");
  if (!box) return;
  box.textContent = "";

  if (isStandalone()) {
    box.append(el("p", "pmuted ok", "Sudah terpasang. Edisi Pagi terbuka dari layar utama."));
    return;
  }

  if (S.installPrompt) {
    const b = el("button", "pbtn", "Pasang ke layar utama");
    b.onclick = () => promptInstall();
    box.append(b);
    box.append(el("p", "pmuted", "Cukup sekali. Setelah itu tidak perlu membuka browser."));
    return;
  }

  if (isIOS()) {
    const steps = el("ol", "steps");
    steps.append(el("li", null, "Buka halaman ini di Safari."));
    steps.append(el("li", null, "Ketuk tombol Bagikan — kotak dengan panah ke atas."));
    steps.append(el("li", null, "Pilih “Tambah ke Layar Utama”."));
    box.append(steps);
    return;
  }

  const ua = navigator.userAgent;
  const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|edg|opr|electron/i.test(ua);

  if (isSafari) {
    box.append(
      el("p", "pmuted", "Di Safari: menu File → Add to Dock, atau tombol Bagikan → Tambahkan ke Dock."),
    );
    return;
  }
  if (/android/i.test(ua)) {
    box.append(
      el("p", "pmuted", "Di Chrome Android: menu ⋮ → “Instal aplikasi” atau “Tambahkan ke layar utama”."),
    );
    return;
  }
  box.append(
    el("p", "pmuted", "Buka menu browser (⋮), lalu pilih “Instal aplikasi” atau “Tambahkan ke layar utama”."),
  );
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  S.installPrompt = e;
  renderInstallChip();
  if (S.view === "atur") renderInstall();
});

window.addEventListener("appinstalled", () => {
  S.installPrompt = null;
  renderInstallChip();
  renderInstall();
});

function renderFeed() {
  const feed = $("feed");
  feed.textContent = "";

  S.cards.forEach((card, i) => {
    // Kabar beredar tampil utuh di feed: klaimnya justru inti informasi.
    if (card.type === "hoax_roundup") {
      feed.append(hoaxCard(card, i));
      return;
    }

    if (card.type === "deep_dive") {
      feed.append(deepCard(card, i));
      return;
    }

    const btn = el("button", "card");
    btn.type = "button";

    if (card.image) {
      const img = el("img", "cover");
      img.src = card.image.url;
      img.alt = card.image.alt ?? "";
      img.loading = i < 2 ? "eager" : "lazy";
      img.onerror = () => { img.remove(); btn.classList.add("plain"); };
      btn.append(img, el("div", "overlay"));
      const ctext = el("div", "ctext");
      ctext.append(el("div", "kick", card.kicker));
      ctext.append(el("h2", null, card.title));
      if (card.truth) {
        const m = el("div", "meta");
        m.append(el("span", "dot"));
        m.lastChild.style.background = card.status === "dibantah" ? "#E0785A" : "#E0B25A";
        m.append(el("span", null, `${STATUS[card.status] ?? card.status} · ${card.sources.length} sumber`));
        ctext.append(m);
      }
      btn.append(ctext);
    } else {
      btn.classList.add("plain");
      btn.append(el("div", "kick", card.kicker));
      btn.append(el("h2", null, card.title));
      if (card.body?.[0]) btn.append(el("p", "reason", teaser(card.body[0])));
    }

    btn.onclick = () => openCard(i);
    feed.append(btn);
  });

  const done = el("div", "done");
  done.append(el("div", "big", `Selesai. ${S.cards.length} kartu.`));
  done.append(el("div", "small", "Tidak ada berita lain hari ini"));
  feed.append(done);
}

/** Potong di batas kata — teaser yang berhenti di tengah kata terlihat seperti bug. */
function teaser(text, max = 160) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

function deepCard(card, index) {
  const btn = el("button", "card deep");
  btn.type = "button";
  const label = S.scope === "mingguan" ? "Rekap pekan" : "Mendalam";
  btn.append(el("div", "kick", `${label} · ${card.read_min ?? 5} menit`));
  btn.append(el("h2", null, card.title));
  if (card.dek) btn.append(el("p", "dek", card.dek));
  if (card.stats?.length) {
    const row = el("div", "statRow");
    for (const s of card.stats) row.append(el("span", null, `${s.value} ${s.label}`));
    btn.append(row);
  }
  btn.onclick = () => openCard(index);
  return btn;
}

function hoaxCard(card, index) {
  const box = el("div", "card hoax");
  box.id = `kartu-${index}`;

  const items = card.items ?? [];
  box.append(el("div", "kick", `Kabar beredar · ${items.length} klaim`));
  box.append(el("h2", null, card.title));

  for (const item of items) {
    const it = el("div", "hoaxItem");
    const a = el("a", "hoaxLink");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.append(el("span", `v ${item.verdict}`, item.verdict.replace("_", " ")));
    a.append(el("span", "claim", `“${item.claim}”`));
    it.append(a);
    const reason = item.reason ? item.reason.charAt(0).toUpperCase() + item.reason.slice(1) : "";
    it.append(el("div", "reason", reason));
    box.append(it);
  }

  if (card.pattern) box.append(el("div", "pattern", card.pattern));
  return box;
}

function openCard(index) {
  const card = S.cards[index];
  if (!card) return;

  // Kartu yang sudah tampil utuh di feed tidak punya halaman sendiri.
  if (card.type === "hoax_roundup") {
    showFeed();
    document.getElementById(`kartu-${index}`)?.scrollIntoView({ block: "center" });
    return;
  }

  $("feed").hidden = true;
  $("detail").hidden = false;
  $("bottom").hidden = false;
  $("navlabel").textContent = `${SCOPE_LABEL[S.scope]} · kartu ${index + 1} dari ${S.cards.length}`;

  const body = $("detailbody");
  body.textContent = "";

  if (card.image) {
    const img = el("img", "dimg");
    img.src = card.image.url;
    img.alt = card.image.alt ?? "";
    body.append(img);
  }

  body.append(el("div", "dkick", card.kicker));
  body.append(el("h2", "dtitle", card.title));

  const byline = el("div", "byline");
  const pill = el("span", `pill ${card.status}`, STATUS[card.status] ?? card.status);
  byline.append(pill, el("span", null, `${card.sources.length} sumber`));
  body.append(byline);

  if (card.truth) {
    const conf = el("div", "conf");
    const top = el("div", "confTop");
    const segs = el("div", "segs");
    const filled = Math.round(card.truth.confidence * 5);
    for (let i = 0; i < 5; i++) segs.append(el("i", i < filled ? "on" : ""));
    top.append(segs, el("div", "confLbl", BAND[card.truth.band] ?? card.truth.band));
    conf.append(top);
    const b = card.truth.basis;
    conf.append(
      el("div", "confNote",
        `${b.independent_outlets} media independen · ${b.primary > 0 ? "ada sumber primer" : "belum ada sumber primer"}`),
    );
    body.append(conf);
  }

  if (card.type === "deep_dive") {
    if (card.dek) body.append(el("div", "dek", card.dek));
    if (card.stats?.length) {
      const stats = el("div", "stats");
      for (const s of card.stats) {
        const st = el("div", "stat");
        st.append(el("div", "n", s.value), el("div", "l", s.label));
        stats.append(st);
      }
      body.append(stats);
    }
  }

  if (card.disclaimer) {
    const d = el("div", "disclaimer");
    d.append(el("div", "lbl", "Catatan penting"), el("p", null, card.disclaimer));
    body.append(d);
  }

  for (const p of card.body ?? []) body.append(el("p", "body", p));

  if (card.type === "change" && card.before && card.after) {
    const rows = el("div", "qa");
    rows.append(el("div", "q", `${card.before.at.slice(11, 16)} → ${card.after.at.slice(11, 16)}`));
    rows.append(el("div", "a", `"${card.before.quote}" → "${card.after.quote}"`));
    body.append(rows);
  }

  if (card.action) {
    const a = el("div", "action");
    a.append(el("div", "lbl", "Untuk kamu"), el("p", null, card.action));
    body.append(a);
  }

  if (card.unresolved?.length) {
    const box = el("div", "unresolved");
    box.append(el("div", "lbl", "Yang belum terjawab"));
    const ul = el("ul");
    for (const q of card.unresolved) ul.append(el("li", null, q));
    box.append(ul);
    body.append(box);
  }

  if (card.type === "hoax_roundup" && card.items?.length) {
    for (const item of card.items) {
      const it = el("div", "hoaxItem");
      it.append(el("span", `v ${item.verdict}`, item.verdict.replace("_", " ")));
      it.append(el("div", "claim", `“${item.claim}”`));
      const reason = item.reason ? item.reason.charAt(0).toUpperCase() + item.reason.slice(1) : "";
    it.append(el("div", "reason", reason));
      body.append(it);
    }
  }

  if (card.explain?.length) {
    const d = el("details", "ctx");
    // Konteks adalah inti produk: tampil terbuka, bukan disembunyikan di balik tap.
    d.open = true;
    d.append(el("summary", null, `Konteks · ${card.explain.length} pertanyaan`));
    for (const qa of card.explain) {
      const box = el("div", "qa");
      box.append(el("div", "q", qa.q), el("div", "a", qa.a));
      box.append(el("div", "s", qa.source.outlet));
      d.append(box);
    }
    body.append(d);
  }

  if (card.sources?.length) {
    const src = el("div", "src");
    src.append(el("div", "lbl", "Sumber"));
    for (const s of card.sources) {
      const a = el("a", null, `${s.outlet}${s.published_at ? " · " + s.published_at.slice(0, 10) : ""}`);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      src.append(a);
    }
    body.append(src);
  }

  location.hash = `#/${S.scope}/${index}`;
  window.scrollTo(0, 0);
}

$("back").onclick = () => showFeed();

window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#/atur")) {
    if (S.view !== "atur") openAtur();
    return;
  }
  const parts = location.hash.split("/").filter(Boolean);
  if (parts.length === 2) {
    openCard(Number(parts[1]));
    return;
  }
  // Kembali dari Atur ke edisi lewat tombol Back browser.
  if (parts.length === 1 && S.byScope.has(parts[0] ?? "")) {
    if (S.view === "atur" || S.scope !== parts[0]) openScope(parts[0]);
  }
});

async function setupNotifications() {
  const box = $("notifBody");
  let cfg = null;
  try {
    cfg = await (await fetch("config.json", { cache: "no-cache" })).json();
  } catch { /* belum dikonfigurasi */ }

  if (!cfg?.vapidPublicKey) {
    box.append(el("p", "muted", "Notifikasi belum dikonfigurasi (jalankan npm run gen:vapid)."));
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    box.append(el("p", "muted", "Perangkat ini tidak mendukung notifikasi web."));
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const current = await reg.pushManager.getSubscription();

  const render = (sub) => {
    box.textContent = "";
    if (!sub) {
      box.append(el("p", "muted", "Satu notifikasi per hari, pukul 05.45."));
      const b = el("button", "notifBtn", "Aktifkan notifikasi");
      b.onclick = async () => {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
        const created = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
        });
        render(created);
      };
      box.append(b);
      return;
    }
    box.append(el("p", "muted", "Aktif. Salin JSON ini ke GitHub Secret PUSH_SUBSCRIPTION."));
    const pre = el("pre", "subjson", JSON.stringify(sub.toJSON(), null, 2));
    const copy = el("button", "notifBtn", "Salin");
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        copy.textContent = "Tersalin";
      } catch {
        copy.textContent = "Salin manual";
      }
    };
    box.append(pre, copy);
  };

  render(current);
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => setupNotifications())
      .catch(() => {});
  });
}

boot().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  $("dateline").textContent = "Gagal memuat";
  $("subline").textContent = msg;
  $("feed").hidden = true;
  console.error(e);
});
