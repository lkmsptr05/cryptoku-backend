import express from "express";
import supabase from "../utils/supabase.js";
import midtransClient from "midtrans-client";

const router = express.Router();

// const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";

const coreApi = new midtransClient.CoreApi({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

/**
 * Ambil snap_token & redirect_url dari kolom jsonb raw_midtrans_response
 */
function extractSnapInfo(row) {
  if (!row.raw_midtrans_response) {
    return { token: null, redirect_url: null };
  }

  return {
    token: row.raw_midtrans_response.token || null,
    redirect_url: row.raw_midtrans_response.redirect_url || null,
  };
}

/**
 * Sync satu topup (kalau masih pending)
 */
async function syncTopupStatusFromMidtrans(row) {
  if (row.status !== "pending") return row;

  try {
    const statusResp = await coreApi.transaction.status(row.order_id);

    const { transaction_status, fraud_status, payment_type, transaction_id } =
      statusResp;

    let newStatus;

    if (
      transaction_status === "settlement" ||
      (transaction_status === "capture" && fraud_status === "accept")
    ) {
      newStatus = "success";
    } else if (transaction_status === "pending") {
      newStatus = "pending";
    } else {
      // expire, cancel, deny, dll
      newStatus = "failed";
    }

    // Tidak ada perubahan
    if (
      newStatus === row.status &&
      (payment_type || row.payment_type) === row.payment_type &&
      (transaction_id || row.midtrans_transaction_id) ===
        row.midtrans_transaction_id
    ) {
      return row;
    }

    const { data, error } = await supabase
      .from("users_topup")
      .update({
        status: newStatus,
        payment_type: payment_type || row.payment_type || "qris",
        midtrans_transaction_id: transaction_id || row.midtrans_transaction_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (err) {
    const message = err?.message || "";

    // ✅ kalau Midtrans bilang "Transaction doesn't exist"
    if (message.toLowerCase().includes("transaction doesn't exist")) {
      console.warn(
        `[TOPUP] Order ${row.order_id} tidak ada di Midtrans, hapus dari DB`
      );

      await supabase.from("users_topup").delete().eq("id", row.id);

      return null;
    }

    console.error(
      `[TOPUP] gagal sync status Midtrans untuk order_id=${row.order_id}`,
      err
    );

    // error lain: jangan hapus, tetap biarkan pending
    return row;
  }
}

/**
 * GET /api/topup/history
 * Optional query:
 * - ?limit=50
 * - ?status=pending | success | failed | all
 */
router.get("/history", async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const statusFilter = req.query.status;

    // 1. Ambil semua pending & sync ke Midtrans dulu
    const { data: pendingRows, error: pendingError } = await supabase
      .from("users_topup")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending");

    if (pendingError) throw pendingError;

    if (pendingRows?.length) {
      const results = await Promise.all(
        pendingRows.map((row) => syncTopupStatusFromMidtrans(row))
      );

      // filter yang sudah dihapus (null)
      const stillExists = results.filter(Boolean);

      console.log(
        `[TOPUP] sync selesai. Total pending: ${pendingRows.length}, valid: ${stillExists.length}`
      );
    }

    // 2. Ambil data history terbaru (setelah sync)
    let query = supabase
      .from("users_topup")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data: history, error: historyError } = await query;

    if (historyError) throw historyError;

    // 3. Sanitasi & tambah snap_token (kalau masih pending)
    const items = (history || []).map((row) => {
      const { token, redirect_url } = extractSnapInfo(row);

      return {
        id: row.id,
        order_id: row.order_id,
        amount: row.amount,
        payment_type: row.payment_type,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,

        // Hanya kirim kalau masih pending
        snap_token: row.status === "pending" ? token : null,
        snap_redirect_url: row.status === "pending" ? redirect_url : null,
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error("[/api/topup/history] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
