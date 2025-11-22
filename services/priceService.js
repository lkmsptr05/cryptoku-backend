import supabase from "../utils/supabase.js";

/**
 * Mengambil semua harga crypto dari tabel crypto_prices, termasuk price_usd dan price_idr yang sudah dihitung.
 */
export async function getAllPrices() {
  const { data, error } = await supabase
    .from("crypto_prices")
    .select(`
      symbol,
      price_usd,    
      price_idr,    
      timestamp,
      crypto_24h:crypto_24h (
        pricechangepercent,
        lastupdate
      )
    `); // Perubahan: Mengambil price_usd dan price_idr secara eksplisit

  if (error) return { error };

  // --- Bagian ini dihapus karena harga IDR sudah ada di data ---
  /*
  const { data: rate } = await supabase
    .from("exchange_rates")
    .select("rate")
    .eq("currency_pair", "usd_idr")
    .single();

  const usdToIdr = rate?.rate || 16000;
  */
  // ------------------------------------------------------------------

  // Format output
  const formatted = data.map(row => ({
    symbol: row.symbol,
    // Menggunakan price_usd dan price_idr langsung dari kolom
    price_usd: row.price_usd,
    price_idr: row.price_idr, 

    timestamp: row.timestamp,
    priceChangePercent: row.crypto_24h?.pricechangepercent ?? 0,
    changeLastUpdate: row.crypto_24h?.lastupdate ?? null
  }));

  return { data: formatted };
}


/**
 * Mengambil harga single crypto dari tabel crypto_prices, termasuk price_usd dan price_idr yang sudah dihitung.
 * @param {string} symbol - Simbol mata uang crypto (e.g., 'ethusdt')
 */
export async function getPrice(symbol) {
  const { data, error } = await supabase
    .from("crypto_prices")
    .select(`
      symbol,
      price_usd,    
      price_idr,    
      timestamp,
      crypto_24h:crypto_24h (
        pricechangepercent,
        lastupdate
      )
    `)
    .eq("symbol", symbol.toLowerCase()) // Pastikan symbol selalu lower case jika di DB Anda disimpan lower case
    .single();

  // 1. Tangani error query umum (misalnya, koneksi atau syntax)
  if (error && error.code) {
    // Log error Supabase spesifik jika diperlukan
    console.error(`Supabase Query Error for ${symbol}:`, error.message);
    return { error: { message: `Gagal mengambil harga: ${error.message}` } };
  }

  // 2. Tangani kasus data tidak ditemukan (No Rows Found)
  // Ketika .single() tidak menemukan baris, data akan null/kosong dan error.code biasanya adalah PGRST116
  if (!data) {
    return { 
      error: { 
        message: `Symbol harga '${symbol}' tidak ditemukan di database.`,
        status: 404 
      } 
    };
  }

  // Jika data ditemukan dan tidak ada error query, kembalikan data
  return {
    data: {
      symbol: data.symbol,
      price_usd: data.price_usd,
      price_idr: data.price_idr, 

      timestamp: data.timestamp,
      priceChangePercent: data.crypto_24h?.pricechangepercent ?? 0,
      changeLastUpdate: data.crypto_24h?.lastupdate ?? null
    }
  };
}