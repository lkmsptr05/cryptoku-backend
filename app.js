import express from "express";
import cors from "cors";

import healthRoutes from "./routes/health.js";
import orderRoutes from "./routes/orders.js";
import priceRoutes from "./routes/prices.js";
import networkRoutes from "./routes/networks.js";
import midtransRoutes from "./routes/midtransRoutes.js";
import quoteRoutes from "./routes/quote.js";
import estimateGas from "./routes/estimateGas.js";
import tokens from "./routes/tokens.js";

const app = express();

app.use(cors());
app.use(express.json());

// ROUTES (tetap sama)
app.use("/api/health", healthRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/prices", priceRoutes);
app.use("/api/networks", networkRoutes);
app.use("/api/midtrans", midtransRoutes);
app.use("/api/quote", quoteRoutes);
app.use("/api/estimate-gas", estimateGas);
app.use("/api/tokens", tokens);


// test root
app.get("/", (req, res) => {
  res.status(200).json({ msg: "API SIAP!!!" });
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true, path: "/api/test" });
});


export default app;
