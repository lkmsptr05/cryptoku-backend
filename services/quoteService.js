// services/quoteService.js
import supabase from "../utils/supabase.js";
import { snap } from "../utils/midtrans.js";
import { GasEstimator } from "../utils/gasEstimator.js";
import { ethers } from "ethers";
import { getPricingData } from "../utils/priceUtils.js"; 

export async function createQuoteService({
  telegram_user_id,
  network_key,
  token_symbol,
  amount_idr,
  buyer_wallet
}) {
    console.log("[QuoteService] createQuoteService called with:", {
      telegram_user_id,
      network_key,
      token_symbol,
      amount_idr,
      buyer_wallet
    });
  // Basic validation
  if (!network_key || !token_symbol || !amount_idr || !buyer_wallet) {
    throw new Error("Missing required fields for quote creation");
  }

  // 1) Fetch network details
  const { data: network, error: netErr } = await supabase
    .from("supported_networks")
    .select("*")
    .eq("key", network_key)
    .single();

  if (netErr || !network) {
    console.error("Network lookup failed:", netErr);
    throw new Error("Network not supported");
  }

  // 2) Fetch token info 
  const { data: token, error: tokenErr } = await supabase
    .from("supported_tokens")
    .select("*, symbol") 
    .eq("network_key", network_key)
    .eq("symbol", token_symbol)
    .single();

  if (tokenErr || !token) {
    console.error("Token lookup failed:", tokenErr);
    throw new Error("Token not supported on this network");
  }
  
  // 3a) Fetch Harga Token dari crypto_prices
  const priceSymbol = token.fetch_symbol || `${token.symbol.toUpperCase()}USDT`;
  
  const { data: priceData, error: priceErr } = await supabase
    .from("crypto_prices")
    .select("price_usd, price_idr")
    .eq("symbol", priceSymbol.toLowerCase()) 
    .single();

  // 3b) Resolve token price
  let tokenPriceUSD = priceData?.price_usd ? Number(priceData.price_usd) : null;
  let tokenPriceIDR = priceData?.price_idr ? Number(priceData.price_idr) : null;
  
  const estimator = new GasEstimator(network.rpc_url);

  // 4) Derive IDR_RATE dan native price dari DB (menggunakan getPricingData)
  const nativePrices = await getPricingData(network_key); 
  
  if (!nativePrices || !nativePrices.USD || !nativePrices.IDR) {
    throw new Error("Failed to fetch pricing data (Native Price or IDR Rate)");
  }
  const nativePriceUSD = nativePrices.USD; // Harga Native Token (BNB, ETH) dalam USD
  const IDR_RATE = nativePrices.IDR; // Kurs IDR per 1 USD

  // 4a) Fallback Stablecoin: Jika token adalah USDT/USDC - asumsikan peg 1 USD
  const stableSymbols = ["USDT", "USDC"];
  if (stableSymbols.includes(token.symbol?.toUpperCase())) {
    tokenPriceUSD = tokenPriceUSD || 1.0;
    if (!tokenPriceIDR) {
      tokenPriceIDR = Math.round(tokenPriceUSD * IDR_RATE);
    }
  }

  // 4b) Fallback Native Token: Jika harga masih null dan ini Native Token (BNB, ETH, MATIC, dll.)
  if ((!tokenPriceUSD || !tokenPriceIDR) && (!token.contract_address || token.contract_address === "")) {
    console.log(`[QuoteService] Falling back to Native Price from DB for ${token.symbol}`);
    // Gunakan harga native yang sudah di-fetch dari DB (Langkah 4)
    tokenPriceUSD = nativePriceUSD; 
    tokenPriceIDR = Math.round(nativePriceUSD * IDR_RATE); 
  }

  // 5) Validasi Harga Akhir
  if (!tokenPriceUSD || !tokenPriceIDR) {
    console.error("Price lookup failed:", priceErr);
    throw new Error("Token price unavailable; please update crypto_prices for this token");
  }
  
  // 6) Estimate gas: use token.contract_address or fallback to network.default_test_token
  const tokenAddressForEstimate = token.contract_address || network.default_test_token || null;
  const decimals = token.decimals || 18;

  // We'll estimate gas by simulating a unit transfer (1 token unit), GasEstimator should return gas in native units
  const gas = await estimator.estimate({
    from: process.env.DUMMY_SENDER_ADDRESS,
    to: buyer_wallet,
    tokenAddress: tokenAddressForEstimate,
    amount: ethers.parseUnits("1", decimals)
  });

  if (!gas || gas.error) {
    console.error("Gas estimation error:", gas);
    throw new Error("Gas estimate failed");
  }

  let feeInNative = 0;
  try {
    if (typeof gas.totalFeeNative === "string") {
      const numStr = gas.totalFeeNative.split(" ")[0].replace(/,/g, "");
      feeInNative = parseFloat(numStr);
    } else if (typeof gas.totalFeeNative === "number") {
      feeInNative = gas.totalFeeNative;
    } else {
      feeInNative = Number(gas.totalFeeNative) || 0;
    }
  } catch (e) {
    console.warn("Cannot parse gas.totalFeeNative:", gas.totalFeeNative, e);
    feeInNative = 0;
  }

// ----------------------------------------------------
// 🎯 LOGIKA HARGA TETAP (Fixed Price Logic)
// ----------------------------------------------------

  // 7) Hitung Gross Amount dan Biaya dalam USD
  const grossUsdFromIdr = Number(amount_idr) / Number(IDR_RATE); 

  const gasFeeUsd = feeInNative * nativePriceUSD; // Biaya Gas dalam USD
  
  const markupRate = 0.025; // 2.5% Markup
  const markupFeeUsd = grossUsdFromIdr * markupRate;

  // Total Biaya (Gas + Markup) yang akan dikurangkan (dalam USD)
  const totalDeductionUsd = markupFeeUsd + gasFeeUsd; 

  // 8) Hitung Gross Token Amount
  const grossTokenAmount = Number(amount_idr) / Number(tokenPriceIDR);

  // 9) Konversi Biaya Total ke TOKEN AMOUNT yang akan dikurangkan
  const tokenDeductionAmount = totalDeductionUsd / tokenPriceUSD;

  // 10) Hitung Final Token Amount (Net amount yang diterima user)
  const amountCrypto = grossTokenAmount - tokenDeductionAmount;
  
  if (amountCrypto <= 0) {
    throw new Error("Requested IDR amount is too low to cover transaction fees and markup.");
  }

  // 11) Final Charge: Karena fixed price, Total Charge IDR dan Total Charge USD sama dengan input
  const totalChargeIdr = Number(amount_idr);
  const totalChargeUsd = grossUsdFromIdr; 

  // 12) Sanity/tolerance check: Pastikan total token dikalikan harga ditambah biaya kembali ke amount_idr
  // Cek: (Final Token * Token Price IDR) + (Total Deduction USD * IDR_RATE) = Total Charge IDR
  const recomputedIdrCheck = Math.round(amountCrypto * tokenPriceIDR + totalDeductionUsd * IDR_RATE);
  
  const tolerance = Math.max(1000, Math.round(totalChargeIdr * 0.02)); 
  if (Math.abs(recomputedIdrCheck - totalChargeIdr) > tolerance) {
    console.error("Tolerance check failed:", { recomputedIdrCheck, totalChargeIdr, tolerance });
    throw new Error("Price mismatch / tolerance exceeded");
  }

// ----------------------------------------------------
// 🎯 FINAL DB INSERT DAN MIDTRANS
// ----------------------------------------------------

  // 13) Lock quote into DB
  const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString(); // 2 minutes lock

  const insertPayload = {
    network: network_key,
    token_symbol: token.symbol,
    token_contract_address: token.contract_address || null,
    token_decimals: decimals,
    
    amount_requested_idr: Number(amount_idr),
    amount_requested_token: Number(amountCrypto), // FINAL NET AMOUNT
    price_token_idr_quoted: Number(tokenPriceIDR),
    price_token_usd_quoted: Number(tokenPriceUSD),
    price_native_usd_quoted: Number(nativePriceUSD),
    
    native_fee_amount: feeInNative, 
    gas_fee_usd_quoted: Number(gasFeeUsd),
    
    total_charge_usd: Number(totalChargeUsd), 
    total_charge_idr: Number(totalChargeIdr), // FIXED PRICE
    
    telegram_user_id,
    buyer_wallet_address: buyer_wallet,
    expires_at: expiresAt,
    // Kolom legacy/opsional
    amount_requested_usd: Number((totalChargeUsd).toFixed(8)), 
  };

  const { data: order, error: orderErr } = await supabase
    .from("queue_orders")
    .insert(insertPayload)
    .select("*")
    .single();

  if (orderErr || !order) {
    console.error("DB insert failed:", orderErr);
    throw new Error("Failed to create quote");
  }

  // 14) Create Midtrans payment
  const midtransPayload = {
    transaction_details: {
      order_id: order.id,
      gross_amount: totalChargeIdr // Menggunakan totalChargeIdr yang FIXED
    },
    customer_details: {
      first_name: "User",
      email: "user@example.com"
    }
  };

  const midtransRes = await snap.createTransaction(midtransPayload);
  if (!midtransRes) {
    console.error("Midtrans createTransaction returned falsy:", midtransRes);
    throw new Error("Failed to create midtrans transaction");
  }

  // 15) Update DB with midtrans token
  await supabase
    .from("queue_orders")
    .update({ midtrans_transaction_id: midtransRes.token })
    .eq("id", order.id);

  // 16) Return order + midtrans info 
  return {
    id: order.id,
    network: order.network,
    token_symbol: order.token_symbol,
    token_contract_address: order.token_contract_address,
    token_decimals: order.token_decimals,
    amount_requested_idr: order.amount_requested_idr,
    amount_requested_token: Number(order.amount_requested_token),
    price_token_idr_quoted: Number(order.price_token_idr_quoted),
    total_charge_idr: Number(order.total_charge_idr),
    expires_at: order.expires_at,
    midtrans_token: midtransRes.token,
    midtrans_redirect_url: midtransRes.redirect_url
  };
}