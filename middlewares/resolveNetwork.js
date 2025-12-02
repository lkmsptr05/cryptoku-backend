// middleware/resolveNetwork.js
import { getNetworkByKey } from "../services/networkService.js"; // adjust path

/**
 * Middleware:
 * - expects req.body.networkKey OR req.query.networkKey
 * - fetches rpcUrl + chainId from DB
 * - attaches into req.networkInfo
 *
 * Usage: router.post("/estimate", resolveNetwork, handler)
 */
export async function resolveNetwork(req, res, next) {
  try {
    const networkKey = req.body.networkKey || req.query.networkKey;
    if (!networkKey) {
      return res.status(400).json({
        error: true,
        message: "networkKey is required",
      });
    }

    const { data, error } = await getNetworkByKey(networkKey);
    if (error || !data) {
      console.error("Network lookup error:", error?.message);
      return res.status(400).json({
        error: true,
        message: `Invalid networkKey: ${networkKey}`,
      });
    }

    if (!data.rpc_url || !data.chain_id) {
      return res.status(400).json({
        error: true,
        message: `Nertwork data incomplete for key ${networkKey}`,
      });
    }

    // Attach result to request object
    req.networkInfo = {
      networkKey,
      rpcUrl: data.rpc_url,
      chainId: Number(data.chain_id),
    };

    next();
  } catch (e) {
    console.error("resolveNetwork middleware error:", e);
    return res.status(500).json({
      error: true,
      message: "resolveNetwork internal error",
    });
  }
}
