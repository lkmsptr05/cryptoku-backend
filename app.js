import express from "express";
import cors from "cors";

import healthRoutes from "./routes/health.js";
import priceRoutes from "./routes/prices.js";
import networkRoutes from "./routes/networks.js";
import estimateGas from "./routes/estimateGas.js";
import tokens from "./routes/tokens.js";
import authTelegramRouter from "./routes/authTelegram.js";
import meRouter from "./routes/me.js";
import telegramAuth from "./middlewares/telegramAuth.js";
import topupRouter from "./routes/topup.js";
import topupCallbackRouter from "./routes/topupCallback.js";
import notificationsRouter from "./routes/notifications.js";
import newsRouter from "./routes/news.js";
import ordersRouter from "./routes/orders.js";
import topupSnapRouter from "./routes/topupSnap.js";
import midtransSnapCallback from "./routes/midtransSnapCallback.js";

const app = express();
const corsOptions = {
  origin: "https://carla-scarflike-terrilyn.ngrok-free.dev",
};
app.use(cors(corsOptions));
app.use(express.json());

// Debug log
app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.path);
  next();
});

// Topup: butuh Telegram auth
app.use("/api/topup", telegramAuth, topupRouter);
app.use("/api/topup/snap", topupSnapRouter);

// Callback Midtrans: TIDAK pakai auth
app.use("/api/topup", topupCallbackRouter);
app.use("/api/midtrans/snap", midtransSnapCallback);

app.use("/api/health", healthRoutes);
app.use("/api/prices", priceRoutes);
app.use("/api/networks", networkRoutes);
app.use("/api/estimate-gas", estimateGas);
app.use("/api/tokens", tokens);
app.use("/api/auth", authTelegramRouter);
app.use("/api/news", newsRouter);

// 🔒 PROTECTED BY TELEGRAM INIT DATA
app.use("/api/me", telegramAuth, meRouter);
app.use("/api/notifications", telegramAuth, notificationsRouter);
app.use("/api/orders", telegramAuth, ordersRouter);

// Root test
app.get("/", (req, res) => {
  res.status(200).json({ msg: "API SIAP!!!" });
});

// GLOBAL ERROR HANDLER – taruh PALING BAWAH
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR HANDLER:", err);
  res.status(500).json({ error: { message: "Internal server error." } });
});

export default app;
