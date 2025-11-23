import express from "express";
import {
  getAllPrices,
  getPrice,
  getSparkline,
} from "../services/priceService.js";

const router = express.Router();

/**
 * GET /prices
 * Ambil semua harga + 24h change (list market)
 */
router.get("/", async (req, res) => {
  const result = await getAllPrices();
  res.json(result);
});

/**
 * GET /prices/:symbol/sparkline
 * Ambil data sparkline 1 jam (untuk mini chart)
 * contoh: /prices/ethusdt/sparkline
 */
router.get("/:symbol/sparkline", async (req, res) => {
  const result = await getSparkline(req.params.symbol);
  res.json(result);
});

/**
 * GET /prices/:symbol
 * Ambil satu harga token
 * contoh: /prices/ethusdt
 */
router.get("/:symbol", async (req, res) => {
  const result = await getPrice(req.params.symbol);
  res.json(result);
});

export default router;
