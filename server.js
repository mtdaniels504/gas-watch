require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

// Inside server.js
app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        if (!search) return res.status(400).json({ error: "Missing search" });

        // 1. Just check the DB once.
        let { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
            .order('price', { ascending: true });

        // 2. If empty OR forceRefresh, trigger the scraper
        if (!data || data.length === 0 || forceRefresh) {
            console.log(`📡 Triggering smartIngestion for: ${search}`);
            await smartIngestion(search); // This now handles the scrape AND the write to DB
            
            // Re-query once
            const { data: newData } = await supabase
                .from('gas_stations')
                .select('*')
                .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
                .order('price', { ascending: true });
                
            return res.json({ status: "OK", stations: newData || [] });
        }

        res.json({ status: "OK", stations: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
