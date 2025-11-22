import supabase from "../utils/supabase.js";

export async function getOrderById(id) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { error };
  return data;
}
