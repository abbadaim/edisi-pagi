---
name: Edisi Pagi
description: Work on the Edisi Pagi project — newsroom pipeline, daily/Sleman/weekly editions, PWA shell, meta cards, and GitHub Actions deploys. Use for any task in this repository.
---

# Edisi Pagi

A personal Indonesian morning brief for one reader in Sleman, DIY. It explains
what happened, what is true, what was missed, and what is misunderstood. One
phone, no feed, no ads, push only once a day.

## Before touching code

1. Read `AGENTS.md` first, then `SESSION-LEARNINGS.md` for recent pitfalls.
2. Check `docs/PLAN-INDEX.md` before starting anything. If the change is not a
   plan yet, write one from `docs/plans/_TEMPLATE.md` and stop at
   `plan-draft`. Never implement before a human marks `mockup-approved`
   (`docs/WORKFLOW.md`).
2. Check the actual state, not the docs:
   ```bash
   git pull --rebase --autostash origin main
   git log --oneline -5
   gh run list --workflow daily.yml --limit 3
   ls data/editions/
   ```
3. Install and migrate:
   ```bash
   npm ci
   npm run migrate
   npm test
   npm run typecheck
   ```

## Architecture in one screen

```
ingest → cluster → adjudicate → planner → rank/select
                                      │
                                      ▼
                        riset → writer → editor → repair fakta
                                      │
                                      └→ kartu + disclaimer + unresolved
                                      ▼
                              validate → publish → Pages
```

| Area | Files |
|---|---|
| Daily orchestration | `scripts/build.ts` |
| Tanya AI | `src/core/ask/*` (`config`, `retrieve`, `cite`, `gather`, `answer`), `scripts/ask.ts`, `#/tanya` |
| Pantau pembaca | `src/core/newsroom/watch.ts`, `scripts/watch.ts`, ledger `editor_notes` |
| Supabase schema | `supabase/001…003.sql` — SQL Editor, never `npm run migrate` |
| Weekly recap | `scripts/weekly.ts` |
| Newsroom roles | `src/core/newsroom/*` (plan, material, write, edit, card, notes, desk) |
| Meta cards | `src/core/newsroom/meta.ts` |
| Dedupe | `src/core/newsroom/dedupe.ts` |
| Local/Sleman rules | `src/core/rank.ts` |
| Topic merge | `src/core/merge.ts` |
| PWA shell | `public/app.js`, `public/index.html`, `public/style.css`, `public/sw.js` |
| Publish | `scripts/publish.ts` |
| Push | `scripts/push.ts` |
| CI | `.github/workflows/daily.yml`, `opencode-smoke.yml` |

## Non-negotiables

- **Answers are not editions.** `public/answers/<id>.json` never enters
  `cards[]`, `latest_by_scope`, dedupe, or the desk (`DEC-0032`).
- **Citation or withhold.** The model cites material ids (`s1`), never URLs;
  quotes must be found in the text we hold, and sentences quoting anything else
  are dropped one by one (`DEC-0033`). If nothing survives, the answer is
  withheld — that is a success, not a bug.
- **Web search needs an explicit provider.** `opencode.json` sets
  `websearch.provider` + `allow`; without it headless runs stop at a provider
  prompt that `run` cannot answer (`DEC-0034`).
- **Outside URLs are fetched and verified by us**, never trusted from a search
  snippet, and never fetched from private hosts (`isPublicHttpUrl`).
- **Identity is the write boundary**, not a PIN and not a device token
  (`DEC-0031`). The publishable key may ship; `service_role`/`sb_secret_` may not.
- **Prompt text lives in git; only knobs live in the app** (`DEC-0036`).
- **Reader watches ride the existing note ledger** (`source='reader'`) so quota,
  closing-quote rules and `markAnswered` apply unchanged (`DEC-0037`).

- **Published editions are immutable.** Never rebuild a date that already
  exists. Test with `--newsroom-limit 2 --thin` on a new date, or use the POC.
- **OpenCode is the only LLM provider.** DeepSeek's direct API is opt-in only
  (`LLM_PROVIDER=deepseek`) because it costs the owner real money per token
  (`DEC-0016`). Install with `https://opencode.ai/v2/install` (v2.2.7); v1 has
  no `auth import`.
  Never let OpenCode setup block a deploy: on failure, set
  `OPENCODE_BIN=/nonexistent` and let the deterministic writer run — do not
  "fix" it by enabling DeepSeek.
- **`change` uses status only.** Number comparison without units produced a
  false “2026 → 28”. Do not re-enable numbers until extraction understands
  units and context.
- **`misread` needs three guards:** full text from `article_text` (≥500 chars),
  a quoted sentence that shares subject words with the headline, and a headline
  that does not already contain a qualifier synonym (`belum`, `wacana`,
  `rencana`, `diduga`, …).
- **Meta cards are exempt from dedupe and desk review.** Their titles resemble
  the news card they discuss.
- **Local briefs may have one source; national needs two.** A local topic needs
  a DIY-majority cluster *and* a Sleman/DIY place marker.
- **`fallbackTopics(summarise([cluster]))` always gives `cid: "c01"`.** For solo
  local briefs, assign a unique `solo_<cluster-key>` cid or they will be
  mistaken for follow-ups and dropped.
- **All web paths are relative.** The site lives at `/edisi-pagi/`; absolute
  `/style.css` breaks the app at “Memuat…”.
- **Timestamps in cards use `+07:00`.** `articles.published_at` is UTC (`Z`)
  and fails the schema; use the card’s normalized source timestamp.
- **Dedupe before `buildEdition`**, national 0.6 / local 0.5, but never merge
  meta cards or hoax with news.
- **Never commit** `.env.local`, `local.db`, `data/state/*.db`, or
  `OPENCODE_AUTH_JSON`.

## Editing workflow

1. Change one policy at a time; add one test that locks it.
2. Run unit tests and typecheck.
   ```bash
   npm test            # termasuk tests/ui-static.test.ts (path, ?v=, subpath, push payload)
   npm run typecheck
   npm run test:ui     # browser: nav, render, offline, chip misread (workflow ui.yml)
   ```
3. For pipeline changes, do a cheap build first:
   ```bash
   LLM_PROVIDER=deepseek npm run build -- --newsroom-limit 2 --thin --date <new-date>
   ```
4. Validate every edited edition:
   ```bash
   npm run validate -- data/editions/<date>.nasional.json
   ```
5. Publish and inspect locally:
   ```bash
   npm run publish
   npm run serve                            # akar domain
   BASE_PATH=/edisi-pagi npm run serve      # meniru produksi; pakai ini untuk bug path
   ```
6. Commit, `git pull --rebase --autostash`, push. Check `origin/main`
   afterwards; the bot and other agents may push concurrently.

## Verification skills

```bash
# Live manifest and cards
curl -s https://abbadaim.github.io/edisi-pagi/manifest.json | python3 -m json.tool
curl -s https://abbadaim.github.io/edisi-pagi/data/editions/<date>.nasional.json \
  | python3 -c 'import json,sys; e=json.load(sys.stdin); [print(c["type"], c["title"][:60]) for c in e["cards"]]'

# Validate and test
npm run validate -- data/editions/<date>.nasional.json
npm test && npm run typecheck

# OpenCode CI smoke (no editions touched)
gh workflow run opencode-smoke.yml --repo abbadaim/edisi-pagi
```

### After deploy — is the cron alive?

Run this after any deploy, publish, or workflow edit. `active` alone is **not**
proof: GitHub can drop a scheduled trigger while the workflow still says
`active` (happened on 2026-11-12; the edition simply did not exist that day).

```bash
# 1. workflow must be active, not disabled_manually
gh workflow list --all | grep -E "^edisi-harian"

# 2. the cron must still exist on main (editing the file can drop it)
git show origin/main:.github/workflows/daily.yml | grep -A2 "schedule:"

# 3. a run for today must exist — this is the real proof
TZ=Asia/Jakarta date +%F
gh run list --workflow daily.yml --limit 3

# 4. today's edition must actually be live
curl -s https://abbadaim.github.io/edisi-pagi/manifest.json \
  | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["latest"], m["latest_by_scope"])'
```

If `latest_by_scope.nasional` is not today's WIB date **and** there is no run,
the trigger was dropped: `gh workflow run daily.yml --ref main`. Do this only
when the edition for that date does not exist yet — `scripts/build.ts` has no
guard and will overwrite a published edition (`docs/plans/009-schedule-verification.md`).

Browser checklist:

1. `latest_by_scope` in the manifest matches what the tabs show.
2. Bottom nav: Edisi / Sleman / Mingguan (if any) / Atur.
3. `#/atur`: Pasang, Notifikasi, Tentang.
4. `misread` detail shows “Kata yang hilang dari judul”; `change` shows the
   before/after timeline.
5. Offline: stop the local server and reload; the cached shell and last edition
   must render.
6. Before testing a new `app.js`, clear caches and unregister the service
   worker.

## Verification skills — Tanya AI

```bash
# Skema Supabase (SQL Editor di dasbor, bukan CLI)
#   001_init → 002_dispatch (PAT di Vault) → 003_watch

npm run ask -- --id <ask_id> --debug     # satu pertanyaan + keluaran mentah model
npm run watch                            # sync pantau (dipakai daily.yml)
WATCH_WINDOW_HOURS=240 npm run watch     # uji dengan basis data lama

gh run list --workflow tanya.yml --limit 3     # event harus repository_dispatch
gh run view <id> --log | grep -E "auth:|bahan:|jawaban:"

# trigger dispatch: 204 = diterima, 401 = PAT, 404 = repo/izin
# select status_code, content from net._http_response order by created desc limit 5;
```

Sanity check yang murah sebelum menyalahkan model: `bahan: N` di log. `N = 0`
berarti arsip, `N = 1` berarti tipis (model perlu didorong mencari), `N >= 2`
berarti keluaran model yang cacat.

## When it breaks

| Symptom | Check |
|---|---|
| App stuck at “Memuat…” | Absolute paths, `app.js` 404, stale service worker |
| Scope tab missing | `manifest.latest_by_scope`, edition date |
| Sleman edition empty | `lokal: N kandidat · M lolos` log, `cid` collision, dedupe, minimum 2 |
| Meta card missing | `meta: … · lanjut x/y · teks a/b · celah c`; dedupe; title qualifier |
| CI state empty | `edisi-state-` cache, `.gitignore`, `npm run state:info` |
| Deploy skipped after success | commit/push step, `continue-on-error`, failed optional step |
| Push opens wrong page | payload URL must be `./`, resolved against SW scope |
| CI falls back to DeepSeek | OpenCode version/install, `OPENCODE_AUTH_JSON`, `OPENCODE_BIN` |
| Tanya: "tidak ada sitasi" | `--debug`; bandingkan bentuk `sitasi` model dengan contoh JSON di `config/tanya.json` |
| Tanya menolak padahal ada bahan | `bahan: N` di log; <2 = arsip tipis, cek `cari.enabled` + `izin_luar_bahan` |
| Websearch mati di CI | `opencode.json` (`websearch.provider`, izin `allow`); `--auto` tidak menjawab prompt penyedia |
| Watch tidak bergerak | `source` di `editor_notes` harus `reader`; SELECT di `loadLedger` harus memuat kolom baru |
| Pantau tanpa tautan edisi | `report` butuh `supabase/003_watch.sql` |

## Read next

- `AGENTS.md` — operational rules, gotchas, debugging table.
- `SESSION-LEARNINGS.md` — what broke and why, with evidence.
- `SCHEMA.md` — `edition.json` contract, meta card fields.
- `NEWSROOM.md` / `NEWSROOM-IMPLEMENTATION.md` — five roles, P1–P5 status.
- `RANKING.md` / `CLUSTERING.md` — local rules, singleton briefs, topic merge.
