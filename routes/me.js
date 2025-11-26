// routes/me.js
import express from "express";
import supabase from "../utils/supabase.js";

const router = express.Router();

/**
 * GET /me
 * Ambil:
 * - data user
 * - saldo
 * - wallet addresses
 */
router.get("/", async (req, res) => {
  const userId = Number(req.user?.id); // ✅ FIXED

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  try {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userErr || !user) {
      console.error("Get user error:", userErr?.message);
      return res.status(500).json({
        success: false,
        message: "Gagal mengambil data user",
      });
    }

    const { data: balanceRow, error: balanceErr } = await supabase
      .from("users_balance")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (balanceErr) {
      console.error("Get balance error:", balanceErr.message);
    }

    const { data: wallets, error: walletsErr } = await supabase
      .from("user_wallet_address")
      .select("*")
      .eq("user_id", userId);

    if (walletsErr) {
      console.error("Get wallets error:", walletsErr.message);
    }

    return res.json({
      success: true,
      data: {
        user,
        balance: {
          balance_available: balanceRow?.balance_available ?? 0,
          balance_locked: balanceRow?.balance_locked ?? 0,
          balance_total_in: balanceRow?.balance_total_in ?? 0,
          balance_total_out: balanceRow?.balance_total_out ?? 0,
        },
        wallets: wallets || [],
      },
    });
  } catch (err) {
    console.error("ME endpoint fatal error:", err);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server",
    });
  }
});

/**
 * GET /me/balance
 */
router.get("/balance", async (req, res) => {
  const userId = Number(req.user?.id);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  const { data, error } = await supabase
    .from("users_balance")
    .select("*")
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
      balance_locked: data.balance_locked,
      total_in: data.balance_total_in,
      total_out: data.balance_total_out,
    },
  });
});

router.get("/balance/history", async (req, res) => {
  try {
    const userId = req.user?.id; // <- dari middleware auth Telegram kamu

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitParam) ? 20 : Math.min(limitParam, 50);
    const before = req.query.before; // optional

    let query = supabase
      .from("users_balance_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/me/balance/history error:", error);
      return res.status(500).json({ error: "Failed to fetch history" });
    }

    const nextCursor =
      data && data.length === limit ? data[data.length - 1].created_at : null;

    return res.json({
      items: data || [],
      nextCursor,
    });
  } catch (err) {
    console.error("GET /api/me/balance/history exception:", err);
    return res.status(500).json({
      error: err?.message || "Internal server error",
    });
  }
});

/**
 * (Opsional) GET /me/user
 */
router.get("/user", async (req, res) => {
  const userId = Number(req.user?.id); // ✅ FIXED

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Get user error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data user",
    });
  }

  res.json({
    success: true,
    data,
  });
});

export default router;
