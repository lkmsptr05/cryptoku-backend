// services/midtransService.js
import axios from "axios";
import crypto from "crypto";
import supabase from "../utils/supabase.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_IS_SANDBOX = process.env.MIDTRANS_IS_SANDBOX !== "false";

const MIDTRANS_BASE = MIDTRANS_IS_SANDBOX
  ? "https://app.sandbox.midtrans.com"
  : "https://app.midtrans.com";

function authHeader() {
  const token = Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Create a Midtrans Snap transaction.
 * @param {Object} order - inserted order object from DB (must contain id, total_charge_idr, telegram_user_id, buyer_wallet_address ...)
 * @param {Array} items - optional item detail array for Midtrans
 */
export async function createTransaction(order, items = []) {
  const orderId = order.id;
  const grossAmount = Number(order.total_charge_idr);

  // Build basic payload for Snap
  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    item_details: items.length ? items : [
      {
        id: order.product_id ?? order.token_symbol,
        price: grossAmount,
        quantity: 1,
        name: `${order.token_symbol} - ${order.network}`,
      },
    ],
    customer_details: {
      first_name: String(order.telegram_user_id || "buyer"),
      email: order.email || "no-reply@example.com",
      phone: order.buyer_wallet_address || "",
    },
    // optional callbacks
    // credit_card: { secure: true }, // if needed
    // callbacks or expiry can be set if needed (but Midtrans normal flow ok)
  };

  try {
    const url = `${MIDTRANS_BASE}/snap/v1/transactions`;
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    // res.data contains: token, redirect_url
    const { token, redirect_url } = res.data;

    // Update order with midtrans_transaction_id (we'll store token or redirect_url)
    const { error: updErr } = await supabase
      .from("queue_orders")
      .update({
        midtrans_transaction_id: token, // store token; you could store redirect_url
      })
      .eq("id", orderId);

    if (updErr) {
      console.warn("Failed to update order with midtrans id:", updErr);
    }

    return { token, redirect_url, raw: res.data };
  } catch (err) {
    console.error("Midtrans createTransaction error:", err.response?.data || err.message);
    throw new Error("Midtrans create transaction failed");
  }
}

/**
 * Verify Midtrans notification signature
 * signature_key = sha512(order_id + status_code + gross_amount + serverKey)
 */
export function verifySignature({ order_id, status_code, gross_amount, signature_key }) {
  const plain = order_id + status_code + gross_amount;
  const hash = crypto.createHash("sha512").update(plain + MIDTRANS_SERVER_KEY).digest("hex");
  return hash === signature_key;
}

/**
 * Handle notification payload from Midtrans
 * Will update queue_orders status accordingly.
 */
export async function handleNotification(payload) {
  // payload fields from Midtrans: order_id, transaction_status, fraud_status, status_code, gross_amount, signature_key ...
  const {
    order_id,
    transaction_status,
    fraud_status,
    status_code,
    gross_amount,
    signature_key,
  } = payload;

  if (!verifySignature({ order_id, status_code, gross_amount, signature_key })) {
    throw new Error("Invalid Midtrans signature");
  }

  // Map Midtrans transaction_status -> our queue_orders status
  // Midtrans statuses: capture, settlement, pending, deny, expire, cancel
  let newStatus = "PENDING";
  if (transaction_status === "capture" || transaction_status === "settlement") {
    // if fraud_status == 'deny' => FAILED, else PAID
    newStatus = fraud_status === "challenge" || fraud_status === "deny" ? "FAILED" : "PAID";
  } else if (transaction_status === "pending") {
    newStatus = "PENDING";
  } else if (transaction_status === "deny" || transaction_status === "cancel") {
    newStatus = "FAILED";
  } else if (transaction_status === "expire") {
    newStatus = "EXPIRED";
  }

  // Update queue_orders row
  const { data, error } = await supabase
    .from("queue_orders")
    .update({
      status: newStatus,
      midtrans_transaction_id: payload.transaction_id ?? payload.transaction_time ?? payload.transaction_id,
      // you may also store payload as json in a column if desired
    })
    .eq("id", order_id)
    .select()
    .single();

  if (error) {
    console.error("Failed to update order status from Midtrans webhook:", error);
    throw error;
  }

  return { order: data, newStatus };
}
