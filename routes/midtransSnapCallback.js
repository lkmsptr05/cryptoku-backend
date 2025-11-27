// routes/midtransSnapCallback.js
import express from "express";
import supabase from "../utils/supabase.js";
import crypto from "crypto";

const router = express.Router();

// Verifikasi signature dari Midtrans
function verifySignature(notification) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;

  const hash = crypto
    .createHash("sha512")
    .update(
      notification.order_id +
        notification.status_code +
        notification.gross_amount +
        serverKey
    )
    .digest("hex");

  return hash === notification.signature_key;
}

// Helper format rupiah untuk teks notifikasi
function formatRupiah(num) {
  if (num == null) return "";
  return new Intl.NumberFormat("id-ID").format(Number(num));
}

router.post("/callback", express.json(), async (req, res) => {
  try {
    const notification = req.body;

    // 0. Verifikasi signature
    if (!verifySignature(notification)) {
      console.error("❌ Invalid Midtrans signature");
      return res.status(403).json({ message: "Invalid signature" });
    }

    const orderId = notification.order_id;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    // 1. Ambil topup berdasarkan order_id
    const { data: existingTopup, error: fetchErr } = await supabase
      .from("users_topup")
      .select("*")
      .eq("order_id", orderId)
      .single();

    if (fetchErr || !existingTopup) {
      console.error("Topup not found for order_id:", orderId, fetchErr);
      // Tetap balas 200 supaya Midtrans tidak spam retry
      return res.status(200).json({ message: "Topup not found, logged" });
    }

    const previousStatus = existingTopup.status;

    // 2. Map status Midtrans → status internal
    let newStatus = previousStatus;

    if (transactionStatus === "capture") {
      if (fraudStatus === "accept") newStatus = "success";
      else newStatus = "pending";
    } else if (transactionStatus === "settlement") {
      newStatus = "success";
    } else if (
      transactionStatus === "cancel" ||
      transactionStatus === "deny" ||
      transactionStatus === "expire"
    ) {
      if (previousStatus !== "success") {
        newStatus = "failed";
      }
    } else if (transactionStatus === "pending") {
      if (previousStatus === "pending") {
        newStatus = "pending";
      }
    }

    // 3. Kalau sebelumnya sudah success → jangan diproses lagi (idempotent)
    if (previousStatus === "success") {
      console.log("Topup already success, skip:", orderId);
      return res.status(200).json({ message: "Already success" });
    }

    // 4. Update users_topup dengan status baru + simpan callback raw
    const { data: updatedTopup, error: updateErr } = await supabase
      .from("users_topup")
      .update({
        status: newStatus,
        raw_midtrans_callback: notification,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .select("*")
      .single();

    if (updateErr) {
      console.error("Update topup error:", updateErr);
      return res.status(200).json({ message: "Logged but update failed" });
    }

    const userId = updatedTopup.user_id;
    const topupAmount = Number(updatedTopup.amount);

    // =============================
    // 5. Kalau SUCCESS → update saldo + history + notif
    // =============================
    if (previousStatus !== "success" && newStatus === "success") {
      // 5a. Ambil saldo sebelum topup
      let beforeAvailable = 0;
      let beforeLocked = 0;

      const { data: balanceRow, error: balanceFetchErr } = await supabase
        .from("users_balance")
        .select("balance_available, balance_locked")
        .eq("user_id", userId)
        .single();

      // PGRST116 = no rows, artinya belum punya balance, kita anggap 0
      if (balanceFetchErr && balanceFetchErr.code !== "PGRST116") {
        console.error("Fetch balance error:", balanceFetchErr);
      } else if (balanceRow) {
        beforeAvailable = Number(balanceRow.balance_available || 0);
        beforeLocked = Number(balanceRow.balance_locked || 0);
      }

      const afterAvailable = beforeAvailable + topupAmount;
      const afterLocked = beforeLocked;

      // 5b. Update saldo via function increment_balance (update balance_total_in juga)
      const { error: incErr } = await supabase.rpc("increment_balance", {
        p_user_id: userId,
        p_amount: topupAmount,
      });

      if (incErr) {
        console.error("increment_balance error:", incErr);
      }

      // 5c. Insert ke users_balance_history
      const { error: historyErr } = await supabase
        .from("users_balance_history")
        .insert({
          user_id: userId,
          change_type: "topup",
          amount: topupAmount,
          balance_available_before: beforeAvailable,
          balance_available_after: afterAvailable,
          balance_locked_before: beforeLocked,
          balance_locked_after: afterLocked,
          related_topup_id: updatedTopup.id,
          related_order_id: null,
          note: "Top up saldo via CryptoKu",
          metadata: {
            midtrans_status: transactionStatus,
            midtrans_fraud_status: fraudStatus,
            order_id: orderId,
          },
        });

      if (historyErr) {
        console.error("Insert balance_history error:", historyErr);
      }

      // 5d. Buat notifikasi topup_success
      const nominalText = formatRupiah(topupAmount);
      const saldoText = formatRupiah(afterAvailable);

      const { error: notifErr } = await supabase
        .from("user_notifications")
        .insert({
          user_id: userId,
          type: "topup_success",
          title: "✅ Top Up Berhasil",
          body: `Yeay! Saldo kamu berhasil ditambah Rp ${nominalText}.\n\nSaldo saat ini: Rp ${saldoText}`,
          related_topup_id: updatedTopup.id,
          metadata: {
            topup_id: updatedTopup.id,
            order_id: orderId,
            amount: topupAmount,
          },
        });

      if (notifErr) {
        console.error("Insert notification error:", notifErr);
      }
    }

    // =============================
    // 6. Kalau FAILED → notifikasi gagal
    // =============================
    if (previousStatus !== "success" && newStatus === "failed") {
      const { error: notifErr } = await supabase
        .from("user_notifications")
        .insert({
          user_id: updatedTopup.user_id,
          type: "topup_failed",
          title: "⚠️ Top Up Gagal",
          body:
            "Transaksi top up kamu belum berhasil diproses.\n\n" +
            "Jika saldo kamu terpotong, silakan hubungi tim support CryptoKu.",
          related_topup_id: updatedTopup.id,
          metadata: {
            order_id: orderId,
            midtrans_status: transactionStatus,
            midtrans_fraud_status: fraudStatus,
          },
        });

      if (notifErr) {
        console.error("Insert notification (failed) error:", notifErr);
      }
    }

    return res.status(200).json({ message: "OK" });
  } catch (err) {
    console.error("Callback error:", err);
    // Tetap 200 supaya Midtrans tidak retry terus-terusan
    return res.status(200).json({ message: "Callback error logged" });
  }
});

export default router;
