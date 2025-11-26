// utils/translate.js
import { translate } from "@vitalets/google-translate-api";

/**
 * Translate EN -> ID menggunakan @vitalets/google-translate-api
 * Fallback otomatis: kalau error / diblok / apapaun → balikin text asli (EN)
 */
export async function translateToID(text) {
  if (!text) return "";

  try {
    const { res } = await translate(text, {
      to: "id",
      // from: "en", // optional
    });

    // kalau somehow kosong, fallback juga
    if (!res?.text) return text;

    return res.text;
  } catch (err) {
    console.error("[translateToID] error:", err?.message || err);
    return text; // ✅ fallback ke English
  }
}
