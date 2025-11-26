// routes/notifications.js
import express from "express";
import supabase from "../utils/supabase.js";

const router = express.Router();

// GET /api/notifications
router.get("/", async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { data, error } = await supabase
    .from("user_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Get notifications error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Gagal mengambil notifikasi" });
  }

  res.json({ success: true, data });
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", async (req, res) => {
  const userId = Number(req.user?.id);
  const id = Number(req.params.id);

  if (!userId)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  const { error } = await supabase
    .from("user_notifications")
    .update({
      is_read: true,
      // kalau kamu punya kolom read_at, aktifkan ini:
      // read_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Mark read error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Gagal update notifikasi" });
  }

  res.json({ success: true });
});

// PATCH /api/notifications/read-all
router.patch("/read-all", async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { error } = await supabase
    .from("user_notifications")
    .update({
      is_read: true,
      // kalau ada kolom read_at dan kamu mau isi:
      // read_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("Mark all read error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menandai semua notifikasi" });
  }

  res.json({ success: true });
});

export default router;
