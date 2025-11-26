// utils/midtransCore.js
import midtransClient from "midtrans-client";

const coreApi = new midtransClient.CoreApi({
  isProduction: "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

export async function chargeQris({ orderId, grossAmount, customerName }) {
  try {
    const response = await coreApi.charge({
      payment_type: "qris",
      transaction_details: {
        order_id: orderId,
        gross_amount: Number(grossAmount),
      },
      qris: {
        acquirer: "gopay",
      },
      customer_details: {
        first_name: customerName || "CryptoKu User",
      },
    });

    return response;
  } catch (error) {
    console.error(
      "[MIDTRANS QRIS ERROR]",
      error?.ApiResponse || error?.message || error
    );
    throw error;
  }
}
