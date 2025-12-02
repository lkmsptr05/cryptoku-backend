import { ethers } from "ethers";
import supabase from "../../utils/supabase.js"; // sesuaikan path

/*
  evmEstimatorGas.js
  - Improved robustness: RPC retry wrapper, safer native-amount handling,
    retries for provider calls, fallbacks, and clearer error messages.
  - Exports createEstimator(chainId, rpcUrl) factory.
*/

const DEFAULT_FALLBACK_GAS_ERC20 = 100_000n; // conservative fallback for ERC20 transfer
const DEFAULT_FALLBACK_GAS_NATIVE = 21_000n; // native transfer

// --- helper: generic RPC call with retries ---
async function rpcCallWithRetry(fn, args = [], opts = {}) {
  const { retries = 3, delay = 200 } = opts;
  let attempt = 0;
  let lastErr = null;
  while (attempt < retries) {
    try {
      return await fn(...args);
    } catch (e) {
      lastErr = e;
      attempt++;
      // backoff
      await new Promise((r) => setTimeout(r, delay * attempt));
    }
  }
  throw lastErr;
}

class BaseGasEstimator {
  constructor({ rpcUrl, chainId, priceKey, nativeSymbol }) {
    if (!rpcUrl) throw new Error("rpcUrl required");
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.chainId = Number(chainId);
    this.priceKey = priceKey; // key in crypto_prices
    this.nativeSymbol = nativeSymbol || "NATIVE";

    // minimal and extended ABI
    this.erc20Abi = [
      "function transfer(address to, uint256 value)",
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ];

    this._priceCache = { ts: 0, nativeUsd: null, usdIdr: null, ttl: 10_000 };
  }

  // --- price helpers (same logic as before) ---
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

  async _fetchNativeUsdPrice() {
    if (!this.priceKey) return null;
    const { data, error } = await supabase
      .from("crypto_prices")
      .select("price_usd")
      .eq("symbol", this.priceKey)
      .limit(1)
      .single();
    if (error || !data) {
      console.warn(
        "crypto_prices fetch failed for",
        this.priceKey,
        error?.message
      );
      return null;
    }
    return Number(data.price_usd);
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
    const [nativeUsd, usdIdr] = await Promise.all([
      this._fetchNativeUsdPrice(),
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

  // --- gas price retrieval (EIP-1559 aware) with retry and safe fallback ---
  async _getGasPrice() {
    let feeData = null;
    let block = null;
    try {
      feeData = await rpcCallWithRetry(
        this.provider.getFeeData.bind(this.provider),
        [],
        { retries: 2, delay: 150 }
      );
    } catch (e) {
      console.warn("getFeeData failed:", e?.message || e);
    }
    try {
      block = await rpcCallWithRetry(
        this.provider.getBlock.bind(this.provider),
        ["latest"],
        { retries: 2, delay: 150 }
      );
    } catch (e) {
      console.warn("getBlock latest failed:", e?.message || e);
    }

    const priority =
      feeData?.maxPriorityFeePerGas ??
      feeData?.maxFeePerGas ??
      feeData?.gasPrice ??
      ethers.parseUnits("1", "gwei");

    if (block && block.baseFeePerGas) {
      try {
        return (
          block.baseFeePerGas + (priority || ethers.parseUnits("1", "gwei"))
        );
      } catch (e) {
        console.warn(
          "calculating EIP-1559 fee failed, fallback to priority:",
          e?.message || e
        );
        return priority;
      }
    }

    // fallback to whatever we have (priority at minimum)
    return priority;
  }

  _calcFeeNative(gasLimit, gasPrice) {
    const totalWei = BigInt(gasLimit) * BigInt(gasPrice);
    return Number(ethers.formatEther(totalWei.toString()));
  }

  // --- helpers for token checks ---
  async _hasContractCode(address) {
    try {
      const code = await rpcCallWithRetry(
        this.provider.getCode.bind(this.provider),
        [address],
        { retries: 2, delay: 150 }
      );
      return code && code !== "0x";
    } catch (e) {
      console.warn("getCode failed:", e?.message || e);
      return false;
    }
  }

  async _readBalance(tokenContract, address) {
    try {
      const bal = await tokenContract.balanceOf(address);
      return BigInt(bal.toString());
    } catch (e) {
      // balanceOf can revert on some tokens — treat as unknown
      console.warn("balanceOf failed:", e?.message || e);
      return null;
    }
  }

  // main public API
  async estimate({ from, to, tokenAddress = null, amount = null }) {
    let gasLimit;
    const chainId = this.chainId;
    const symbol = this.nativeSymbol;

    // ERC20 path
    if (tokenAddress) {
      // check contract exists at tokenAddress
      const hasCode = await this._hasContractCode(tokenAddress);
      if (!hasCode) {
        return {
          error: true,
          message: `tokenAddress ${tokenAddress} has no bytecode on chainId ${chainId}`,
        };
      }

      const token = new ethers.Contract(
        tokenAddress,
        this.erc20Abi,
        this.provider
      );

      // determine transfer amount: if provided use it, otherwise 1 unit
      const transferAmount = amount ? BigInt(amount) : 1n;

      // quick balance check (non-fatal if fails)
      const balance = await this._readBalance(token, from);
      if (balance != null && balance < transferAmount) {
        return {
          error: true,
          message: `insufficient token balance for from on chainId ${chainId}`,
        };
      }

      const data = token.interface.encodeFunctionData("transfer", [
        to,
        transferAmount,
      ]);

      // prefer callStatic to capture revert reasons
      try {
        await token.callStatic.transfer(to, transferAmount, { from });
        gasLimit = await rpcCallWithRetry(
          this.provider.estimateGas.bind(this.provider),
          [{ from, to: tokenAddress, data }],
          { retries: 2, delay: 200 }
        );
      } catch (callErr) {
        console.warn(
          "callStatic/estimateGas failed for token transfer:",
          callErr?.message || callErr
        );
        // Try estimateGas anyway (some nodes behave differently). If fails, fallback.
        try {
          gasLimit = await rpcCallWithRetry(
            this.provider.estimateGas.bind(this.provider),
            [{ from, to: tokenAddress, data }],
            { retries: 2, delay: 200 }
          );
        } catch (e2) {
          console.warn(
            "final estimateGas for token failed, using fallback",
            e2?.message || e2
          );
          gasLimit = DEFAULT_FALLBACK_GAS_ERC20;
        }
      }
    } else {
      // native transfer path (robust)
      try {
        const value = amount ? BigInt(amount) : 1n;

        // check native balance (non-fatal)
        try {
          const bal = await rpcCallWithRetry(
            this.provider.getBalance.bind(this.provider),
            [from],
            { retries: 2, delay: 150 }
          );
          if (bal != null && BigInt(bal.toString()) < value) {
            console.warn(
              "Insufficient native balance for from:",
              from,
              "balance:",
              bal.toString(),
              "needed:",
              value.toString()
            );
            return {
              error: true,
              message: "insufficient native balance for estimate on this chain",
            };
          }
        } catch (bErr) {
          console.warn(
            "getBalance check failed (continuing):",
            bErr?.message || bErr
          );
        }

        // attempt estimateGas with retries
        try {
          gasLimit = await rpcCallWithRetry(
            this.provider.estimateGas.bind(this.provider),
            [{ from, to, value }],
            { retries: 2, delay: 200 }
          );
          if (BigInt(gasLimit) < 21000n) gasLimit = 21000n;
        } catch (e) {
          console.warn(
            "native estimateGas failed after retries, using fallback",
            e?.message || e
          );
          gasLimit = DEFAULT_FALLBACK_GAS_NATIVE;
        }
      } catch (outer) {
        console.warn(
          "native branch outer error, using fallback",
          outer?.message || outer
        );
        gasLimit = DEFAULT_FALLBACK_GAS_NATIVE;
      }
    }

    // gasPrice / fee
    const gasPrice = await this._getGasPrice();
    const totalFeeNative = this._calcFeeNative(gasLimit, gasPrice);
    const { nativeUsd, usdIdr } = await this._getCachedPrices();
    const totalFeeUSD = nativeUsd ? totalFeeNative * nativeUsd : 0;
    const totalFeeIDR = usdIdr ? totalFeeUSD * usdIdr : 0;

    return {
      error: false,
      chainId,
      symbol,
      gasLimit: Number(BigInt(gasLimit).toString()),
      gasPrice: Number(BigInt(gasPrice).toString()),
      totalFeeNative: `${totalFeeNative.toFixed(8)} ${symbol}`,
      totalFeeUSD,
      totalFeeIDR,
    };
  }
}

// --- Network-specific subclasses (they can customize priceKey, nativeSymbol etc.) ---
class EthereumGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 1, priceKey: "ethusdt", nativeSymbol: "ETH" });
  }
}

class BscGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 56, priceKey: "bnbusdt", nativeSymbol: "BNB" });
  }
}

class PolygonGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 137, priceKey: "polusdt", nativeSymbol: "MATIC" });
  }
}

class ArbitrumGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 42161, priceKey: "ethusdt", nativeSymbol: "ETH" });
  }
}

class OptimismGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 10, priceKey: "ethusdt", nativeSymbol: "ETH" });
  }
}

class BaseChainGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({ rpcUrl, chainId: 8453, priceKey: "ethusdt", nativeSymbol: "ETH" });
  }
}

class AvaxGasEstimator extends BaseGasEstimator {
  constructor(rpcUrl) {
    super({
      rpcUrl,
      chainId: 43114,
      priceKey: "avaxusdt",
      nativeSymbol: "AVAX",
    });
  }
}

// factory
export function createEstimator(chainId, rpcUrl) {
  switch (Number(chainId)) {
    case 1:
      return new EthereumGasEstimator(rpcUrl);
    case 56:
      return new BscGasEstimator(rpcUrl);
    case 137:
      return new PolygonGasEstimator(rpcUrl);
    case 42161:
      return new ArbitrumGasEstimator(rpcUrl);
    case 10:
      return new OptimismGasEstimator(rpcUrl);
    case 8453:
      return new BaseChainGasEstimator(rpcUrl);
    case 43114:
      return new AvaxGasEstimator(rpcUrl);
    default:
      // default to base with provided chainId
      return new BaseGasEstimator({
        rpcUrl,
        chainId,
        priceKey: "ethusdt",
        nativeSymbol: "NATIVE",
      });
  }
}

export default BaseGasEstimator;
