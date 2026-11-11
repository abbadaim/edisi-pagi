const S = {
  manifest: null,
  /** Seluruh edisi dari manifest, terbaru lebih dulu. */
  all: [],
  /** Edisi terbaru per scope — yang dipakai tab bawah (`DEC-0019`). */
  byScope: new Map(),
  /** Edition JSON yang sudah dimuat, dengan kunci `entry.path`. */
  loaded: new Map(),
  scope: null,
  editionId: null,
  edition: null,
  cards: [],
  editionPath: null,
  /** Posisi gulir feed, supaya kembali dari detail tidak melompat ke atas. */
  feedScroll: 0,
  feedKey: null,
  /** Arsip dirender bertahap: retensi 2 tahun bisa berarti ±700 tanggal. */
  archiveLimit: 30,
  route: { name: "feed", scope: null, editionId: null, card: null },
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
const SCOPE_ORDER = ["nasional", "lokal", "mingguan"];

const ICONS = {
  edisi:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H4z"/><path d="M17 8h3v9a2 2 0 0 1-2 2h-1"/><path d="M7 9h7M7 12h7M7 15h5"/></svg>',
  sleman:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  mingguan:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4z"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  arsip:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3z"/><path d="M5 8v12h14V8"/><path d="M9.5 12h5"/></svg>',
  atur:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function formatDate(iso, withYear = false) {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "Asia/Jakarta",
    });
  } catch { return iso; }
}

function shortDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  } catch { return String(iso).slice(0, 10); }
}

function monthLabel(iso) {
  try {
    return new Date(iso).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  } catch { return String(iso).slice(0, 7); }
}

// ── Rute ─────────────────────────────────────────────────────────────────────
// Satu keadaan = satu hash (rencana 008). Bentuk:
//   #/arsip · #/<scope> · #/<scope>/<edition_id> · #/<scope>/<edition_id>/<kartu>
// Hash lama `#/<scope>/<n>` tetap diterima sebagai indeks kartu edisi terbaru.

function hashFor(route) {
  if (route.name === "atur") return "#/atur";
  if (route.name === "arsip") return "#/arsip";
  if (!route.scope) return "";
  if (route.name === "detail") return `#/${route.scope}/${route.editionId}/${route.card}`;
  if (route.editionId) return `#/${route.scope}/${route.editionId}`;
  return `#/${route.scope}`;
}

function parseRoute(hash) {
  const parts = String(hash ?? "").replace(/^#\/?/, "").split("/").filter(Boolean);
  const blank = { name: "feed", scope: null, editionId: null, card: null };
  if (parts.length === 0) return blank;
  if (parts[0] === "atur") return { ...blank, name: "atur" };
  if (parts[0] === "arsip") return { ...blank, name: "arsip" };

  const scope = parts[0];
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] ?? "");
  const editionId = isDate ? parts[1] : null;
  const cardRaw = isDate ? parts[2] : parts[1];
  const card = cardRaw != null && /^\d+$/.test(cardRaw) ? Number(cardRaw) : null;
  return { name: card == null ? "feed" : "detail", scope, editionId, card };
}

const routeKey = (route) => `${route.name}|${route.scope ?? ""}|${route.editionId ?? ""}|${route.card ?? ""}`;

function navigate(route, { replace = false } = {}) {
  const next = { ...route };
  if (next.name === "feed" || next.name === "detail") {
    // Naikkan scope default ke edisi terbaru scope itu bila belum disebut.
    if (!next.scope) next.scope = initialScope();
  }
  if (routeKey(next) === routeKey(S.route)) return;

  // Simpan posisi baca sebelum layar feed ditinggalkan.
  if (S.route.name === "feed" && next.name === "detail") {
    S.feedScroll = window.scrollY;
    S.feedKey = `${S.scope}|${S.editionId}`;
  }

  const depth = history.state?.depth ?? 0;
  const state = { app: true, depth: replace ? depth : depth + 1 };
  const url = hashFor(next);

  // pushState/replaceState tidak memicu hashchange, jadi tidak ada render ganda.
  if (replace) history.replaceState(state, "", url || location.pathname + location.search);
  else history.pushState(state, "", url);

  S.route = next;
  renderRoute().catch(showFatal);
}

function syncFromLocation() {
  const route = parseRoute(location.hash);
  if (routeKey(route) === routeKey(S.route)) return;
  S.route = route;
  renderRoute().catch(showFatal);
}

function initialScope() {
  return ["nasional", "lokal", "mingguan"].find((s) => S.byScope.has(s)) ?? null;
}

function hasArchive() {
  return S.all.some((e) => {
    const newest = S.byScope.get(e.scope)?.[0];
    return !newest || newest.path !== e.path;
  });
}

// ── Navigasi bawah ───────────────────────────────────────────────────────────

function navItems() {
  const items = [{ key: "nasional", label: "Edisi", icon: ICONS.edisi }];
  if (S.byScope.has("lokal")) items.push({ key: "lokal", label: "Sleman", icon: ICONS.sleman });
  if (S.byScope.has("mingguan")) items.push({ key: "mingguan", label: "Mingguan", icon: ICONS.mingguan });
  if (hasArchive()) items.push({ key: "arsip", label: "Arsip", icon: ICONS.arsip });
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
    b.onclick = () => {
      if (item.key === "atur") navigate({ name: "atur" });
      else if (item.key === "arsip") navigate({ name: "arsip" });
      else navigate({ name: "feed", scope: item.key, editionId: null });
    };
    bar.append(b);
  }
  markNav();
}

function markNav() {
  const active =
    S.route.name === "atur" ? "atur" : S.route.name === "arsip" ? "arsip" : S.scope;
  for (const b of document.querySelectorAll(".bar .it")) {
    const on = b.dataset.nav === active;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

// ── Boot & render ────────────────────────────────────────────────────────────

async function boot() {
  // Posisi gulir dikelola aplikasi (lihat showFeed). Restorasi otomatis browser
  // menimpa hasil itu setelah popstate dan membuat back dari detail mendarat di
  // tempat yang salah.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

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

  S.all = [...manifest.editions].sort((a, b) =>
    a.edition_id === b.edition_id
      ? SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope)
      : b.edition_id.localeCompare(a.edition_id),
  );

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

  const initial = parseRoute(location.hash);
  if ((initial.name === "feed" || initial.name === "detail") && !resolveEntry(initial)) {
    initial.name = "feed";
    initial.editionId = null;
    initial.card = null;
    initial.scope = initialScope();
  }
  S.route = initial;

  // Boot tidak boleh menambah entri history: back pertama dari feed tidak
  // seharusnya menutup aplikasi (rencana 008, UI-13).
  const url = hashFor(initial);
  history.replaceState({ app: true, depth: 0 }, "", url || location.pathname + location.search);

  await renderRoute();
}

function resolveEntry(route) {
  const scope = route.scope;
  if (!scope) return null;
  if (route.editionId) {
    return S.all.find((e) => e.scope === scope && e.edition_id === route.editionId) ?? null;
  }
  return S.byScope.get(scope)?.[0] ?? null;
}

async function renderRoute() {
  const route = S.route;

  if (route.name === "feed" || route.name === "detail") {
    // Hash kosong / scope tak dikenal: buka edisi terbaru dan rapikan URL tanpa
    // menambah entri history.
    if (!route.scope) {
      route.scope = initialScope();
      if (route.scope) {
        history.replaceState({ ...(history.state ?? {}), app: true }, "", hashFor(route));
      }
    }
  }

  if (route.name === "atur") {
    openAtur();
    return;
  }
  if (route.name === "arsip") {
    renderArchiveView();
    return;
  }

  const entry = resolveEntry(route);
  if (!entry) {
    showEmptyState("Edisi tidak ditemukan", "Pilih tanggal lain dari arsip.");
    return;
  }

  const ok = await showEdition(entry);
  if (!ok) return;

  if (route.name === "detail") openCard(Number(route.card ?? 0), { fromRoute: true });
  else showFeed();
}

/** Ambil edition.json sekali per sesi: kembali dari detail tidak memuat ulang. */
async function showEdition(entry) {
  S.scope = entry.scope;
  S.editionId = entry.edition_id;

  const cached = S.loaded.get(entry.path);
  if (cached) {
    applyEdition(cached, entry);
    return true;
  }

  try {
    const res = await fetch(entry.path, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const edition = await res.json();
    S.loaded.set(entry.path, edition);
    applyEdition(edition, entry);
    return true;
  } catch {
    showLoadError(entry);
    return false;
  }
}

function applyEdition(edition, entry) {
  S.edition = edition;
  S.cards = edition.cards ?? [];
  S.editionPath = entry.path;

  $("dateline").textContent = formatDate(edition.published_at);
  $("subline").textContent =
    `${edition.card_count} kartu · ±${edition.reading_time_min} menit · ${SCOPE_LABEL[entry.scope]}`;
  $("covline").textContent = edition.coverage?.from
    ? `Liputan ${formatDate(edition.coverage.from)} · 05.00–05.00`
    : "";
}

function showEmptyState(title, detail) {
  $("top").hidden = true;
  $("feed").hidden = true;
  $("detail").hidden = true;
  $("atur").hidden = true;
  $("arsip").hidden = true;
  $("empty").hidden = false;
  $("bottom").hidden = false;
  const box = $("empty");
  box.textContent = "";
  box.append(el("p", null, title));
  box.append(el("p", "muted", detail));
}

function showLoadError(entry) {
  showEmptyState(
    "Gagal memuat edisi",
    navigator.onLine === false || !S.loaded.has(entry.path)
      ? "Edisi ini belum tersimpan offline. Buka lagi saat ada koneksi."
      : "Coba lagi saat ada koneksi.",
  );
}

function showFatal(e) {
  const msg = e instanceof Error ? e.message : String(e);
  $("dateline").textContent = "Gagal memuat";
  $("subline").textContent = msg;
  $("feed").hidden = true;
  console.error(e);
}

function showFeed() {
  $("top").hidden = false;
  $("atur").hidden = true;
  $("arsip").hidden = true;
  $("detail").hidden = true;
  $("empty").hidden = true;
  $("feed").hidden = false;
  $("bottom").hidden = false;

  renderFeed();

  // Kembali dari detail: posisi gulir lama dipulihkan, bukan ke atas.
  const key = `${S.scope}|${S.editionId}`;
  window.scrollTo(0, S.feedKey === key ? S.feedScroll : 0);
  markNav();
}

function openAtur() {
  $("top").hidden = true;
  $("feed").hidden = true;
  $("detail").hidden = true;
  $("empty").hidden = true;
  $("arsip").hidden = true;
  $("atur").hidden = false;
  $("bottom").hidden = false;
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
    navigate({ name: "atur" });
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
  if (S.route.name === "atur") renderInstall();
});

window.addEventListener("appinstalled", () => {
  S.installPrompt = null;
  renderInstallChip();
  renderInstall();
});

// ── Arsip ────────────────────────────────────────────────────────────────────

function archiveGroups() {
  const groups = new Map();
  for (const e of S.all) {
    const list = groups.get(e.edition_id) ?? [];
    list.push(e);
    groups.set(e.edition_id, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({
      date,
      entries: [...entries].sort(
        (a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope),
      ),
    }));
}

function isOfflineOnly(entry) {
  return navigator.onLine === false && !S.loaded.has(entry.path);
}

function renderArchiveView() {
  $("top").hidden = true;
  $("feed").hidden = true;
  $("detail").hidden = true;
  $("atur").hidden = true;
  $("empty").hidden = true;
  $("arsip").hidden = false;
  $("bottom").hidden = false;
  window.scrollTo(0, 0);
  markNav();
  renderArchive();
}

function renderArchive() {
  const body = $("arsipBody");
  if (!body) return;
  body.textContent = "";

  const groups = archiveGroups();
  const oldest = S.manifest?.retention?.oldest ?? S.all.at(-1)?.edition_id ?? "—";
  $("arsipSub").textContent = `${S.all.length} edisi · sejak ${formatDate(`${oldest}T05:00:00+07:00`, true)}`;

  const latest = S.manifest?.latest_by_scope ?? {};
  let month = null;

  for (const group of groups.slice(0, S.archiveLimit)) {
    const first = group.entries[0];
    const label = monthLabel(first.published_at);
    if (label !== month) {
      month = label;
      body.append(el("div", "arsipMonth", label));
    }

    const day = el("div", "arsipDay");
    day.append(el("div", "arsipDayDate", formatDate(first.published_at, true)));

    for (const entry of group.entries) {
      const offline = isOfflineOnly(entry);
      const b = el("button", "arsipItem");
      b.type = "button";
      b.dataset.scope = entry.scope;
      b.dataset.edition = entry.edition_id;
      if (offline) {
        b.disabled = true;
        b.classList.add("off");
      }

      b.append(el("span", "scope", SCOPE_LABEL[entry.scope] ?? entry.scope));

      const unit = entry.scope === "mingguan" ? "rekap" : "kartu";
      b.append(el("span", "meta", offline
        ? "Belum tersimpan offline"
        : `${entry.card_count} ${unit} · ${entry.reading_time_min} menit`));

      if (!offline && latest[entry.scope] === entry.edition_id) {
        b.append(el("span", "arsipChip new", "Terbaru"));
      }
      if (!offline && entry.scope === "mingguan") {
        b.append(el("span", "arsipChip week", "Pekan"));
      }
      if (!offline && entry.scope === S.scope && entry.edition_id === S.editionId) {
        b.append(el("span", "arsipChip open", "Dibuka"));
        b.setAttribute("aria-current", "true");
      }
      if (!offline) b.append(el("span", "chev", "›"));

      if (!offline) {
        b.onclick = () =>
          navigate({ name: "feed", scope: entry.scope, editionId: entry.edition_id });
      }
      day.append(b);
    }
    body.append(day);
  }

  if (groups.length > S.archiveLimit) {
    const more = el("button", "arsipMore", "Muat 30 tanggal lagi");
    more.type = "button";
    more.onclick = () => {
      const keep = window.scrollY;
      S.archiveLimit += 30;
      renderArchive();
      window.scrollTo(0, keep);
    };
    body.append(more);
  } else {
    body.append(el("div", "arsipFoot", `${groups.length} tanggal · retensi 2 tahun`));
  }

  if (navigator.onLine === false) {
    body.append(el("div", "arsipFoot", "Offline: hanya edisi yang pernah dibuka bisa dibaca."));
  }
}

// ── Feed ─────────────────────────────────────────────────────────────────────

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
      if (["change", "misread", "gap", "debate"].includes(card.type)) btn.classList.add("meta");
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

// ── Detail ───────────────────────────────────────────────────────────────────

function openCard(index, opts = {}) {
  if (!S.cards.length) return;
  const i = Math.max(0, Math.min(Number(index) || 0, S.cards.length - 1));
  const card = S.cards[i];
  if (!card) return;

  // Kartu yang sudah tampil utuh di feed tidak punya halaman sendiri.
  if (card.type === "hoax_roundup") {
    document.getElementById(`kartu-${i}`)?.scrollIntoView({ block: "center" });
    return;
  }

  if (!opts.fromRoute) {
    navigate({ name: "detail", scope: S.scope, editionId: S.editionId, card: i });
    return;
  }

  // Header feed (tanggal besar, jumlah kartu, liputan) tidak relevan di sini:
  // menyisakan bar dengan posisi edisi supaya jelas pembaca sedang di mana.
  $("top").hidden = true;
  $("feed").hidden = true;
  $("atur").hidden = true;
  $("arsip").hidden = true;
  $("detail").hidden = false;
  $("bottom").hidden = false;
  $("navlabel").textContent =
    `${SCOPE_LABEL[S.scope]} · ${shortDate(S.edition.published_at)} · kartu ${i + 1} dari ${S.cards.length}`;

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

  if (card.type === "change" && card.before && card.after) {
    const box = el("div", "delta");
    for (const [label, item] of [["Sebelum", card.before], ["Sesudah", card.after]]) {
      const row = el("div", "deltaRow");
      row.append(el("div", "deltaLbl", `${label} · ${shortDate(item.at)}`));
      row.append(el("div", "deltaVal", item.label));
      row.append(el("blockquote", "deltaQuote", `“${item.quote}”`));
      row.append(el("div", "deltaSrc", item.source.outlet));
      box.append(row);
    }
    body.append(box);
  }

  if (card.type === "misread" && card.missing?.length) {
    const box = el("div", "missing");
    box.append(el("div", "lbl", "Kata yang hilang dari judul"));
    for (const m of card.missing) box.append(el("span", "chip", m));
    body.append(box);
  }

  if (card.type === "gap") {
    const box = el("div", "socialBox");
    box.append(el("div", "lbl", "Sinyal sosial"));
    if (card.social?.reddit_score != null || card.social?.reddit_comments != null) {
      box.append(el("div", "socialRow", `Reddit: ${card.social.reddit_score ?? 0} skor · ${card.social.reddit_comments ?? 0} komentar`));
    }
    if (card.social?.detik_comments != null) {
      box.append(el("div", "socialRow", `Detik: ${card.social.detik_comments} komentar`));
    }
    if (card.social?.trend_interest != null) {
      box.append(el("div", "socialRow", `Google Trends: ${card.social.trend_interest}+ pencarian`));
    }
    box.append(
      el("div", "socialNote",
        `Liputan ${card.coverage?.article_count ?? 0} artikel · ${card.coverage?.outlets?.length ?? 0} media · selisih peringkat ${card.gap_rank}`),
    );
    if (card.absent_angle) box.append(el("p", "socialAngle", card.absent_angle));
    if (card.coverage_timeline?.length) {
      const tl = el("div", "timeline");
      tl.append(el("div", "lbl", "Jejak liputan"));
      for (const t of card.coverage_timeline) {
        tl.append(el("div", "timelineRow", `${t.outlet} · ${String(t.at).slice(0, 10)}`));
      }
      box.append(tl);
    }
    body.append(box);
  }

  if (card.type === "debate") {
    const box = el("div", "socialBox");
    box.append(el("div", "lbl", "Yang diperdebatkan"));
    box.append(el("div", "socialRow", `${card.volume?.platform ?? "publik"}: ${card.volume?.count ?? 0} komentar`));
    box.append(el("div", "socialRow", `Nada: ${card.tone}`));
    if (card.comparison) {
      box.append(el("div", "socialNote", `${card.comparison.platform}: ${card.comparison.count} (${card.comparison.note})`));
    }
    for (const q of card.quotes ?? []) {
      const quote = el("blockquote", "quote", `“${q.text}”`);
      quote.append(el("div", "quoteBy", `${q.author} · ${q.platform}`));
      box.append(quote);
    }
    if (card.reading) box.append(el("p", "socialAngle", card.reading));
    body.append(box);
  }

  for (const p of card.body ?? []) body.append(el("p", "body", p));

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

  window.scrollTo(0, 0);
  markNav();
}

// ── Kembali ──────────────────────────────────────────────────────────────────
// Tombol dan gestur memakai jalur yang sama: history. Kalau tidak ada entri
// aplikasi sebelumnya (tautan langsung ke detail), kembali ke feed di tempat.

$("back").onclick = () => {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else navigate({ name: "feed", scope: S.scope, editionId: S.editionId }, { replace: true });
};

window.addEventListener("hashchange", syncFromLocation);
window.addEventListener("popstate", syncFromLocation);

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
  showFatal(e);
});
