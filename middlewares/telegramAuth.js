// middlewares/telegramAuth.js
import { verifyTelegramInitData } from "../utils/verifyTelegram.js";

export default async function telegramAuth(req, res, next) {
  try {
    const initData = req.headers["x-telegram-init-data"];
    // console.log(initData);

    console.log(process.env.TG_BOT_TOKEN);
    if (!initData) {
      return res.status(401).json({ error: "Unauthorized: initData missing" });
    }
    // verifikasi signature dengan BOT_TOKEN yang sama seperti di auth
    const result = verifyTelegramInitData(initData, process.env.TG_BOT_TOKEN);

    if (!result.ok) {
      console.warn("[TG AUTH] invalid signature:", result.error);
      return res.status(401).json({ error: "Unauthorized: invalid signature" });
    }

    // set req.user dari payload Telegram
    req.user = result.user; // { id, username, first_name, ... }

    next();
  } catch (err) {
    console.error("[TG AUTH] ERROR:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
