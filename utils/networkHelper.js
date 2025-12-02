// utils/networkHelper.js
import supabase from "../utils/supabase.js";
import { ethers } from "ethers";

async function getNetworkRpcByKey(networkKey) {
  const { data, error } = await supabase
    .from("supported_networks")
    .select("rpc_url")
    .eq("key", networkKey)
    .limit(1)
    .single();

  if (error || !data) {
    console.error("Network lookup error:", error?.message);
    return null;
  }
  return data.rpc_url;
}

async function getTokenDecimals(tokenAddress, rpcUrl) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    // Minimal ABI untuk mendapatkan decimals
    const abi = ["function decimals() view returns (uint8)"];
    const tokenContract = new ethers.Contract(tokenAddress, abi, provider);

    const decimals = await tokenContract.decimals();

    return Number(decimals); // Kembalikan sebagai angka
  } catch (err) {
    console.error(`Failed to fetch decimals for ${tokenAddress}:`, err.message);
    return null; // Kembalikan null jika gagal
  }
}

const DEFAULT_TON_SENDER = "UQBV0bF_9gJgCwxARrl7NFn4Vj-OBPRQ-d8c4VWKMsaCTP7s";
// EVM: Alamat 0x yang Anda gunakan
const DEFAULT_EVM_SENDER = "0x8aa24a4BDE4714ac76c24143Add731fe3aeD0a0b";

function getDefaultSenderAddress(networkKey) {
  if (networkKey === "ton") {
    return DEFAULT_TON_SENDER;
  }
  // Asumsi semua key lain adalah EVM
  return DEFAULT_EVM_SENDER;
}

export { getNetworkRpcByKey, getTokenDecimals, getDefaultSenderAddress };
