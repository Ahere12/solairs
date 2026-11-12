// Minecraft news for the Home page (Mojang's public launcher news feed). Cached for an hour.
const { getJSON } = require('./util');

const FEED = 'https://launchercontent.mojang.com/v2/news.json';
const BASE = 'https://launchercontent.mojang.com';
let cache = null, cachedAt = 0;

async function minecraft({ limit = 8 } = {}) {
  if (!cache || Date.now() - cachedAt > 60 * 60 * 1000) {
    const d = await getJSON(FEED);
    cache = (d.entries || [])
      .filter((e) => (e.newsType || []).includes('Java')) // Java Edition news only
      .map((e) => ({
        id: e.id, title: e.title, text: e.text, date: e.date, tag: e.tag || '', category: e.category || '',
        image: e.playPageImage?.url ? BASE + e.playPageImage.url : e.newsPageImage?.url ? BASE + e.newsPageImage.url : null,
        link: /^https:\/\//.test(e.readMoreLink || '') ? e.readMoreLink : null,
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    cachedAt = Date.now();
  }
  return cache.slice(0, limit);
}

module.exports = { minecraft };
