// src/routes/orders.js
import express from "express";
import supabase from "../utils/supabase.js";
import { GasEstimator } from "../utils/gasEstimator.js";
import { getNetworkRpcByKey } from "../utils/networkHelper.js";

const router = express.Router();

// ==============================
// Helper: estimateGasFeeIdr (BNB native only)
// ==============================
async function estimateGasFeeIdr({ network_key, to_address }) {
  // 1. Ambil RPC URL dari DB / helper (sama kayak di /estimate-gas)
  const rpcUrl = await getNetworkRpcByKey(network_key);
  if (!rpcUrl) {
    throw new Error(`Unknown network_key: ${network_key}`);
  }

  // 2. Buat estimator pakai rpcUrl (STRING)
  const estimator = new GasEstimator(rpcUrl);

  // 3. Estimasi gas untuk native transfer
  //    Di flow kamu: kalau tokenAddress & amount nggak diisi = native
  const result = await estimator.estimate({
    to: to_address,
    // from, tokenAddress, amount → boleh kosong untuk native
  });

  if (!result || result.totalFeeIDR == null) {
    throw new Error("GasEstimator tidak mengembalikan totalFeeIDR");
  }

  // 4. Pastikan output berupa integer IDR
  return Math.floor(Number(result.totalFeeIDR) || 0);
}

// src/routes/orders.js (potongan POST /orders/buy)

router.post("/buy", async (req, res) => {
  try {
    const userId = req.user && req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi",
      });
    }

    const { token_symbol, token_pair, network_key, to_address, amount_idr } =
      req.body || {};

    // --- basic validation ---
    if (
      !token_symbol ||
      !token_pair ||
      !network_key ||
      !to_address ||
      amount_idr == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Data order tidak lengkap.",
      });
    }

    const amountIdrNum = Number(amount_idr);

    if (!Number.isFinite(amountIdrNum) || amountIdrNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Nominal IDR harus lebih besar dari 0.",
      });
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(to_address)) {
      return res.status(400).json({
        success: false,
        message: "Wallet address tidak valid.",
      });
    }

    // --- ambil harga token (snapshot) ---
    const { data: priceRow, error: priceError } = await supabase
      .from("crypto_prices")
      .select("price_usd, price_idr")
      .eq("symbol", token_symbol)
      .single();

    if (priceError || !priceRow) {
      console.error("[/buy] crypto_prices error:", priceError);
      return res.status(400).json({
        success: false,
        message: "Harga token tidak ditemukan.",
      });
    }

    const priceUsd = Number(priceRow.price_usd);
    const priceIdr = Number(priceRow.price_idr);

    if (
      !Number.isFinite(priceUsd) ||
      !Number.isFinite(priceIdr) ||
      !priceUsd ||
      !priceIdr
    ) {
      return res.status(400).json({
        success: false,
        message: "Data harga token tidak valid.",
      });
    }

    // --- hitung fee & gas di BACKEND ---

    // 4% service fee dari total amount
    const serviceFeeIdr = Math.floor(amountIdrNum * 0.04);

    // gas fee dari fungsi backend (IDR)
    let gasFeeIdrNum;
    try {
      gasFeeIdrNum = await estimateGasFeeIdr({
        network_key,
        to_address,
      });

      console.log(gasFeeIdrNum);

      gasFeeIdrNum = Math.max(0, Math.floor(Number(gasFeeIdrNum) || 0));
    } catch (e) {
      console.error("[/buy] estimateGasFeeIdr error:", e);
      return res.status(400).json({
        success: false,
        message: "Gagal menghitung biaya gas. Coba lagi sebentar.",
      });
    }

    // IDR bersih yang dipakai untuk beli token (setelah potong fee & gas)
    const netBuyIdr = amountIdrNum - serviceFeeIdr - gasFeeIdrNum;

    if (netBuyIdr <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Nominal terlalu kecil setelah dipotong biaya layanan dan biaya jaringan. Tambah nominal pembelian.",
      });
    }

    // --- konversi IDR → token & USD ---
    const tokenAmountReal = netBuyIdr / priceIdr;
    const amountUsdReal = tokenAmountReal * priceUsd;

    // --- panggil fungsi DB untuk lock saldo dan buat order ---
    const { data: orderId, error } = await supabase.rpc(
      "buy_token_with_saldo",
      {
        p_user_id: userId,
        p_token_symbol: token_symbol,
        p_token_pair: token_pair,
        p_network_key: network_key,
        p_to_address: to_address,

        // TOTAL uang yang user keluarin (ini yang di-lock dari saldo)
        p_amount_idr: amountIdrNum,

        // token yang akan dikirim worker (sudah NET setelah fee + gas)
        p_token_amount: tokenAmountReal,
        p_amount_usd: amountUsdReal,

        // fee resmi versi backend (bukan dari frontend)
        p_service_fee_idr: serviceFeeIdr,
        p_gas_fee_idr: gasFeeIdrNum,
      }
    );

    if (error) {
      console.error("[buy_token_with_saldo] error:", error);

      if (error.message && error.message.includes("INSUFFICIENT_BALANCE")) {
        return res.status(400).json({
          success: false,
          message: "Saldo kamu tidak mencukupi.",
          code: "INSUFFICIENT_BALANCE",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Gagal membuat order. Coba lagi beberapa saat.",
        code: "ORDER_FAILED",
      });
    }

    const { data: rows, error: orderFetchError } = await supabase
      .from("user_orders")
      .select("*")
      .eq("id", orderId)
      .limit(1);

    const orderRow =
      !orderFetchError && rows && rows.length > 0 ? rows[0] : null;

    // --- notifikasi ke user ---
    await supabase.from("user_notifications").insert({
      user_id: userId,
      type: "buy_pending",
      title: "Pembelian sedang diproses ⏳",
      body:
        "Pesanan pembelian " +
        token_symbol +
        " sebesar Rp" +
        amountIdrNum.toLocaleString("id-ID") +
        " sedang diproses. Saldo kamu telah dikunci sementara hingga transaksi selesai.",
      metadata: {
        token_symbol,
        token_pair,
        network_key,
        to_address,

        amount_idr: amountIdrNum,
        net_buy_idr: netBuyIdr,
        service_fee_idr: serviceFeeIdr,
        gas_fee_idr: gasFeeIdrNum,

        token_amount: tokenAmountReal,
        amount_usd: amountUsdReal,
        price_usd: priceUsd,
        price_idr: priceIdr,

        // view dari client (kalau mau dipakai debugging)
        client_view: {
          amount_usd: Number(req.body.amount_usd || 0),
          token_amount: Number(req.body.token_amount || 0),
          service_fee_idr: Number(req.body.service_fee_idr || 0),
          gas_fee_idr: Number(req.body.gas_fee_idr || 0),
        },
        order_id: orderId,
      },
    });

    return res.json({
      success: true,
      message: "Order berhasil dibuat dan saldo dikunci.",
      data: orderRow || { id: orderId },
    });
  } catch (err) {
    console.error("[POST /orders/buy] unexpected error:", err);

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server.",
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                          GET /api/orders/history                           */
/* -------------------------------------------------------------------------- */

router.get("/history", async (req, res) => {
  try {
    const userId = req.user && req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi",
      });
    }

    const limit =
      req.query.limit != null ? Math.min(Number(req.query.limit), 100) : 20;
    const offset = req.query.offset != null ? Number(req.query.offset) : 0;

    const { data: rows, error } = await supabase
      .from("user_orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[GET /orders/history] error:", error);
      return res.status(500).json({
        success: false,
        message: "Gagal mengambil riwayat order.",
      });
    }

    const mapStatusLabel = (status) => {
      if (!status) return "Unknown";
      const s = String(status).toLowerCase();
      if (s === "success") return "Completed";
      if (s === "pending") return "Pending";
      if (s === "processing") return "Processing";
      if (s === "failed") return "Failed";
      return status;
    };

    const items = (rows || []).map((row) => {
      const amountUsd = Number(row.amount_usd ?? 0);
      const tokenAmount = Number(row.token_amount ?? 0);
      const priceUsd = tokenAmount > 0 ? amountUsd / tokenAmount : null;

      return {
        // shape mirip DUMMY_HISTORY di Order.jsx
        id: row.id, // boleh number, React gak masalah
        symbol: row.token_pair || row.token_symbol, // misal "BTCUSDT"
        side: "BUY",
        amountUsd,
        amountToken: tokenAmount,
        priceUsd,
        createdAt: row.created_at, // frontend bisa format lagi
        status: mapStatusLabel(row.status),

        // extra fields buat kebutuhan UI ke depan
        network: row.network_key,
        toAddress: row.to_address,
        amountIdr: row.amount_idr,
        serviceFeeIdr: row.service_fee_idr,
        gasFeeIdr: row.gas_fee_idr,
        txHash: row.tx_hash,
        raw: row,
      };
    });

    return res.json({
      success: true,
      data: items,
      pagination: {
        limit,
        offset,
        count: items.length,
      },
    });
  } catch (err) {
    console.error("[GET /orders/history] unexpected error:", err);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server.",
    });
  }
});

export default router;
