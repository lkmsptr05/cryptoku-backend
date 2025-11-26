// routes/topupCallback.js
import express from "express";
import crypto from "crypto";
import supabase from "../utils/supabase.js";

const router = express.Router();
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

function verifyMidtransSignature(
  orderId,
  statusCode,
  grossAmount,
  signatureKey
) {
  const raw = orderId + statusCode + grossAmount + MIDTRANS_SERVER_KEY;
  const hash = crypto.createHash("sha512").update(raw).digest("hex");
  return hash === signatureKey;
}

router.post("/midtrans-callback", async (req, res) => {
  const body = req.body;

  try {
    const {
      order_id,
      status_code,
      gross_amount,
      transaction_status,
      fraud_status,
      signature_key,
      transaction_id,
    } = body;

    // 1) verify signature
    const valid = verifyMidtransSignature(
      order_id,
      status_code,
      gross_amount,
      signature_key
    );

    if (!valid) {
      console.warn("Invalid Midtrans signature:", order_id);
      return res.status(403).send("Invalid signature");
    }

    // 2) ambil topup row
    const { data: topupRow, error: fetchErr } = await supabase
      .from("users_topup")
      .select("*")
      .eq("order_id", order_id)
      .single();

    if (fetchErr || !topupRow) {
      console.error("Topup not found for order:", order_id, fetchErr);
      return res.status(404).send("Topup not found");
    }

    // simpan callback
    await supabase
      .from("users_topup")
      .update({
        raw_midtrans_callback: body,
        midtrans_transaction_id:
          transaction_id || topupRow.midtrans_transaction_id,
      })
      .eq("id", topupRow.id);

    // kalau sudah success, jangan double add saldo
    if (topupRow.status === "success") {
      return res.status(200).send("OK already processed");
    }

    if (transaction_status === "settlement" && fraud_status === "accept") {
      const amount = Number(topupRow.amount);

      // 3) update status topup
      const { error: updTopupErr } = await supabase
        .from("users_topup")
        .update({
          status: "success",
          updated_at: new Date().toISOString(),
        })
        .eq("id", topupRow.id);

      if (updTopupErr) {
        console.error("Failed update topup:", updTopupErr);
        return res.status(500).send("Failed update topup");
      }

      // 4) update saldo user
      const { data: balRow, error: balErr } = await supabase
        .from("users_balance")
        .select("*")
        .eq("user_id", topupRow.user_id)
        .single();

      if (balErr || !balRow) {
        console.error("Get balance err:", balErr);
        return res.status(500).send("Failed get balance");
      }

      const newAvailable = Number(balRow.balance_available) + amount;
      const newTotalIn = Number(balRow.balance_total_in) + amount;

      const { error: updBalErr } = await supabase
        .from("users_balance")
        .update({
          balance_available: newAvailable,
          balance_total_in: newTotalIn,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", topupRow.user_id);

      if (updBalErr) {
        console.error("Update balance err:", updBalErr);
        return res.status(500).send("Failed update balance");
      }

      return res.status(200).send("OK");
    }

    // kalau failed / expire
    if (
      transaction_status === "expire" ||
      transaction_status === "cancel" ||
      transaction_status === "deny"
    ) {
      await supabase
        .from("users_topup")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", topupRow.id);

      return res.status(200).send("OK failed");
    }

    // status pending / lainnya
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Midtrans callback error:", err);
    return res.status(500).send("Internal error");
  }
});

export default router;
