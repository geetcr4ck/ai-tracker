# AGENTS.md — AI Change Radar RSS → Discord (Rp0)

Lanjutan sesi: bangun pipeline gratis polling tracker ke Discord + RSS publik.
Skill aktif: `craft` (full, lazy/minimal), `find-skills`.

## 1. Konteks terverifikasi (jangan fetch ulang tanpa perlu)

* Site: `https://ai-tracker.ssh.codes/` — SPA, judul "AI Change Radar".
* **Tidak ada RSS native.** `GET /rss`, `/feed`, `/rss.xml`, `/feed.xml` → return `text/html` SPA yang sama. `GET /api/feed`, `/api/changes` → `404 {"error":"not found"}`.
* Sumber feed (terbukti 200):
  * `GET /api/events?limit=80` → `{events:[...]}`. Contoh event: `id`, `sourceId/sourceName`, `topic/topicLabel/tags`, `category`, `url`, `detectedAt` (ISO), `title`, `summary`, `addedModels/removedModels`, `addedBenchmarkRows`, `discordDiff`, `diff`.
  * `GET /api/topics` → daftar `{id,label}` (ada `models, docs, benchmarks, qwen, deepseek, kimi, ...`).
  * `GET /api/sources`, `/api/health` → 145 sources, `discordEnabled:true`.
  * `GET /api/stream` → SSE live (`hello`, `change`). Tidak dipakai di v1.
* Frontend: `/app.js?v=20260712-email-restore` memanggil `fetchJson("/api/topics" | "/api/events?limit=80" | "/api/sources" | "/api/health" | "/api/email-subscription-options")`.

## 2. Keputusan user (final)

* Arsitektur: **GitHub Actions cron (Rp0)**. Publish `rss.xml` ke GitHub Pages + POST ke Discord webhook.
* Filter v1: **hanya `model-change` / `new-page` model releases**, skip `benchmark-change` kecil. Filter harus mudah diubah via env/config.
* Format Discord: **rich embed**.
* Poll: **tiap 5–10 menit** (disarankan `*/10 * * * *` untuk hemat menit Actions free).

## 3. Target implementasi (minimal, craft)

Buat di repo baru/kosong, file sesedikit mungkin:

```
.github/workflows/radar.yml
scripts/radar.mjs        # fetch → filter → dedup → rss.xml → discord
state.json               # {"seenIds":[...]} — di-commit balik oleh workflow
public/rss.xml           # output, deploy ke Pages (atau rss.xml di root)
```

Tidak perlu: framework, DB, server, dependency baru. Stdlib + `fetch` bawaan Node 20+ saja.

### 3.1 Logika `scripts/radar.mjs`

1. `EVENTS_URL = https://ai-tracker.ssh.codes/api/events?limit=80`.
2. Ambil env: `DISCORD_WEBHOOK_URL` (secret), `FILTER_CATEGORIES` (default `"model-change,new-page"`), `RSS_PUBLIC_URL` (URL Pages untuk self-link), `LIMIT` default `80`.
3. Load `state.json` → `Set(seenIds)`.
4. Fetch events, filter: `FILTER_CATEGORIES.split(",").includes(event.category)`. Opsional v1: tolak `codeReferenceOnly==true`? Default biarkan lolos, catat sebagai TODO filter lanjutan.
5. Baru = `id not in seen`. Urutkan `detectedAt` ascending agar Discord kronologis.
6. Build `rss.xml` (RSS 2.0) dari max 50 event terakhir (bukan cuma yang baru, agar feed reader stabil): `title`, `link=safeHttpUrl(event.url)`, `guid=event.id`, `pubDate=detectedAt`, `description=summary + addedModels`.
7. POST tiap event baru ke Discord (max ~5 per run untuk hindari rate-limit; sisanya ikut run berikut). Payload embed:
   ```json
   {"embeds":[{"title": "<title>".slice(0,256), "url": "<http(s) only>", "description": "<topicLabel · sourceName + summary>".slice(0,4000), "timestamp": "<detectedAt>", "color": 5814783, "fields": [{"name":"Models +","value":"..."},{"name":"Kategori","value":"<category>","inline":true}]}]}
   ```
   Warna: `model-change=5814783`, `new-page=3066993`, fallback `9807270`. Validasi URL hanya `^https?://`, selain itu kirim tanpa `url`.
8. Update `state.json` (keep last 500 ids), tulis `rss.xml`/`public/rss.xml`.

### 3.2 `radar.yml`

* `on: schedule: [cron: "*/10 * * * *"], workflow_dispatch:`.
* Steps: checkout → setup-node 20 → `node scripts/radar.mjs` (env dari secrets/vars) → commit+push `state.json` + rss jika berubah → deploy Pages (gunakan `actions/deploy-pages` atau branch `gh-pages`, pilih satu saja).
* Concurrency: `group: radar` + `cancel-in-progress: false` agar tidak dobel POST.

## 4. Validasi (wajib sebelum selesai)

1. `node scripts/radar.mjs` lokal dengan webhook dummy/test: RSS valid (buka di reader), tidak ada POST duplikat di run kedua (dedup `state.json` bekerja).
2. Ubah `FILTER_CATEGORIES` → run → filter berubah tanpa edit kode.
3. Kirim 1 event asli ke channel test: embed tampil judul+link+timestamp benar, tidak ada URL non-http.
4. Cek rate-limit: sleep ~1s antar POST; log `429` + hormati `retry_after`.

## 5. Batasan & jebakan

* API bisa ramai `benchmark-change` (contoh: skor 1325→1324). Jangan longgarkan filter tanpa diskusi user.
* Jangan polling `<5 menit` (GitHub cron minimum 5 mnt, hemat kuota free 2000 mnt/bulan).
* `state.json` conflict: selalu pull/rebase sebelum push; workflow harus `git pull --rebase` atau pakai `stefanzweifel/git-auto-commit-action`.
* Discord webhook URL = secret, jangan log isinya.
* RSS self-link pakai `RSS_PUBLIC_URL` Pages final, bukan `localhost`.

## 6. Tugas sesi berikutnya (urut)

1. Inisialisasi repo + 3 file di §3.
2. Implementasi `scripts/radar.mjs` sesuai §3.1 (satu file, tanpa dep).
3. Buat `radar.yml` + Pages.
4. Test lokal + test webhook channel pribadi, buktikan no-duplikat.
5. Dokumentasikan cara ubah filter/frekuensi di README (3 baris saja).
