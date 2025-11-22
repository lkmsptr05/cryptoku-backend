// routes/quoteRoutes.js
import express from "express";
import createQuoteHandler from "../handlers/createQuote.js";

const router = express.Router();

router.post("/create", createQuoteHandler);

export default router;
