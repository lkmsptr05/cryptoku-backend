// routes/authTelegram.js
import express from "express";
import supabase from "../utils/supabase.js";
import { verifyTelegramInitData } from "../utils/verifyTelegram.js";

const router = express.Router();

router.post("/telegram", async (req, res) => {
  try {
    const { initData } = req.body;
    const result = verifyTelegramInitData(initData, process.env.TG_BOT_TOKEN);

    if (!result) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Telegram WebApp data" });
    }

    const { user } = result; // user dari Telegram

    const telegramId = user.id;
    const username = user.username || null;
    const firstName = user.first_name || null;
    const lastName = user.last_name || null;
    const photoUrl = user.photo_url || null;

    // upsert ke table users
    const { error } = await supabase.from("users").upsert(
      {
        id: telegramId, // sesuai design: id = telegram_id (bigint)
        username: username,
        first_name: firstName,
        last_name: lastName,
        photo_url: photoUrl,
        last_login: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("Supabase users upsert error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Gagal menyimpan user",
      });
    }

    // kalau kamu pakai trigger, row users_balance akan dibuat otomatis
    // di sini kita bisa balikin info user yang dipakai frontend
    return res.json({
      success: true,
      user: {
        id: telegramId,
        username,
        first_name: firstName,
        last_name: lastName,
        photo_url: photoUrl,
      },
    });
  } catch (err) {
    console.error("Auth telegram error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

export default router;
