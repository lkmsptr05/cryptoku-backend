// routes/me.js
import express from "express";
import supabase from "../utils/supabase.js";

const router = express.Router();

// versi simple: ?user_id=123 (telegram_id)
// nanti idealnya pakai middleware auth Telegram dan req.userId
router.get("/balance", async (req, res) => {
  const userId = Number(req.query.user_id || req.userId);

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "user_id tidak ditemukan",
    });
  }

  const { data, error } = await supabase
    .from("users_balance")
    .select("balance_available")
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error("Get balance error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil saldo",
    });
  }

  res.json({
    success: true,
    data: {
      balance_available: data.balance_available,
    },
  });
});

export default router;
