// routes/midtransRoutes.js
import express from "express";
import midtransWebhookHandler from "../handlers/midtransWebhook.js";

const router = express.Router();

// Midtrans notification URL (set this URL in Midtrans Dashboard => Notification URL)
router.post("/notification", midtransWebhookHandler);

export default router;
