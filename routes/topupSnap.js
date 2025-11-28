// routes/topupSnap.js
import express from "express";
import supabase from "../utils/supabase.js";
import midtransClient from "midtrans-client";
import crypto from "crypto";

const router = express.Router();

const snap = new midtransClient.Snap({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

function generateOrderId(userId) {
  const rand = crypto.randomBytes(4).toString("hex");
  const ts = Date.now();
  return `CRYPTOKU-SNAP-${userId}-${ts}-${rand}`;
}

/**
 * POST /api/topup/snap
 */
router.post("/", async (req, res) => {
  try {
    const { amount } = req.body;
    const user = req.user;

    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "Invalid amount" });

    const userId = Number(user.id);
    const orderId = generateOrderId(userId);

    // 1. insert pending topup
    const { data: topupRow, error: insertErr } = await supabase
      .from("users_topup")
      .insert({
        user_id: userId,
        order_id: orderId,
        amount: amount,
        payment_type: "qris_snap",
        status: "pending",
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error(insertErr);
      return res.status(500).json({ error: "DB insert failed" });
    }

    // 2. Create Snap transaction
    const params = {
      transaction_details: {
        order_id: orderId,
        gross_amount: Number(amount),
      },
      //   enabled_payments: ["other_qris"],
      customer_details: {
        first_name: user.first_name || user.username || "CryptoKu User",
      },
    };

    const response = await snap.createTransaction(params);

    // 3. simpan raw response
    await supabase
      .from("users_topup")
      .update({ raw_midtrans_response: response })
      .eq("id", topupRow.id);

    return res.json({
      order_id: orderId,
      amount,
      snap_token: response.token,
      redirect_url: response.redirect_url,
    });
  } catch (err) {
    console.error("Snap error:", err);
    return res.status(500).json({ error: "Failed to create snap" });
  }
});

export default router;
