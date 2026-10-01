import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATE_PATH = join(ROOT, "state.json");
const RSS_PUBLIC = join(ROOT, "public", "rss.xml");
const RSS_ROOT = join(ROOT, "rss.xml");

const LIMIT = Number.parseInt(process.env.LIMIT ?? "80", 10) || 80;
const EVENTS_URL = `https://ai-tracker.ssh.codes/api/events?limit=${LIMIT}`;
const FILTER_CATEGORIES = (process.env.FILTER_CATEGORIES ?? "model-change,new-page")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RSS_PUBLIC_URL = process.env.RSS_PUBLIC_URL ?? "https://geetcr4ck.github.io/ai-tracker/";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL ?? "";
const DRY_RUN = process.env.DRY_RUN === "1";

const COLORS = { "model-change": 5814783, "new-page": 3066993 };
const FALLBACK_COLOR = 9807270;
const MAX_POST_PER_RUN = 5;

function safeHttpUrl(u) {
  if (typeof u !== "string") return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadSeen() {
  try {
    if (!existsSync(STATE_PATH)) return [];
    const j = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return Array.isArray(j.seenIds) ? j.seenIds.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function buildDescription(ev) {
  const parts = [];
  if (ev.summary) parts.push(String(ev.summary));
  const added = Array.isArray(ev.addedModels) ? ev.addedModels.filter(Boolean) : [];
  if (added.length) parts.push("Added: " + added.join(", "));
  return parts.join("\n\n");
}

function buildRss(feedEvents, selfUrl) {
  const items = feedEvents
    .map((ev) => {
      const link = safeHttpUrl(ev.url);
      const pub = ev.detectedAt ? new Date(ev.detectedAt).toUTCString() : new Date().toUTCString();
      const desc = buildDescription(ev);
      return `    <item>\n      <title>${escXml(ev.title ?? ev.id)}</title>\n${
        link ? `      <link>${escXml(link)}</link>\n` : ""
      }      <guid isPermaLink="false">${escXml(ev.id)}</guid>\n      <pubDate>${escXml(pub)}</pubDate>\n      <description>${escXml(desc)}</description>\n    </item>`;
    })
    .join("\n");
  const self = selfUrl.endsWith("/") ? selfUrl + "rss.xml" : selfUrl + "/rss.xml";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>AI Change Radar</title>\n    <link>${escXml(selfUrl)}</link>\n    <description>AI model releases (model-change, new-page) from ai-tracker</description>\n    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escXml(self)}" rel="self" type="application/rss+xml" />\n${items}\n  </channel>\n</rss>\n`;
}

function buildEmbed(ev) {
  const topic = ev.topicLabel ?? ev.topic ?? "";
  const source = ev.sourceName ?? ev.sourceId ?? "";
  const header = [topic, source].filter(Boolean).join(" · ");
  const summary = ev.summary ? String(ev.summary) : "";
  const description = (header ? header + "\n" + summary : summary).slice(0, 4000);
  const url = safeHttpUrl(ev.url);
  const added = Array.isArray(ev.addedModels) ? ev.addedModels.filter(Boolean) : [];
  const fields = [
    ...(added.length ? [{ name: "Models +", value: added.join(", ").slice(0, 1024) }] : []),
    { name: "Kategori", value: String(ev.category ?? "-").slice(0, 256), inline: true },
  ];
  const embed = {
    title: String(ev.title ?? ev.id).slice(0, 256),
    description,
    timestamp: ev.detectedAt ?? undefined,
    color: COLORS[ev.category] ?? FALLBACK_COLOR,
    fields,
  };
  if (url) embed.url = url;
  return { embeds: [embed] };
}

async function postToDiscord(ev) {
  const payload = buildEmbed(ev);
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) {
    let waitMs = 2000;
    try {
      const j = await res.json();
      if (j.retry_after) waitMs = Number(j.retry_after) * 1000 + 500;
    } catch {
      const ra = res.headers.get("retry-after");
      if (ra) waitMs = Number(ra) * 1000 + 500;
    }
    console.log(`discord 429 for ${ev.id}, retry after ${Math.round(waitMs)}ms`);
    await sleep(waitMs);
    const retry = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!retry.ok) console.log(`discord retry ${retry.status} for ${ev.id}`);
    else console.log(`discord posted (retry) ${ev.id}`);
    return retry.ok;
  }
  if (!res.ok) console.log(`discord ${res.status} for ${ev.id}`);
  else console.log(`discord posted ${ev.id}`);
  return res.ok;
}

async function main() {
  const seen = loadSeen();
  const seenSet = new Set(seen);

  const res = await fetch(EVENTS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`fetch events failed: ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];

  // TODO(v2): pertimbangkan filter lanjutan codeReferenceOnly==true (saat ini biarkan lolos).
  const filtered = events.filter((ev) => FILTER_CATEGORIES.includes(ev.category));
  const fresh = filtered.filter((ev) => ev?.id && !seenSet.has(ev.id));
  fresh.sort((a, b) => new Date(a.detectedAt) - new Date(b.detectedAt));

  // RSS: 50 event terakhir yang lolos filter (bukan cuma yang baru) agar reader stabil.
  const feedEvents = [...filtered]
    .sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))
    .slice(0, 50);
  const rss = buildRss(feedEvents, RSS_PUBLIC_URL);
  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeFileSync(RSS_PUBLIC, rss);
  writeFileSync(RSS_ROOT, rss);

  let posted = 0;
  const toPost = fresh.slice(0, MAX_POST_PER_RUN);
  const skippedQueue = fresh.length - toPost.length;
  if (DRY_RUN || !WEBHOOK) {
    console.log(`dry-run=${DRY_RUN} webhook=${WEBHOOK ? "set" : "empty"}: skip POST (${toPost.length} pending)`);
  } else {
    for (const ev of toPost) {
      const ok = await postToDiscord(ev);
      if (ok) posted++;
      await sleep(1000);
    }
  }

  // state: tandai yang sudah di-POST (atau semua fresh saat dry-run tanpa webhook? tidak —
  // hanya tandai yang diproses agar tidak hilang; dry-run TIDAK menandai agar test aman).
  let newSeen = seen;
  if (!(DRY_RUN || !WEBHOOK)) {
    const processedIds = toPost.map((e) => e.id);
    newSeen = [...seen, ...processedIds].filter((v, i, a) => a.indexOf(v) === i).slice(-500);
    writeFileSync(STATE_PATH, JSON.stringify({ seenIds: newSeen }, null, 2) + "\n");
  } else if (!existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, JSON.stringify({ seenIds: [] }, null, 2) + "\n");
  }

  console.log(
    `fetched=${events.length} filtered=${filtered.length} new=${fresh.length} posted=${posted} skipped_queue=${skippedQueue} rss_items=${feedEvents.length}`
  );
}

main().catch((e) => {
  console.error("radar failed:", e.message);
  process.exit(1);
});
