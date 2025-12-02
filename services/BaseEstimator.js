// services/BaseEstimator.js
import { ethers } from "ethers";
import supabase from "../utils/supabase.js";

// Mapping Symbol Harga
const CHAIN_PRICE_MAP = {
  1: "ethusdt", // Ethereum
  56: "bnbusdt", // BSC
  137: "polusdt", // Polygon
  42161: "ethusdt", // Arbitrum
  10: "ethusdt", // Optimism
  // Tambahkan mapping untuk jaringan lain di sini
};

export class BaseEstimator {
  // Properti ini HARUS di-override di subclass
  static CHAIN_ID = null;
  static PRICE_SYMBOL = null;
  static NATIVE_SYMBOL = "NATIVE";

  constructor(rpcUrl) {
    if (this.constructor.CHAIN_ID === null) {
      throw new Error("Subclass must define CHAIN_ID.");
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.erc20Abi = ["function transfer(address to, uint256 value)"];
    this._priceCache = { ts: 0, nativeUsd: null, usdIdr: null, ttl: 10_000 };
  }

  // --- Helper Database (Sama seperti sebelumnya) ---

  // services/BaseEstimator.js (atau GasEstimator.js)

  async _fetchUsdToIdrRate() {
    try {
      // Asumsi: Anda mencari di tabel 'exchange_rates'
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("rate") // Pastikan kolom ini ada
        .eq("currency_pair", "usd_idr") // Pastikan kunci ini benar
        .limit(1)
        .single();

      if (error || !data || data.rate === null) {
        console.error(
          "Supabase error fetching USD/IDR rate:",
          error?.message || "No data"
        );
        return null;
      }
      return Number(data.rate);
    } catch (e) {
      console.error("Critical error in _fetchUsdToIdrRate:", e.message);
      return null;
    }
  }

  async _fetchNativeUsdPrice(priceSymbol) {
    try {
      const { data, error } = await supabase
        .from("crypto_prices")
        .select("price_usd")
        .eq("symbol", priceSymbol)
        .limit(1)
        .single();
      if (error || !data || data.price_usd === null) {
        console.error(
          `Supabase error fetching price for ${priceSymbol}:`,
          error?.message || "No data"
        );
        return null;
      }

      // Kembalikan data.price_usd
      return Number(data.price_usd);
    } catch (e) {
      console.error("Critical error in _fetchNativeUsdPrice:", e.message);
      return null;
    }
  }

  async _getCachedPrices() {
    const now = Date.now();
    const cache = this._priceCache;
    if (
      cache.ts + cache.ttl > now &&
      cache.nativeUsd != null &&
      cache.usdIdr != null
    ) {
      return { nativeUsd: cache.nativeUsd, usdIdr: cache.usdIdr };
    }

    const priceKey = this.constructor.PRICE_SYMBOL;

    const [nativeUsd, usdIdr] = await Promise.all([
      this._fetchNativeUsdPrice(priceKey),
      this._fetchUsdToIdrRate(),
    ]);

    this._priceCache = {
      ts: now,
      ttl: cache.ttl,
      nativeUsd: nativeUsd != null ? nativeUsd : 0,
      usdIdr: usdIdr != null ? usdIdr : 0,
    };

    return {
      nativeUsd: this._priceCache.nativeUsd,
      usdIdr: this._priceCache.usdIdr,
    };
  }

  // --- Helper Perhitungan Gas (Sama seperti sebelumnya) ---

  _calcFeeNative(gasLimit, gasPrice) {
    let totalWei;
    let feeNative = 0;

    // Periksa dan konversi ke BigInt. Jika salah satu null/undefined,
    // kode akan masuk ke blok catch.
    try {
      totalWei = BigInt(gasLimit) * BigInt(gasPrice);

      // Konversi dari BigInt Wei ke unit Native Coin (Number)
      // Note: ethers.formatEther menerima BigInt/string BigInt.
      feeNative = Number(ethers.formatEther(totalWei));
    } catch (e) {
      // Jika gasPrice atau gasLimit tidak valid (mis. undefined dari RPC error),
      // kode akan masuk ke sini. Kita log error-nya dan mengembalikan 0.
      console.error(
        "Error calculating totalFeeNative. Check gasLimit/gasPrice input.",
        e.message
      );
      feeNative = 0;
    }

    // Pastikan hasilnya adalah number (atau 0)
    return feeNative;
  }

  async _getGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      const block = await this.provider.getBlock("latest").catch((e) => null);

      // Default aman: 1 Gwei sebagai BigInt
      const defaultGwei = ethers.parseUnits("1", "gwei");

      // Tentukan Priority Fee, fall back ke defaultGwei
      const priority =
        feeData.maxPriorityFeePerGas ??
        feeData.maxFeePerGas ??
        feeData.gasPrice ??
        defaultGwei;

      // Logika EIP-1559
      if (block && block.baseFeePerGas) {
        // Pastikan hasilnya BigInt
        return block.baseFeePerGas + priority;
      }

      // Fallback ke Legacy gasPrice (juga BigInt)
      return feeData.gasPrice || priority;
    } catch (err) {
      // JIKA ADA KEGAGALAN KRITIS RPC, KEMBALIKAN BIGINT DENGAN NILAI AMAN.
      console.error(
        "Critical RPC Error in _getGasPrice. Returning safe default:",
        err.message
      );
      // Penting: Kembalikan BigInt
      return ethers.parseUnits("1", "gwei");
    }
  }

  // --- Fungsi Utama Estimasi ---

  async estimate({ from, to, tokenAddress = null, amount = null }) {
    const symbol = this.constructor.NATIVE_SYMBOL;
    const chainId = this.constructor.CHAIN_ID;

    let gasLimit;
    try {
      if (tokenAddress) {
        const token = new ethers.Contract(
          tokenAddress,
          this.erc20Abi,
          this.provider
        );
        // Menggunakan 1 unit terkecil untuk menghindari 'revert' transfer nol.
        const SAFE_AMOUNT = BigInt(1);
        const transferAmount = amount ? BigInt(amount) : SAFE_AMOUNT;

        const data = token.interface.encodeFunctionData("transfer", [
          to,
          transferAmount,
        ]);

        gasLimit = await this.provider.estimateGas({
          from,
          to: tokenAddress,
          data,
        });
      } else {
        // Estimasi Native Coin Transfer (Default 21000)
        gasLimit = await this.provider.estimateGas({ from, to });
      }
    } catch (err) {
      console.warn(
        `estimateGas failed on Chain ${chainId}:`,
        err?.message || err
      );
      // Fallback: 21000 untuk native, 70000 untuk ERC20
      const SAFE_GAS_LIMIT = tokenAddress ? BigInt(70000) : BigInt(21000);
      gasLimit = SAFE_GAS_LIMIT;
    }

    const gasPrice = await this._getGasPrice();
    const totalFeeNative = this._calcFeeNative(gasLimit, gasPrice);
    const { nativeUsd, usdIdr } = await this._getCachedPrices();
    const totalFeeUSD = nativeUsd ? totalFeeNative * nativeUsd : 0;
    const totalFeeIDR = usdIdr ? totalFeeUSD * usdIdr : 0;

    // DEBUG LOGS: show fetched prices and computed fees
    console.log("Computed fees:", {
      chainId,
      symbol,
      gasLimit: String(gasLimit),
      gasPrice: String(gasPrice),
      totalFeeNative,
      nativeUsd,
      totalFeeUSD,
      usdIdr,
      totalFeeIDR,
    });

    // Build priceInfo + warning if something missing
    const priceInfo = { nativeUsd, usdIdr };
    const priceWarning = [];
    if (!nativeUsd || nativeUsd === 0)
      priceWarning.push("nativeUsd missing or zero");
    if (!usdIdr || usdIdr === 0) priceWarning.push("usdIdr missing or zero");

    return {
      error: false,
      chainId,
      symbol,
      gasLimit: Number(BigInt(gasLimit).toString()),
      gasPrice: Number(BigInt(gasPrice).toString()),
      totalFeeNative: `${totalFeeNative.toFixed(8)} ${symbol}`,
      totalFeeUSD,
      totalFeeIDR,
      priceInfo,
      priceWarning: priceWarning.length ? priceWarning : undefined,
    };
  }
}
