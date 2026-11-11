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

- **Published editions are immutable.** Never rebuild a date that already
  exists. Test with `--newsroom-limit 2 --thin` on a new date, or use the POC.
- **CI uses OpenCode v2 → DeepSeek fallback.** Install with
  `https://opencode.ai/v2/install` (v2.2.7). v1 has no `auth import`.
  Never let OpenCode setup block a deploy: on failure, set
  `OPENCODE_BIN=/nonexistent` and continue.
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
   npm run serve   # :8080
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

## Read next

- `AGENTS.md` — operational rules, gotchas, debugging table.
- `SESSION-LEARNINGS.md` — what broke and why, with evidence.
- `SCHEMA.md` — `edition.json` contract, meta card fields.
- `NEWSROOM.md` / `NEWSROOM-IMPLEMENTATION.md` — five roles, P1–P5 status.
- `RANKING.md` / `CLUSTERING.md` — local rules, singleton briefs, topic merge.
