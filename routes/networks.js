import express from "express";
import { getNetworks } from "../services/networkService.js";

const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await getNetworks());
});

export default router;
