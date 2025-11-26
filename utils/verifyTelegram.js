// utils/verifyTelegram.js
import { validate, parse } from "@telegram-apps/init-data-node";

export function verifyTelegramInitData(initData, botToken) {
  try {
    // Validasi signature
    validate(initData, botToken);
    // Parse ke object
    const data = parse(initData);

    if (!data?.user) return null;

    return {
      ok: true,
      user: data.user,
    };
  } catch (err) {
    console.error("Telegram validation error:", err.message);
    return null;
  }
}
