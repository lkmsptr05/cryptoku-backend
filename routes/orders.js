import express from "express";
import { getOrderById } from "../services/ordersService.js";
const router = express.Router();

router.get("/:id", async (req, res) => {
  const order = await getOrderById(req.params.id);
  res.json(order);
});

export default router;
