    // handlers/createPayment.js
import midtransClient from "midtrans-client";
import supabase from "../utils/supabase.js";

export default async function createPaymentHandler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { order_id } = req.body;

    if (!order_id) {
        return res.status(400).json({ error: "order_id is required" });
    }

    // Ambil order dari DB
    const { data: order, error } = await supabase
        .from("queue_orders")
        .select("*")
        .eq("id", order_id)
        .single();

    if (error || !order) {
        return res.status(404).json({ error: "Order not found" });
    }

    if (order.status !== "PENDING") {
        return res.status(400).json({ error: "Order is not pending" });
    }

    // Buat Snap Midtrans
    const snap = new midtransClient.Snap({
        isProduction: process.env.MIDTRANS_PROD === "true",
        serverKey: process.env.MIDTRANS_SERVER_KEY
    });

    const parameter = {
        transaction_details: {
            order_id: order.id,
            gross_amount: order.total_charge_idr
        },
        customer_details: {
            first_name: "Telegram User",
            email: "auto@system.com"
        }
    };

    const snapResponse = await snap.createTransaction(parameter);

    // Save midtrans transaction ID
    await supabase
        .from("queue_orders")
        .update({ midtrans_transaction_id: snapResponse.transaction_id })
        .eq("id", order.id);

    return res.status(200).json({
        success: true,
        snap_token: snapResponse.token,
        snap_redirect_url: snapResponse.redirect_url
    });
}
