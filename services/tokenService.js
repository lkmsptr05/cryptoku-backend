// src/services/tokenService.js
import supabase from "../utils/supabase.js";

/**
 * Mengambil daftar token yang didukung berdasarkan network_key.
 * @param {string} networkKey - Kunci jaringan (misalnya 'bsc', 'eth')
 * @returns {Promise<Array>} Daftar token
 */
export async function getTokensByNetwork(networkKey) {
  if (!networkKey) {
    throw new Error('Network key diperlukan.');
  }

  // Menormalkan networkKey ke lowercase, asumsi di DB disimpan sebagai lowercase
  const normalizedNetworkKey = networkKey.toLowerCase(); 

  try {
    // 🎯 Query Supabase untuk mendapatkan semua token di network tertentu
    const { data, error } = await supabase
      .from('supported_tokens')
      .select('symbol, network_key, price_idr, price_usd') // Pilih kolom yang relevan
      .eq('network_key', normalizedNetworkKey); // Filter berdasarkan network

    if (error) {
      console.error('Supabase error fetching tokens by network:', error);
      throw new Error('Gagal mengambil data token dari database.');
    }

    return data;
    
  } catch (err) {
    console.error("Error in getTokensByNetwork service:", err.message);
    throw err;
  }
}

export async function getSupportedTokens() {
  try {
    const {data, error} = await supabase
    .from("supported_tokens")
    .select("*")
    if (error) {
      console.error("Supabase error fetching tokens", error)
      throw new Error("Gagal mengambil data token")
    }
    return data;
  } catch (err) {
    console.error("Error in getSupportedTokens service", err.message)
    throw err
  }
  
}
// Catatan: Fungsi getNetworks sebelumnya dihapus atau disimpan di file lain.