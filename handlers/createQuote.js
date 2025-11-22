// handlers/createQuote.js
import { createQuoteService } from "../services/quoteService.js";

export default async function createQuoteHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      telegram_user_id,
      network_key,       // prefer this key name
      token_symbol,
      amount_idr,
      buyer_wallet
    } = req.body;
    console.log("[createQuoteHandler] Request body:", req.body);
    // Basic validation
    console.log(telegram_user_id, network_key, token_symbol, amount_idr, buyer_wallet);
    if (!network_key || !token_symbol || !amount_idr || !buyer_wallet) {
      return res.status(400).json({ error: "Missing required fields: network_key, token_symbol, amount_idr, buyer_wallet" });
    }

    const order = await createQuoteService({
      telegram_user_id,
      network_key,
      token_symbol,
      amount_idr,
      buyer_wallet: buyer_wallet
    });

    return res.status(200).json({
      success: true,
      order_id: order.id,
      network: order.network,
      token_symbol: order.token_symbol,
      token_amount: order.amount_requested_token,
      total_idr: order.total_charge_idr,
      expires_at: order.expires_at,
      midtrans: {
        token: order.midtrans_token,
        redirect_url: order.midtrans_redirect_url
      }
    });
  } catch (err) {
    console.error("createQuoteHandler error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
