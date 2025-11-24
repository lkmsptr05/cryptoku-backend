// utils/verifyTelegram.js
import crypto from "crypto";

/**
 * Verifikasi initData dari Telegram WebApp.
 * Return: { user, authDate } kalau valid, atau null kalau tidak valid.
 */
export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // Susun data_check_string
  const dataToCheck = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    dataToCheck.push(`${key}=${value}`);
  }
  dataToCheck.sort();
  const dataCheckString = dataToCheck.join("\n");

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // check_hash = HMAC_SHA256(secret_key, data_check_string)
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) {
    return null;
  }

  // Ambil user dari param "user"
  const userJson = params.get("user");
  if (!userJson) return null;

  let user;
  try {
    user = JSON.parse(userJson);
  } catch {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);

  // Optional: tolak kalau lebih dari 24 jam
  const nowSec = Math.floor(Date.now() / 1000);
  const maxAgeSec = 24 * 60 * 60;
  if (authDate && nowSec - authDate > maxAgeSec) {
    // kalau mau strict
    // return null;
  }

  return { user, authDate };
}
