// utils/priceUtils.js
import supabase from "./supabase.js";

// Helper untuk mendapatkan simbol native currency berdasarkan network key
function getNativeSymbolForNetwork(networkKey) {
  const n = networkKey?.toLowerCase();
  if (n === "bsc") return "BNB";
  if (n === "polygon") return "MATIC"; // layer2 default to ETH
  if (["arbitrum", "optimism", "base"].includes(n)) return "ETH";
  if (n === "ethereum" || n === "eth") return "ETH";
  return "ETH";
}

/**
 * Mengambil kurs USD/IDR dan harga Native Token dari Supabase DB.
 * @param {string} networkKey - Kunci jaringan (misalnya 'bsc')
 * @returns {object} { USD: Harga Native Token dalam USD, IDR: Kurs IDR per 1 USD }
 */
export async function getPricingData(networkKey) {
  try {
    // 1. Ambil kurs USD/IDR dari exchange_rates
    const { data: idrRateData, error: idrErr } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("currency_pair", "usd_idr")
      .single();

    const IDR_RATE = idrRateData?.rate ? Number(idrRateData.rate) : 15500; // Fallback jika DB kosong
    if (idrErr)
      console.warn(
        "Warning: Failed to fetch IDR rate from DB, using fallback 15500."
      ); // 2. Ambil harga native token (BNB, ETH, MATIC) dari crypto_prices

    const nativeSymbol = getNativeSymbolForNetwork(networkKey); // Asumsi symbol di crypto_prices adalah ETHUSDT, BNBUSDT, dsb.
    const priceSymbol = `${nativeSymbol.toUpperCase()}USDT`.toLowerCase();
    const { data: nativePriceData, error: priceErr } = await supabase
      .from("crypto_prices")
      .select("price_usd")
      .eq("symbol", priceSymbol)
      .single();

    const NATIVE_PRICE_USD = nativePriceData?.price_usd
      ? Number(nativePriceData.price_usd)
      : 0;

    if (priceErr || NATIVE_PRICE_USD === 0) {
      console.error(
        `Failed to fetch native price for ${nativeSymbol}:`,
        priceErr
      );
      // Throw error jika harga native sangat penting untuk gas fee
      // Jika Anda ingin melanjutkan, ganti throw dengan console.warn dan NATIVE_PRICE_USD = 0
    }
    return {
      USD: NATIVE_PRICE_USD,
      IDR: IDR_RATE,
    };
  } catch (err) {
    console.error("Critical error in getPricingData:", err.message);
    return { USD: 0, IDR: 0 }; // Return 0 untuk mencegah crash jika terjadi kesalahan kritis
  }
}
