import supabase from "../utils/supabase.js";

export async function getHealthStatus() {
  const { data, error } = await supabase
    .from("system_health")
    .select("*");

  if (error) return { error };
  return data;
}
