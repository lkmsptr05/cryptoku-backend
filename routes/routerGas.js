// routes/estimateGas.js
import express from "express";
import { NetworkEstimatorMap } from "../services/Estimators.js"; // Import map estimator
import { getNetworkRpcByKey } from "../utils/networkHelper.js";
import { getDefaultSenderAddress } from "../utils/networkHelper.js";

const router = express.Router();

router.get("/estimate", async (req, res) => {
  try {
    let { network_key, to, tokenAddress, amount } = req.query;
    const from = getDefaultSenderAddress(network_key);

    if (!network_key || !to) {
      return res.status(400).json({ error: "network_key and to are required" });
    }

    // 1. Pilih Class Estimator berdasarkan network_key
    const EstimatorClass = NetworkEstimatorMap[network_key];
    if (!EstimatorClass) {
      return res
        .status(400)
        .json({ error: `Unsupported network_key: ${network_key}` });
    }
    console.log(`[DEBUG] Raw 'from' address generated: ${from}`);
    console.log(`[DEBUG] Raw 'to' address received: ${to}`);
    // 2. Ambil RPC dan Buat Instance Estimator
    const rpcUrl = await getNetworkRpcByKey(network_key);
    if (!rpcUrl) {
      return res
        .status(400)
        .json({ error: "RPC URL not found for network_key" });
    }

    const estimator = new EstimatorClass(rpcUrl); // Membuat instance subclass

    let amountToSend = null;

    if (tokenAddress) {
      // Asumsi: amount adalah string BigInt (unit terkecil) atau null
      if (amount && /^\d+$/.test(amount)) {
        amountToSend = amount;
      } else {
        // Jika tidak ada amount, BaseEstimator akan menggunakan 1 unit
        amountToSend = null;
      }
    }

    // 3. Estimasi Gas
    const result = await estimator.estimate({
      from,
      to,
      tokenAddress,
      amount: amountToSend,
    });

    return res.json(result);
  } catch (err) {
    console.error("estimate-gas error:", err);
    // Jika ada error, BaseEstimator seharusnya sudah menangani error RPC,
    // Jika error masih terjadi di sini (mis. constructor), kembalikan 500.
    return res.status(500).json({ error: err.message || "internal error" });
  }
});

export default router;
