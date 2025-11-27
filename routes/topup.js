// routes/topup.js
import express from "express";
import supabase from "../utils/supabase.js";
import { chargeQris } from "../utils/midtransCore.js";

const router = express.Router();

// Helper bikin order_id unik
function generateOrderId(userId) {
  const rand = crypto.randomBytes(4).toString("hex");
  const ts = Date.now();
  return `CRYPTOKU-${userId}-${ts}-${rand}`;
}

router.post("/qris", async (req, res) => {
  try {
    const { amount } = req.body;
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const userId = Number(user.id);
    const orderId = generateOrderId(userId);

    // 1) Insert ke users_topup (pending)
    const { data: topupRow, error: insertErr } = await supabase
      .from("users_topup")
      .insert({
        user_id: userId,
        order_id: orderId,
        amount: amount,
        payment_type: "qris",
        status: "pending",
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("Insert users_topup error:", insertErr);
      return res.status(500).json({ error: "DB insert error" });
    }

    // 2) Call Midtrans Core API /charge
    const midtransRes = await chargeQris({
      orderId,
      grossAmount: amount,
      customerName: user.first_name || user.username || "CryptoKu User",
    });

    const { transaction_id, actions, qr_string } = midtransRes;

    // 3) Update users_topup dengan transaction_id + raw response
    const { error: updateErr } = await supabase
      .from("users_topup")
      .update({
        midtrans_transaction_id: transaction_id || null,
        raw_midtrans_response: midtransRes,
      })
      .eq("id", topupRow.id);

    if (updateErr) {
      console.error("Update users_topup error:", updateErr);
    }

    // 4) Ambil QR URL
    let qrUrl = null;
    if (Array.isArray(actions)) {
      const qrAction = actions.find(
        (a) =>
          a.name === "qris-qr" ||
          a.name === "generate-qr-code" ||
          a.method === "GET"
      );
      if (qrAction) qrUrl = qrAction.url;
    }

    return res.json({
      order_id: orderId,
      amount,
      qr_url: qrUrl,
      qr_string: qr_string || null,
    });
  } catch (err) {
    console.error("QRIS charge error:", err?.response?.data || err);
    return res.status(500).json({
      error: "Failed to create QRIS charge",
      detail: err?.response?.data || err?.message,
    });
  }
});

// BONUS: saldo & history sekalian
router.get("/balance", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const userId = Number(user.id);

  const { data, error } = await supabase
    .from("users_balance")
    .select("balance_available")
    .eq("user_id", userId)
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to get balance" });
  }

  res.json({ balance: data.balance_available });
});

router.get("/history", async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const userId = Number(user.id);

  const { data, error } = await supabase
    .from("users_topup")
    .select("id, order_id, amount, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to get topup history" });
  }

  res.json({ history: data });
});

export default router;
