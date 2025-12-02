import supabase from "../utils/supabase.js";

export async function getNetworks() {
  return supabase.from("supported_networks").select("*");
}

export async function getNetworkByKey(networkKey) {
  return supabase
    .from("supported_networks")
    .select("*")
    .eq("key", networkKey)
    .limit(1)
    .single();
}
