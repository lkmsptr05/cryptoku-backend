import express from "express";
import { getAllPrices, getPrice } from "../services/priceService.js";
const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await getAllPrices());
});

router.get("/:symbol", async (req, res) => {
  res.json(await getPrice(req.params.symbol));
});

export default router;
