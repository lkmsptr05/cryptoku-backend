// services/gas/TonEstimatorGas.js
// ESM module
import TonWeb from "tonweb";
import { getPrice, getExchangeRate } from "../priceService.js";

/**
 * TonEstimatorGas (output aligned with EVM estimator)
 *
 * - Uses a static GETBLOCK addrState RPC URL by default (see DEFAULT_ADDR_STATE_RPC)
 * - Accepts either a rpcUrl string or an options object in constructor
 * - estimate({ from, to, tokenAddress, amount })
 *
 * Notes:
 * - If your Node < 18, ensure a fetch polyfill (e.g. node-fetch) is installed and set global.fetch.
 * - For GetBlock the API key is usually embedded in URL: https://go.getblock.io/<API_KEY>/jsonRPC
 */

// ========= CONFIG (edit as needed) ==========

// Default GetBlock example (you can override via process.env.GETBLOCK_RPC_URL)
const DEFAULT_ADDR_STATE_RPC =
  "https://go.getblock.io/cca799d46b44478988dc6c8a256ee9c9/jsonRPC";

// Default provider (fallback)
function defaultRpcUrl() {
  return "https://toncenter.com/api/v2/jsonRPC";
}

// ========== UTIL =============

function ensureFetch() {
  if (typeof fetch === "undefined") {
    throw new Error(
      "global.fetch not found. On Node <18 install a fetch polyfill such as `node-fetch` and set global.fetch = require('node-fetch') before importing this module."
    );
  }
}

// Generic JSON-RPC runGetMethod (TonCenter / compatible endpoints)
async function rpcRunGetMethod(providerUrl, apiKey, address, method) {
  ensureFetch();
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "runGetMethod",
    params: { address, method, stack: [] },
  };
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const resp = await fetch(providerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function getSeqno(providerUrl, apiKey, address) {
  try {
    const j = await rpcRunGetMethod(providerUrl, apiKey, address, "seqno");
    if (
      j &&
      j.result &&
      Array.isArray(j.result.stack) &&
      j.result.stack.length
    ) {
      return Number(j.result.stack[0][1]) || 0;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

// getAddressState for GetBlock-style endpoint (or any JSON-RPC that accepts getAddressState)
async function getAddressStateRpc(providerUrl, apiKey, address) {
  ensureFetch();
  const body = {
    jsonrpc: "2.0",
    method: "getAddressState",
    params: { address },
    id: "getblock.io",
  };
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const resp = await fetch(providerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  try {
    const j = await resp.json();
    if (j && (j.result || j.state || j.ok !== undefined)) {
      if (typeof j.result === "string") return j.result;
      if (typeof j.state === "string") return j.state;
      if (j.ok === true && typeof j.result === "string") return j.result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Normalize fee shapes into { nano, breakdown }
function extractFeeNano(info) {
  if (info == null) return { nano: "0", breakdown: null };
  if (typeof info === "number" || typeof info === "string")
    return { nano: String(info), breakdown: null };

  try {
    if (info && info["@type"] === "query.fees" && info.source_fees) {
      const sf = info.source_fees;
      const keys = [
        "in_fwd_fee",
        "inFwdFee",
        "in_fwdFee",
        "storage_fee",
        "storageFee",
        "gas_fee",
        "gasFee",
        "fwd_fee",
        "fwdFee",
        "forwardFee",
        "fee",
      ];
      let sum = 0;
      let found = false;
      for (const k of keys) {
        if (sf && Object.prototype.hasOwnProperty.call(sf, k)) {
          const n = Number(sf[k]);
          if (!isNaN(n)) {
            sum += n;
            found = true;
          }
        }
      }
      if (Array.isArray(info.destination_fees)) {
        for (const d of info.destination_fees) {
          if (!d) continue;
          if (typeof d === "number" || typeof d === "string") {
            const n = Number(d);
            if (!isNaN(n)) {
              sum += n;
              found = true;
            }
          } else if (typeof d === "object") {
            for (const k of keys) {
              if (Object.prototype.hasOwnProperty.call(d, k)) {
                const n = Number(d[k]);
                if (!isNaN(n)) {
                  sum += n;
                  found = true;
                }
              }
            }
          }
        }
      }
      if (found) return { nano: String(sum), breakdown: info };
    }
  } catch (e) {
    // continue heuristics
  }

  const singleFields = [
    "total",
    "fee",
    "totalFee",
    "forward_fee",
    "forwardFee",
    "inFwdFee",
    "value",
  ];
  for (const f of singleFields) {
    if (Object.prototype.hasOwnProperty.call(info, f)) {
      return { nano: String(info[f]), breakdown: info };
    }
  }

  const components = [
    "inFwdFee",
    "storageFee",
    "gasFee",
    "forwardFee",
    "fwdFee",
    "fee",
  ];
  let sum = 0;
  let found = false;
  for (const c of components) {
    if (Object.prototype.hasOwnProperty.call(info, c)) {
      const v = info[c];
      const n = Number(v && v.toString ? v.toString() : v);
      if (!isNaN(n)) {
        sum += n;
        found = true;
      }
    }
  }
  if (found) return { nano: String(sum), breakdown: info };

  try {
    if (typeof info.toString === "function") {
      const s = info.toString();
      if (s && !s.includes("[object"))
        return { nano: String(s), breakdown: info };
    }
  } catch (e) {}

  return { nano: null, breakdown: info };
}

// ========= CLASS ===========

export class TonEstimatorGas {
  static CHAIN_ID = null;
  static PRICE_SYMBOL = "tonusdt";
  static NATIVE_SYMBOL = "TON";

  /**
   * rpcOrOptions:
   *  - string -> providerUrl (eg. TonCenter or GetBlock)
   *  - object -> { rpcUrl, apiKey, addrStateRpcUrl, initFeeTon, safeMultiplier, priceOverride }
   *
   * priceOverride: { nativeUsd: number, usdIdr: number } // optional
   */
  constructor(rpcOrOptions) {
    if (typeof rpcOrOptions === "string" || rpcOrOptions == null) {
      this.providerUrl = rpcOrOptions || defaultRpcUrl();
      this.apiKey =
        process.env.TONCENTER_KEY ||
        "ef4c9cbcc1dd9c5b1a004e9ea7a5a872032b8e42a8671f9ca1cf19230cbee700";
      this.addrStateRpcUrl =
        process.env.GETBLOCK_RPC_URL ||
        DEFAULT_ADDR_STATE_RPC ||
        this.providerUrl;
      this.initFeeTon = 0.005135735;
      this.safeMultiplier = 3.56;
      this.priceOverride = null;
    } else {
      this.providerUrl = rpcOrOptions.rpcUrl || defaultRpcUrl();
      this.apiKey =
        rpcOrOptions.apiKey ||
        process.env.TONCENTER_KEY ||
        "ef4c9cbcc1dd9c5b1a004e9ea7a5a872032b8e42a8671f9ca1cf19230cbee700";
      this.addrStateRpcUrl =
        rpcOrOptions.addrStateRpcUrl ||
        process.env.GETBLOCK_RPC_URL ||
        DEFAULT_ADDR_STATE_RPC ||
        this.providerUrl;
      this.initFeeTon =
        typeof rpcOrOptions.initFeeTon === "number"
          ? rpcOrOptions.initFeeTon
          : 0.005135735;
      this.safeMultiplier =
        typeof rpcOrOptions.safeMultiplier === "number"
          ? rpcOrOptions.safeMultiplier
          : 3.56;
      this.priceOverride = rpcOrOptions.priceOverride || null;
    }

    this._tonweb = null;

    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV !== "production"
    ) {
      console.debug("[TonEstimatorGas] providerUrl =", this.providerUrl);
      console.debug(
        "[TonEstimatorGas] addrStateRpcUrl =",
        this.addrStateRpcUrl
      );
    }
  }

  _ensureTonWeb() {
    if (!this._tonweb) {
      this._tonweb = new TonWeb(
        new TonWeb.HttpProvider(this.providerUrl, { apiKey: this.apiKey })
      );
    }
    return this._tonweb;
  }

  /**
   * estimate({ from, to, tokenAddress, amount })
   * - from, to: TON addresses (strings)
   * - tokenAddress: NOT SUPPORTED here (jetton)
   * - amount: string human like "0.1" or digits-only nano string; if omitted defaults to "1"
   */
  async estimate({ from, to, tokenAddress = null, amount }) {
    ensureFetch();

    if (!from || !to) {
      throw new Error("from and to are required for TON estimate");
    }

    if (tokenAddress) {
      throw new Error(
        "tokenAddress (jetton) estimation not supported in TonEstimatorGas. Use a jetton-specific estimator."
      );
    }

    const tonweb = this._ensureTonWeb();

    // get seqno & seqnoTo
    const seqno = await getSeqno(this.providerUrl, this.apiKey, from);
    const seqnoTo = await getSeqno(this.providerUrl, this.apiKey, to);

    // normalize amount
    let amountNano;
    if (typeof amount === "string" && /^\d+$/.test(amount)) {
      amountNano = amount; // already nano
    } else {
      // default 1 TON if not provided
      amountNano = TonWeb.utils
        .toNano(String(amount == null ? "1" : amount))
        .toString();
    }

    // prepare wallet instance (dummy public key)
    const WalletClass =
      (tonweb.wallet && tonweb.wallet.all && tonweb.wallet.all.v4R2) ||
      (tonweb.wallet && tonweb.wallet.v4) ||
      (tonweb.wallet && tonweb.wallet.walletV4) ||
      (tonweb.wallet && tonweb.wallet.all && tonweb.wallet.all.v4);

    if (!WalletClass) {
      throw new Error("tonweb wallet class not found in this tonweb build");
    }

    const dummy = new Uint8Array(32);
    const wallet = new WalletClass(tonweb.provider, {
      publicKey: dummy,
      wc: 0,
    });

    // build transfer object (may be thenable)
    let transfer = wallet.methods.transfer({
      secretKey: null,
      toAddress: to,
      amount: amountNano,
      seqno: String(seqno),
      payload: "",
      sendMode: 3,
    });

    if (transfer && typeof transfer.then === "function") {
      transfer = await transfer;
    }

    // Attempt to detect destination state using getAddressState (GetBlock-style)
    let destState = null;
    try {
      destState = await getAddressStateRpc(
        this.addrStateRpcUrl,
        this.apiKey,
        to
      );
    } catch (e) {
      destState = null;
    }

    // fallback: if destState unavailable, infer uninitialized by seqnoTo === 0
    const destAppearsUninit = !destState
      ? Number(seqnoTo || 0) === 0
      : String(destState).toLowerCase() === "uninitialized";

    // Call estimateFee if available
    let feeRaw = null;
    let normalized = null;
    let recommended = null;
    let breakdown = null;

    if (transfer && typeof transfer.estimateFee === "function") {
      try {
        feeRaw = await transfer.estimateFee();
        const { nano, breakdown: bd } = extractFeeNano(feeRaw);
        breakdown = bd || null;

        if (nano !== null && !isNaN(Number(nano))) {
          normalized = { nano: String(nano), ton: Number(nano) / 1e9 };

          // compute recommended safe fee:
          // init fee (flat)
          const initBufferTon = this.initFeeTon || 0.005135735;
          const initBufferNano = Number(
            TonWeb.utils.toNano(String(initBufferTon)).toString()
          );

          // base gas
          const baseNano = Number(isNaN(Number(nano)) ? 0 : Number(nano));

          // decider
          let extraInit = 0;
          let safeMultiplier;

          if (destAppearsUninit) {
            extraInit = initBufferNano;
            safeMultiplier = 1.2; // multiplier kecil kalau wallet belum init
          } else {
            extraInit = 0;
            safeMultiplier = 3.56; // multiplier besar kalau wallet sudah init
          }

          const recommendedBase = Math.ceil(
            (baseNano + extraInit) * safeMultiplier
          );

          recommended = {
            nano: String(recommendedBase),
            ton: recommendedBase / 1e9,
            details: { baseNano, extraInit, safeMultiplier, destState },
          };
        } else {
          normalized = null;
        }
      } catch (e) {
        const ex = new Error(
          "estimateFee failed: " + (e && e.message ? e.message : String(e))
        );
        ex.cause = e;
        throw ex;
      }
    } else {
      // estimateFee not available: return meta & destState, no fee info
      // but produce EVM-like output with zeros/warnings
      const priceResp = this.priceOverride
        ? { data: { price_usd: this.priceOverride.nativeUsd || 0 } }
        : await getPrice(this.constructor.PRICE_SYMBOL || "tonusdt");
      const fxResp = await getExchangeRate("usd_idr");
      const nativeUsd = priceResp?.data?.price_usd ?? 0;
      const usdIdr = fxResp?.data?.rate ?? 0;
      const priceWarning = [];
      if (!nativeUsd) priceWarning.push("nativeUsd missing or zero");
      if (!usdIdr) priceWarning.push("usdIdr missing or zero");

      return {
        error: false,
        chainId: null,
        symbol: "TON",
        gasLimit: null,
        gasPrice: null,
        totalFeeNative: `0 TON`,
        totalFeeUSD: 0,
        totalFeeIDR: 0,
        priceInfo: { nativeUsd, usdIdr },
        priceWarning: priceWarning.length ? priceWarning : undefined,
        meta: { seqno: String(seqno), seqnoTo: String(seqnoTo), destState },
      };
    }

    // --- Build EVM-like response using priceService ---

    // fetch prices (DB) unless priceOverride provided
    let nativeUsd = 0;
    let usdIdr = 0;
    if (
      this.priceOverride &&
      typeof this.priceOverride.nativeUsd === "number" &&
      typeof this.priceOverride.usdIdr === "number"
    ) {
      nativeUsd = this.priceOverride.nativeUsd;
      usdIdr = this.priceOverride.usdIdr;
    } else {
      try {
        const priceResp = await getPrice(
          this.constructor.PRICE_SYMBOL || "tonusdt"
        );
        const fxResp = await getExchangeRate("usd_idr");
        nativeUsd = priceResp?.data?.price_usd ?? 0;
        usdIdr = fxResp?.data?.rate ?? 0;
      } catch (e) {
        nativeUsd = 0;
        usdIdr = 0;
      }
    }

    // choose fee amount (prefer recommended)
    const feeTON =
      recommended && typeof recommended.ton === "number"
        ? recommended.ton
        : normalized && typeof normalized.ton === "number"
        ? normalized.ton
        : 0;

    const totalFeeUSD = feeTON * (nativeUsd || 0);
    const totalFeeIDR = totalFeeUSD * (usdIdr || 0);

    const priceWarning = [];
    if (!nativeUsd || nativeUsd === 0)
      priceWarning.push("nativeUsd missing or zero");
    if (!usdIdr || usdIdr === 0) priceWarning.push("usdIdr missing or zero");

    return {
      error: false,
      chainId: null,
      symbol: "TON",
      gasLimit: null,
      gasPrice: null,
      totalFeeNative: `${feeTON} TON`,
      totalFeeUSD,
      totalFeeIDR,
      priceInfo: { nativeUsd, usdIdr },
      priceWarning: priceWarning.length ? priceWarning : undefined,
      meta: {
        seqno: String(seqno),
        seqnoTo: String(seqnoTo),
        amountNano: String(amountNano),
        destState,
        destAppearsUninit,
        feeRaw,
        breakdown,
        recommended,
        normalized,
      },
    };
  }
}
