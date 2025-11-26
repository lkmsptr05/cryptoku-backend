// routes/news.js
import express from "express";
import pkg from "@vitalets/google-translate-api";

const translate = pkg.translate || pkg;

const router = express.Router();

// Cache lokal di memory (per instance server)
let cachedNews = null;
let lastFetch = 0;
const CACHE_TTL = 1000 * 60 * 10; // 10 menit

// Limit NewsAPI per hari
let newsApiCountToday = 0;
let newsApiLastResetDay = new Date().toDateString(); // contoh: "Mon Nov 25 2025"

/**
 * Translate EN → ID
 * Fallback otomatis ke English kalau error
 */
async function translateToID(text) {
  if (!text) return "";

  try {
    const res = await translate(text, { to: "id" });
    if (!res?.text) return text;
    return res.text;
  } catch (err) {
    console.error("[Translate error]:", err?.message || err);
    return text; // fallback ke English asli
  }
}

router.get("/crypto", async (req, res) => {
  const now = Date.now();

  // 🔁 reset counter harian kalau hari sudah ganti
  const todayStr = new Date().toDateString();
  if (todayStr !== newsApiLastResetDay) {
    newsApiLastResetDay = todayStr;
    newsApiCountToday = 0;
  }

  // 🧠 kalau cache masih fresh → langsung pakai cache
  if (cachedNews && now - lastFetch < CACHE_TTL) {
    return res.json({
      success: true,
      totalResult: cachedNews.length,
      articles: cachedNews,
      cached: true,
      quota: {
        usedToday: newsApiCountToday,
        limit: 1000,
      },
    });
  }

  // ⛔ kalau sudah melewati quota NewsAPI harian
  if (newsApiCountToday >= 1000) {
    if (cachedNews) {
      // Masih bisa kasih data dari cache lama
      return res.json({
        success: true,
        totalResult: cachedNews.length,
        articles: cachedNews,
        cached: true,
        quota: {
          usedToday: newsApiCountToday,
          limit: 1000,
          exceeded: true,
        },
      });
    }

    // Tidak ada cache & quota habis
    return res.status(429).json({
      success: false,
      message: "Kuota NewsAPI untuk hari ini sudah habis.",
      articles: [],
      quota: {
        usedToday: newsApiCountToday,
        limit: 1000,
        exceeded: true,
      },
    });
  }

  try {
    const url = new URL("https://newsapi.org/v2/everything");

    url.searchParams.set("q", "crypto");
    url.searchParams.set("language", "en");
    url.searchParams.set("pageSize", "5"); // batas 5 biar ga berat
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("apiKey", process.env.NEWS_API_KEY);

    // 🧮 hit NewsAPI → naikkan counter sehari
    newsApiCountToday += 1;

    const response = await fetch(url.toString());

    if (!response.ok) {
      const text = await response.text();
      console.error("NewsAPI Error:", text);
      return res.status(502).json({
        success: false,
        message: "News API gagal",
        articles: [],
        quota: {
          usedToday: newsApiCountToday,
          limit: 1000,
        },
      });
    }

    const json = await response.json();
    const rawArticles = json.articles || [];

    const articles = await Promise.all(
      rawArticles.map(async (a) => {
        const title = a.title || "";
        const description = a.description || "";

        // content NewsAPI sering ada "... [+123 chars]"
        const contentRaw = a.content || "";
        const contentShort = contentRaw.split("[+")[0];

        // translate (fallback ke EN kalau error)
        const [title_id, description_id, content_id] = await Promise.all([
          translateToID(title),
          translateToID(description),
          translateToID(contentShort),
        ]);

        return {
          source: a.source,
          author: a.author,

          // teks asli (EN)
          title,
          description,
          content: contentShort,

          // teks terjemahan (ID)
          title_id,
          description_id,
          content_id,

          url: a.url,
          urlToImage: a.urlToImage,
          publishedAt: a.publishedAt,
        };
      })
    );

    // simpan ke cache
    cachedNews = articles;
    lastFetch = now;

    res.json({
      success: true,
      totalResult: json.totalResults || articles.length,
      articles,
      quota: {
        usedToday: newsApiCountToday,
        limit: 1000,
      },
    });
  } catch (err) {
    console.error("News error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      articles: [],
      quota: {
        usedToday: newsApiCountToday,
        limit: 1000,
      },
    });
  }
});

export default router;
