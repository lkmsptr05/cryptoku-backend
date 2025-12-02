// src/routes/orders.js
import express from "express";
import supabase from "../utils/supabase.js";
// import { GasEstimator } from "../utils/gasEstimator.js"; // removed - use NetworkEstimatorMap instead
import { NetworkEstimatorMap } from "../services/Estimators.js";
import {
  getNetworkRpcByKey,
  getDefaultSenderAddress,
} from "../utils/networkHelper.js";
import { getPrice } from "../services/priceService.js";

const router = express.Router();

/* ==============================
   Helper: Gas fee (native + ERC20/jetton)
================================ */

// Ambil token dari supported_tokens berdasarkan network_key + price_symbol (token_symbol dari order)
async function getTokenForGas({ network_key, token_symbol }) {
  const priceSymbol = String(token_symbol || "").toLowerCase();

  const { data, error } = await supabase
    .from("supported_tokens")
    .select(
      "network_key, symbol, contract_address, decimals, is_active, price_symbol"
    )
    .eq("network_key", network_key)
    .eq("price_symbol", priceSymbol)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[estimateGasFeeIdr] getTokenForGas error:", error);
    throw new Error("Gagal mengambil data token untuk estimasi gas");
  }

  if (!data) {
    throw new Error(
      `Token tidak ditemukan untuk network=${network_key}, price_symbol=${priceSymbol}`
    );
  }

  return {
    network_key: data.network_key,
    symbol: data.symbol,
    contract_address: data.contract_address,
    decimals: data.decimals ?? 18,
    is_native: data.contract_address === null,
    price_symbol: data.price_symbol,
  };
}

// Create estimator instance by network key & rpcUrl
function createEstimatorForNetwork(network_key, rpcUrl, options = {}) {
  const EstimatorClass = NetworkEstimatorMap[network_key];
  if (!EstimatorClass) {
    throw new Error(`Unsupported network_key for estimator: ${network_key}`);
  }

  // Pass rpcUrl or options object (some estimators accept options)
  // We allow passing priceOverride via options if caller wants to override prices.
  // Basic call: new EstimatorClass(rpcUrl)
  try {
    // If EstimatorClass expects options object, providing rpcUrl is still supported by many classes.
    return new EstimatorClass(rpcUrl, options);
  } catch (e) {
    // Fallback: try passing options object with rpcUrl
    return new EstimatorClass({ rpcUrl, ...options });
  }
}

// Hasil: integer IDR (dibulatkan ke bawah)
async function estimateGasFeeIdr({ network_key, to_address, token_symbol }) {
  // 1. Ambil RPC URL dari helper
  const rpcUrl = await getNetworkRpcByKey(network_key);
  if (!rpcUrl) {
    throw new Error(`Unknown network_key: ${network_key}`);
  }

  // 2. Ambil token config (supaya tahu native vs ERC20 / jetton)
  const token = await getTokenForGas({ network_key, token_symbol });

  // 3. Resolve default sender (some estimators require 'from' for estimateGas)
  let from;
  try {
    from = getDefaultSenderAddress(network_key);
  } catch (e) {
    from = null;
  }

  // If no from, estimator may still work (some use provider default), but prefer non-null
  if (!from) {
    // optional: try to get from DB or use zero address for EVM as fallback
    // but keep null to let estimator handle it
    from = null;
  }

  // 4. Create network-specific estimator
  let estimator;
  try {
    estimator = createEstimatorForNetwork(network_key, rpcUrl);
  } catch (e) {
    console.error("[estimateGasFeeIdr] createEstimatorForNetwork error:", e);
    throw new Error("Estimator for network not available");
  }

  // 5. Prepare payload for estimator
  const payload = {
    from,
    to: to_address,
  };

  if (!token.is_native && token.contract_address) {
    payload.tokenAddress = token.contract_address;
    // Optionally pass amount (smallest unit) if you want more precise gas for token transfers
    // payload.amount = "1"; // smallest unit as fallback
  }

  // 6. Call estimator. Expect result object that contains totalFeeIDR or totalFeeUSD/totalFeeNative
  let result;
  try {
    result = await estimator.estimate(payload);
  } catch (e) {
    console.error(
      "[estimateGasFeeIdr] estimator.estimate failed:",
      e?.message || e
    );
    throw new Error("Gagal mengestimasi biaya jaringan");
  }

  // 7. Normalize result to integer IDR
  // Support different shapes:
  // - result.totalFeeIDR (preferred)
  // - result.totalFeeUSD + priceInfo.usdIdr
  // - result.totalFeeNative + priceInfo.nativeUsd + priceInfo.usdIdr
  let feeIdr = 0;

  try {
    if (
      result &&
      typeof result.totalFeeIDR !== "undefined" &&
      result.totalFeeIDR !== null
    ) {
      feeIdr = Number(result.totalFeeIDR) || 0;
    } else if (
      result &&
      typeof result.totalFeeUSD !== "undefined" &&
      result.totalFeeUSD !== null
    ) {
      const usd = Number(result.totalFeeUSD) || 0;
      const usdIdr = Number(result.priceInfo?.usdIdr) || 0;
      feeIdr = usd * usdIdr;
    } else if (result && typeof result.totalFeeNative === "string") {
      // totalFeeNative format like "0.005735735 TON" -> extract number
      const m = result.totalFeeNative.match(/([0-9.]+)/);
      const nativeAmt = m ? Number(m[1]) : 0;
      const nativeUsd = Number(result.priceInfo?.nativeUsd) || 0;
      const usdIdr = Number(result.priceInfo?.usdIdr) || 0;
      feeIdr = nativeAmt * nativeUsd * usdIdr;
    } else {
      // As last resort, try recommended in meta
      const recTon = Number(result?.meta?.recommended?.ton) || 0;
      const nativeUsd = Number(result.priceInfo?.nativeUsd) || 0;
      const usdIdr = Number(result.priceInfo?.usdIdr) || 0;
      feeIdr = recTon * nativeUsd * usdIdr;
    }
  } catch (e) {
    console.warn("[estimateGasFeeIdr] normalization failed:", e?.message || e);
    feeIdr = 0;
  }

  // ensure integer >= 0
  feeIdr = Math.max(0, Math.floor(Number(feeIdr) || 0));
  return feeIdr;
}

/* ==============================
   POST /orders/buy
================================ */

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

    // NOTE: address validation differs by network. For EVM we keep old 0x check,
    // for TON or other networks supported_tokens should indicate address format.
    if (
      network_key === "ethereum" ||
      network_key === "bsc" ||
      network_key === "polygon" ||
      network_key === "optimism" ||
      network_key === "arbitrum"
    ) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(to_address)) {
        return res.status(400).json({
          success: false,
          message: "Wallet address tidak valid.",
        });
      }
    } else {
      // for non-EVM networks, we skip strict 0x check (TON addresses different)
      if (!to_address || typeof to_address !== "string") {
        return res.status(400).json({
          success: false,
          message: "Wallet address tidak valid.",
        });
      }
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
        token_symbol,
      });

      console.log("[/buy] gasFeeIdrNum:", gasFeeIdrNum);

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
        id: row.id,
        symbol: row.token_pair || row.token_symbol,
        side: "BUY",
        amountUsd,
        amountToken: tokenAmount,
        priceUsd,
        createdAt: row.created_at,
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
