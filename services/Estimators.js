// services/Estimators.js
import { BaseEstimator } from "./BaseEstimator.js";
import { TonEstimatorGas } from "./gas/TonEstimatorGas.js";

// ============ EVM ESTIMATORS ============ //

export class EthEstimator extends BaseEstimator {
  static CHAIN_ID = 1;
  static PRICE_SYMBOL = "ethusdt";
  static NATIVE_SYMBOL = "ETH";
}

export class BscEstimator extends BaseEstimator {
  static CHAIN_ID = 56;
  static PRICE_SYMBOL = "bnbusdt";
  static NATIVE_SYMBOL = "BNB";
}

export class PolygonEstimator extends BaseEstimator {
  static CHAIN_ID = 137;
  static PRICE_SYMBOL = "maticusdt"; // ← perbaikan
  static NATIVE_SYMBOL = "MATIC";
}

export class OptimismEstimator extends BaseEstimator {
  static CHAIN_ID = 10;
  static PRICE_SYMBOL = "ethusdt";
  static NATIVE_SYMBOL = "ETH";
}

export class ArbitrumEstimator extends BaseEstimator {
  static CHAIN_ID = 42161;
  static PRICE_SYMBOL = "ethusdt";
  static NATIVE_SYMBOL = "ETH";
}

export class BaseChainEstimator extends BaseEstimator {
  static CHAIN_ID = 8453;
  static PRICE_SYMBOL = "ethusdt";
  static NATIVE_SYMBOL = "ETH";
}

export class GravityEstimator extends BaseEstimator {
  static CHAIN_ID = 1625;
  static PRICE_SYMBOL = "gusdt";
  static NATIVE_SYMBOL = "G";
}

// ============ MAPPING ============ //

export const NetworkEstimatorMap = {
  ethereum: EthEstimator,
  bsc: BscEstimator,
  polygon: PolygonEstimator,
  optimism: OptimismEstimator,
  arbitrum: ArbitrumEstimator,
  base: BaseChainEstimator,
  gravity: GravityEstimator,
  ton: TonEstimatorGas,
};
