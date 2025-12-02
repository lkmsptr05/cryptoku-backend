// services/GasEstimator.js
import { ethers } from "ethers";
import supabase from "../utils/supabase.js"; // sesuaikan jika lokasi instance supabase-mu beda

/**
 * GasEstimator: backend-side estimator that uses:
 * - RPC via ethers provider
 * - crypto_prices table for native token USD price (e.g. ethusdt, bnbusdt)
 * - exchange_rates table for USD->IDR rate (currency_pair = 'usd_idr')
 *
 * Returns numeric values (not formatted strings).
 */

const CHAIN_PRICE_MAP = {
  1: "ethusdt", // Ethereum mainnet native price
  56: "bnbusdt", // BSC mainnet native price
  137: "polusdt", // Polygon native price
  42161: "ethusdt", // Arbitrum (fee in ETH)
  10: "ethusdt", // Optimism (fee in ETH)
  8453: "ethusdt", // Base (fee in ETH)
  43114: "avaxusdt", // Avalanche if you add it
};

export class GasEstimator {
  constructor(rpcUrl) {
    // Pastikan rpcUrl valid. Gunakan JsonRpcProvider untuk v6
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    // Minimal ABI: hanya transfer yang kita butuhkan untuk estimasi
    this.erc20Abi = ["function transfer(address to, uint256 value)"];
    this._priceCache = { ts: 0, nativeUsd: null, usdIdr: null, ttl: 10_000 }; // 10s TTL
  }

  // helper: map chainId -> native symbol
  _nativeSymbol(chainId) {
    return (
      {
        1: "ETH",
        56: "BNB",
        137: "MATIC",
        42161: "ETH",
        10: "ETH",
        8453: "ETH",
        43114: "AVAX",
      }[Number(chainId)] || "NATIVE"
    );
  }

  // read usd_idr from exchange_rates table
  async _fetchUsdToIdrRate() {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("currency_pair", "usd_idr")
      .limit(1)
      .single();
    if (error || !data) {
      console.warn("exchange_rates fetch failed:", error?.message);
      return null;
    }
    return Number(data.rate);
  }

  // read native token USD price from crypto_prices by symbol key
  async _fetchNativeUsdPrice(priceSymbol) {
    const { data, error } = await supabase
      .from("crypto_prices")
      .select("price_usd") // Pastikan kolomnya adalah price_usd
      .eq("symbol", priceSymbol)
      .limit(1)
      .single();
    if (error || !data) {
      console.warn(
        "crypto_prices fetch failed for",
        priceSymbol,
        ":",
        error?.message
      );
      return null;
    }
    return Number(data.price_usd);
  }

  // get both prices with caching
  async _getCachedPrices(chainId) {
    const now = Date.now();
    const cache = this._priceCache;

    // Check cache
    if (
      cache.ts + cache.ttl > now &&
      cache.nativeUsd != null &&
      cache.usdIdr != null
    ) {
      return { nativeUsd: cache.nativeUsd, usdIdr: cache.usdIdr };
    }

    const priceKey = CHAIN_PRICE_MAP[Number(chainId)] || CHAIN_PRICE_MAP[1];

    const [nativeUsd, usdIdr] = await Promise.all([
      this._fetchNativeUsdPrice(priceKey),
      this._fetchUsdToIdrRate(),
    ]);

    // Update cache
    this._priceCache = {
      ts: now,
      ttl: cache.ttl,
      nativeUsd: nativeUsd != null ? nativeUsd : 0,
      usdIdr: usdIdr != null ? usdIdr : 0,
    };

    if (nativeUsd == null || usdIdr == null) {
      console.warn("Price fetch returned nulls, using 0:", {
        nativeUsd,
        usdIdr,
        priceKey,
      });
    }

    return {
      nativeUsd: this._priceCache.nativeUsd,
      usdIdr: this._priceCache.usdIdr,
    };
  }

  // calculate fee in native token from gasLimit and gasPrice
  _calcFeeNative(gasLimit, gasPrice) {
    // gasLimit and gasPrice are BigInt-compatible (ethers returns BigNumber/BigInt)
    const totalWei = BigInt(gasLimit) * BigInt(gasPrice);
    // formatEther accepts BigInt via string
    return Number(ethers.formatEther(totalWei.toString())); // native token amount (e.g. 0.00123 ETH)
  }

  async _getGasPrice() {
    const feeData = await this.provider.getFeeData();
    const block = await this.provider.getBlock("latest").catch(() => null);

    // Fallback prioritas untuk priority/maxFee
    const priority =
      feeData.maxPriorityFeePerGas ??
      feeData.maxFeePerGas ??
      feeData.gasPrice ??
      ethers.parseUnits("1", "gwei");

    // Logika EIP-1559 (jika block.baseFeePerGas tersedia)
    if (block && block.baseFeePerGas) {
      // BaseFee + Priority
      return block.baseFeePerGas + (priority || ethers.parseUnits("1", "gwei"));
    }
    // Fallback ke Legacy gasPrice
    return feeData.gasPrice || priority;
  }

  // Public API: estimate (supports native transfer or ERC20)
  async estimate({ from, to, tokenAddress = null, amount = null }) {
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    const symbol = this._nativeSymbol(chainId);

    // gasLimit
    let gasLimit;
    try {
      if (tokenAddress) {
        const token = new ethers.Contract(
          tokenAddress,
          this.erc20Abi,
          this.provider
        );

        // Solusi Super-Aman: Gunakan amount yang disuplai, atau 1 unit (BigInt(1))
        // Jika amount disuplai, kita gunakan itu. Jika tidak, kita gunakan 1 (sangat kecil).
        const SAFE_AMOUNT = BigInt(1); // 1 unit terkecil (Wei/Unit)
        const transferAmount = amount ? BigInt(amount) : SAFE_AMOUNT;

        // Coba transfer dengan 1 unit terkecil untuk menghindari 'revert' karena amount = 0
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
        // Estimasi transfer native coin
        gasLimit = await this.provider.estimateGas({
          from,
          to,
          value: ethers.parseUnits("0.000000000000000001", "ether"),
        });
      }
    } catch (err) {
      console.warn("estimateGas failed:", err?.message || err);

      // Jika estimasi gagal (revert, dll.), gunakan fallback minimal
      // Namun, fallback ini harusnya hanya digunakan jika RPC down, bukan karena revert.
      // Jika terjadi revert, gasLimit mungkin menjadi terlalu tinggi atau tidak akurat.
      // Untuk tujuan demo, kita menggunakan nilai default yang aman jika estimasi transfer native gagal.
      try {
        // Coba estimasi transfer native minimal (biasanya 21000)
        gasLimit = await this.provider.estimateGas({ from, to });
      } catch (e) {
        console.warn("Native fallback also failed. Using default 50000.");
        gasLimit = BigInt(50000); // Nilai default yang aman (BigInt untuk kompatibilitas)
      }
    }

    // gasPrice
    const gasPrice = await this._getGasPrice();

    // compute native fee
    const totalFeeNative = this._calcFeeNative(gasLimit, gasPrice); // number in native token units

    // get prices from DB (native USD and USD->IDR)
    const { nativeUsd, usdIdr } = await this._getCachedPrices(chainId);
    // totalFeeUSD = totalNative * nativeUsd
    const totalFeeUSD = nativeUsd ? totalFeeNative * nativeUsd : 0;
    const totalFeeIDR = usdIdr ? totalFeeUSD * usdIdr : 0;

    return {
      error: false,
      chainId,
      symbol,
      gasLimit: Number(gasLimit.toString()),
      gasPrice: Number(gasPrice.toString()),
      totalFeeNative: `${totalFeeNative.toFixed(8)} ${symbol}`,
      totalFeeUSD,
      totalFeeIDR,
    };
  }
}
