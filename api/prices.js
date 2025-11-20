// api/prices.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method Not Allowed', message: 'Hanya method GET yang diizinkan.' });
    }

    try {
        // LEFT JOIN crypto_24h untuk ambil 24h change
        const { data, error } = await supabase
            .from('crypto_prices')
            .select(`
                symbol,
                price,
                timestamp,
                crypto_24h:crypto_24h (
                    pricechangepercent,
                    lastupdate
                )
            `)
            .order('symbol', { ascending: true });

        if (error) {
            console.error('Supabase fetch error:', error);
            return res.status(500).json({ error: 'Database Error', details: error.message });
        }

        // Format data supaya crypto_24h langsung ikut di object utama
        const formatted = data.map(item => ({
            symbol: item.symbol,
            price: item.price,
            timestamp: item.timestamp,
            priceChangePercent: item.crypto_24h?.pricechangepercent || 0,
            lastUpdate: item.crypto_24h?.lastupdate || null
        }));

        return res.status(200).json({ 
            success: true,
            count: formatted.length,
            data: formatted
        });

    } catch (err) {
        console.error('Internal server error:', err);
        return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
}
