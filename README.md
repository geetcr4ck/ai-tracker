# ai-tracker

Ubah filter: set `FILTER_CATEGORIES` cth `model-change,new-page` + `FILTER_TOPICS` cth `artificial-analysis,deepswe` (Actions variables, logika OR).
Ubah frekuensi: edit `cron` di `.github/workflows/radar.yml` (min `*/5 * * * *`).
Ubah URL feed: set `RSS_PUBLIC_URL` (Actions variables) ke URL GitHub Pages final.
Ubah sumber API: set `EVENTS_URL` (Actions variable, base URL saja — `?limit=` otomatis ditambahkan).
Tahan gangguan sumber: `FETCH_ATTEMPTS` (default 4) + `FETCH_TIMEOUT_MS` (default 20000); kalau sumber tetap down, run di-skip (hijau) dan RSS lama dipertahankan.
