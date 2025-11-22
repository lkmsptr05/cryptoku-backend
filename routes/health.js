import express from "express";
import { getHealthStatus } from "../services/healthService.js";
const router = express.Router();

router.get("/", async (req, res) => {
  const data = await getHealthStatus();
  res.json(data);
});

export default router;
