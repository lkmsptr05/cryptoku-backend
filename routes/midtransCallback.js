// handlers/midtransCallback.js
import supabase from "../utils/supabase.js";
import crypto from "crypto";

export default async function midtransCallbackHandler(req, res) {
    const signature = req.headers['x-signature-key'];
    const body = req.body;

    const expectedSignature = crypto
        .createHash("sha512")
        .update(
            body.order_id +
            body.status_code +
            body.gross_amount +
            process.env.MIDTRANS_SERVER_KEY
        )
        .digest("hex");

    if (expectedSignature !== signature) {
        return res.status(401).json({ error: "Invalid signature" });
    }

    // Update DB
    let newStatus = "PENDING";
    if (body.transaction_status === "settlement") newStatus = "PAID";
    else if (body.transaction_status === "expire") newStatus = "EXPIRED";
    else if (body.transaction_status === "cancel") newStatus = "FAILED";
    else if (body.transaction_status === "deny") newStatus = "FAILED";

    await supabase
        .from("queue_orders")
        .update({ status: newStatus })
        .eq("id", body.order_id);

    return res.status(200).json({ success: true });
}
