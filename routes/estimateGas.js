// routes/estimateGas.js
import express from "express";
import { ethers } from "ethers"; // <-- TAMBAHKAN IMPORT INI
import { GasEstimator } from "../utils/gasEstimator.js";
import {
  getNetworkRpcByKey,
  getTokenDecimals,
} from "../utils/networkHelper.js"; // <-- ASUMSIKAN getTokenDecimals DITAMBAH

const router = express.Router();

/**
 * POST /api/estimate-gas
 * body: {
 * network_key: "bsc",
 * from: "0x....",
 * to: "0x....",
 * tokenAddress: "0x...",
 * amount: "1.0" //
 * }
 */
router.get("/", async (req, res) => {
  try {
    let { network_key, to, tokenAddress, amount } = req.query;
    const from = "0x8aa24a4BDE4714ac76c24143Add731fe3aeD0a0b";
    // 1. Validasi Dasar
    if (!network_key || !to) {
      return res.status(400).json({ error: "network_key and to are required" });
    }

    const rpcUrl = await getNetworkRpcByKey(network_key);
    if (!rpcUrl) {
      return res.status(400).json({ error: "Unknown network_key" });
    }

    let amountInUnits = null;

    // 2. LOGIKA KONVERSI OTOMATIS (AUTO CV)
    if (tokenAddress && amount) {
      // A. Ambil Desimal Token
      // Anda harus mengimplementasikan fungsi ini untuk mengambil desimal (misalnya 6 untuk USDT, 18 untuk BNB/ETH)
      const decimals = await getTokenDecimals(tokenAddress, rpcUrl);

      if (decimals === null) {
        return res.status(400).json({
          error: `Could not determine decimals for token ${tokenAddress}`,
        });
      }

      try {
        // B. Konversi dari Desimal String ("1.5") menjadi BigInt Wei/Unit (e.g., 1500000000000000000)
        amountInUnits = ethers.parseUnits(amount.toString(), decimals);
      } catch (parseError) {
        console.error("Ethers parse error:", parseError);
        return res
          .status(400)
          .json({ error: "Invalid amount format or value" });
      }
    }
    // Jika tidak ada tokenAddress, ini dianggap native transfer, amount diabaikan dalam estimasi.

    // 3. Estimasi Gas
    const estimator = new GasEstimator(rpcUrl);
    // Kirim amountInUnits (BigInt) ke estimator
    console.log("Estimating gas with params:", {
      from,
      to,
      tokenAddress,
      amount: amountInUnits,
    });
    return;
    const result = await estimator.estimate({
      from,
      to,
      tokenAddress,
      amount: amountInUnits, // Menggunakan nilai yang sudah dikonversi
    });

    return res.json(result);
  } catch (err) {
    console.error("estimate-gas error:", err);
    return res.status(500).json({ error: err.message || "internal error" });
  }
});

export default router;
