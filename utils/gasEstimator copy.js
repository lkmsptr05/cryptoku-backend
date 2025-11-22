import { ethers } from "ethers";
import axios from "axios";

export class GasEstimator {
  constructor(rpcUrl) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    this.erc20Abi = [
      "function transfer(address to, uint256 value) public returns (bool)"
    ];

    // Mapping chainId → CoinGecko ID
    this.coinGeckoMap = {
      1: "ethereum",
      56: "binancecoin",
      137: "matic-network",
      42161: "arbitrum",
      10: "optimism",
      8453: "base",
      43114: "avalanche-2"
    };

    // Cache object
    this.priceCache = {
      timestamp: 0,
      data: null
    };

    // Cache duration (30 seconds)
    this.CACHE_DURATION = 30 * 1000;
  }

  // Detect native coin symbol
  async getNativeSymbol() {
    const net = await this.provider.getNetwork();
    const chainId = Number(net.chainId);

    const symbols = {
      1: "ETH",
      56: "BNB",
      137: "MATIC",
      42161: "ARB",
      10: "OP",
      8453: "BASE",
      43114: "AVAX",
    };

    return symbols[chainId] || "NATIVE";
  }

  // Get token price (USD + IDR) with 30-second cache
  async getPriceUSDandIDR() {
    const now = Date.now();

    // If cache still valid → return cache
    if (now - this.priceCache.timestamp < this.CACHE_DURATION) {
      return this.priceCache.data;
    }

    // Fetch new price
    const net = await this.provider.getNetwork();
    const chainId = Number(net.chainId);
    const coinId = this.coinGeckoMap[chainId];

    if (!coinId) return null;

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,idr`;

    const res = await axios.get(url);

    const prices = {
      USD: res.data[coinId].usd,
      IDR: res.data[coinId].idr
    };

    // Save to cache
    this.priceCache = {
      timestamp: now,
      data: prices
    };

    return prices;
  }

  // Estimate ERC20 transfer gas fee
  async estimateTokenTransfer({ from, to, tokenAddress, amount }) {
    try {
      const token = new ethers.Contract(tokenAddress, this.erc20Abi, this.provider);

      const data = token.interface.encodeFunctionData("transfer", [to, amount]);

      const tx = { from, to: tokenAddress, data };

      const gasLimit = await this.provider.estimateGas(tx);
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;

      const totalWei = gasLimit * gasPrice;
      const nativeFee = Number(ethers.formatEther(totalWei));

      const symbol = await this.getNativeSymbol();
      const prices = await this.getPriceUSDandIDR();

      const feeUSD = prices ? nativeFee * prices.USD : null;
      const feeIDR = prices ? nativeFee * prices.IDR : null;

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        totalFeeNative: `${nativeFee} ${symbol}`,
        totalFeeUSD: feeUSD ? `$${feeUSD.toFixed(6)}` : null,
        totalFeeIDR: feeIDR ? `Rp ${feeIDR.toLocaleString("id-ID")}` : null,
        cachedPrice: true,
        symbol
      };

    } catch (err) {
      return { error: true, message: err.message };
    }
  }
}
