// src/routes/tokens.js

import express from "express";
import { getSupportedTokens, getTokensByNetwork } from "../services/tokenService.js"; // 🎯 Import fungsi yang baru

const router = express.Router();

router.get("/", async (req, res) => {
  // Ambil query parameter 'network' dari URL: /tokens?network=bsc
  const networkKey = req.query.network; 
  
  if (!networkKey) {
    const tokens = await getSupportedTokens()
    if (!tokens || tokens.length === 0) {
        return res.status(404).json({ 
        error: `Tidak ada token ditemukan`,
        data: [] 
      });
    }
    return res.status(200).json({ 
      success: true, 
      data: tokens 
    });
  }

  try {
    const tokens = await getTokensByNetwork(networkKey);
    
    // Jika tidak ada token ditemukan
    if (!tokens || tokens.length === 0) {
      return res.status(404).json({ 
        error: `Tidak ada token ditemukan untuk network: ${networkKey}`,
        data: [] 
      });
    }

    // Mengirimkan data token
    return res.status(200).json({ 
      success: true, 
      data: tokens 
    });

  } catch (err) {
    // Menangani error dari service layer (misalnya error Supabase)
    console.error(`Error processing request for network ${networkKey}:`, err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;