// handlers/midtransWebhook.js
import { handleNotification } from "../services/midtransService.js";

export default async function midtransWebhookHandler(req, res) {
  // Midtrans sends POST with JSON body
  try {
    const payload = req.body;

    // handleNotification will verify signature and update DB
    const result = await handleNotification(payload);

    // midtrans expects HTTP 200 and body { "status": "OK" } or empty 200
    return res.status(200).json({ status: "OK", result });
  } catch (err) {
    console.error("Midtrans webhook error:", err);
    // return 400 if invalid signature or bad payload
    return res.status(400).json({ status: "ERROR", message: err.message });
  }
}
