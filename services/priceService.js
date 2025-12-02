import supabase from "../utils/supabase.js";

/**
 * Mengambil semua harga crypto dari tabel crypto_prices, termasuk price_usd dan price_idr yang sudah dihitung.
 */
export async function getAllPrices() {
  const { data, error } = await supabase.from("crypto_prices").select(`
      symbol,
      price_usd,    
      price_idr,    
      timestamp,
      crypto_24h:crypto_24h (
        pricechangepercent,
        lastupdate
      ),
      status
    `);
  if (error) return { error };
  const formatted = data.map((row) => ({
    symbol: row.symbol,
    price_usd: row.price_usd,
    price_idr: row.price_idr,
    timestamp: row.timestamp,
    priceChangePercent: row.crypto_24h?.pricechangepercent ?? 0,
    changeLastUpdate: row.crypto_24h?.lastupdate ?? null,
    status: row.status,
  }));

  return { data: formatted };
}

/**
 * Mengambil harga single crypto dari tabel crypto_prices.
 * @param {string} symbol - Simbol mata uang crypto (e.g., 'ethusdt')
 */
export async function getPrice(symbol) {
  const { data, error } = await supabase
    .from("crypto_prices")
    .select(
      `
      symbol,
      price_usd,    
      price_idr,    
      timestamp,
      crypto_24h:crypto_24h (
        pricechangepercent,
        lastupdate
      ),
      status
    `
    )
    .eq("symbol", symbol.toLowerCase())
    .single();

  if (error && error.code) {
    console.error(`Supabase Query Error for ${symbol}:`, error.message);
    return { error: { message: `Gagal mengambil harga: ${error.message}` } };
  }

  if (!data) {
    return {
      error: {
        message: `Symbol harga '${symbol}' tidak ditemukan di database.`,
        status: 404,
      },
    };
  }

  return {
    data: {
      symbol: data.symbol,
      price_usd: data.price_usd,
      price_idr: data.price_idr,
      timestamp: data.timestamp,
      priceChangePercent: data.crypto_24h?.pricechangepercent ?? 0,
      changeLastUpdate: data.crypto_24h?.lastupdate ?? null,
      status: data.status,
    },
  };
}

/**
 * Mengambil data sparkline (1 jam terakhir, max 60 titik) dari tabel price_history_1m
 * @param {string} symbol - Simbol mata uang crypto (e.g., 'ethusdt')
 */
export async function getSparkline(symbol) {
  const normalized = symbol.toLowerCase();

  const { data, error } = await supabase
    .from("price_history_1m")
    .select("price_usd, timestamp")
    .eq("symbol", normalized)
    .order("timestamp", { ascending: true })
    .limit(60); // 1 jam, 1 data per menit

  if (error) {
    console.error(`Supabase Sparkline Error for ${symbol}:`, error.message);
    return {
      error: {
        message: `Gagal mengambil sparkline: ${error.message}`,
      },
    };
  }

  return {
    data: {
      symbol: normalized,
      points: (data || []).map((row) => Number(row.price_usd)),
      timestamps: (data || []).map((row) => row.timestamp),
    },
  };
}

/**
 * Mengambil kurs pertukaran dari tabel exchange_rates
 * @param {string} currencyPair - contoh: 'usd_idr' (default)
 */
export async function getExchangeRate(currencyPair = "usd_idr") {
  try {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select(`*`)
      .eq("currency_pair", currencyPair.toLowerCase())
      .limit(1)
      .single();

    if (error && error.code) {
      console.error(
        `Supabase Query Error for exchange_rate ${currencyPair}:`,
        error.message
      );
      return {
        error: { message: `Gagal mengambil exchange_rate: ${error.message}` },
      };
    }

    if (!data) {
      return {
        error: {
          message: `Exchange rate '${currencyPair}' tidak ditemukan di database.`,
          status: 404,
        },
      };
    }

    return {
      data: {
        currency_pair: data.currency_pair,
        rate: Number(data.rate),
        timestamp: data.timestamp,
      },
    };
  } catch (e) {
    console.error("Critical error in getExchangeRate:", e?.message || e);
    return { error: { message: `Internal error: ${e?.message || String(e)}` } };
  }
}

/**
 * Helper kecil untuk langsung ambil USD->IDR (return Number atau 0)
 */
export async function getUsdIdrRate() {
  const r = await getExchangeRate("usd_idr");
  if (r.error) {
    // fallback ke 0 agar tidak melempar exception — konsisten dengan style file
    return { data: { rate: 0 }, error: r.error };
  }
  return { data: { rate: r.data.rate, timestamp: r.data.timestamp } };
}
