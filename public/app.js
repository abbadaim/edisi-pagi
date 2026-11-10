const S = {
  manifest: null,
  byScope: new Map(),
  scope: null,
  edition: null,
  cards: [],
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

async function boot() {
  let manifest;
  try {
    const res = await fetch("/manifest.json", { cache: "no-cache" });
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

  for (const e of manifest.editions) {
    const list = S.byScope.get(e.scope) ?? [];
    list.push(e);
    S.byScope.set(e.scope, list);
  }

  renderTabs();
  const preferred = ["nasional", "lokal", "mingguan"].find((s) => S.byScope.has(s));
  const fromHash = location.hash.split("/")[1];
  const initial = fromHash && S.byScope.has(fromHash) ? fromHash : preferred;
  await openScope(initial);
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.hidden = false;
  tabs.textContent = "";
  for (const scope of ["nasional", "lokal", "mingguan"]) {
    if (!S.byScope.has(scope)) continue;
    const b = el("button", "tab", SCOPE_LABEL[scope]);
    b.dataset.scope = scope;
    b.onclick = () => openScope(scope);
    tabs.append(b);
  }
}

async function openScope(scope) {
  const entries = S.byScope.get(scope);
  if (!entries?.length) return;
  S.scope = scope;

  const entry = entries[0];
  const res = await fetch(entry.path, { cache: "no-cache" });
  S.edition = await res.json();
  S.cards = S.edition.cards ?? [];

  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.scope === scope);

  $("dateline").textContent = formatDate(S.edition.published_at);
  $("subline").textContent =
    `${S.edition.card_count} kartu · ±${S.edition.reading_time_min} menit · ${SCOPE_LABEL[scope]}`;
  $("covline").textContent = `Liputan ${formatDate(S.edition.coverage.from)} · 05.00–05.00`;

  showFeed();
  renderFeed();
}

function showFeed() {
  $("detail").hidden = true;
  $("feed").hidden = false;
  $("bottom").hidden = false;
  if (S.scope) location.hash = `#/${S.scope}`;
  window.scrollTo(0, 0);
}

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
      if (card.body?.[0]) btn.append(el("p", "reason", card.body[0].slice(0, 160) + "…"));
    }

    btn.onclick = () => openCard(i);
    feed.append(btn);
  });

  const done = el("div", "done");
  done.append(el("div", "big", `Selesai. ${S.cards.length} kartu.`));
  done.append(el("div", "small", "Tidak ada berita lain hari ini"));
  feed.append(done);
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
  const parts = location.hash.split("/").filter(Boolean);
  if (parts.length === 2) openCard(Number(parts[1]));
});

async function setupNotifications() {
  const box = $("notifBody");
  let cfg = null;
  try {
    cfg = await (await fetch("/config.json", { cache: "no-cache" })).json();
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
    navigator.serviceWorker.register("/sw.js").then(setupNotifications).catch(() => {});
  });
}

boot();
