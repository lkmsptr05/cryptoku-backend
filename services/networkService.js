import supabase from "../utils/supabase.js";

export async function getNetworks() {
  return supabase.from("supported_networks").select("*");
}

