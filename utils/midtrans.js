import midtransClient from "midtrans-client";
import dotenv from "dotenv";

dotenv.config();
// console.log(process.env.MIDTRANS_SERVER_KEY);

export const snap = new midtransClient.Snap({
    isProduction: true,
    serverKey: process.env.MIDTRANS_SERVER_KEY,
});
