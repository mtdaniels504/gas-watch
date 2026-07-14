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
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        // 1. DATABASE CHECK
        let { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
            .order('price', { ascending: true });

        // 2. EXPLICIT TRIGGER
        // If data is empty OR forceRefresh is true, we MUST trigger smartIngestion
        if (!data || data.length === 0 || forceRefresh) {
            console.log(`🔍 No local data found for "${search}". Forcing smartIngestion...`);
            
            // This MUST log "📡 Fetching data for..." if smartIngestion/runIngestion work
            await smartIngestion(search); 
            
            // Re-fetch after the potential scrape
            const { data: newData, error: newErr } = await supabase
                .from('gas_stations')
                .select('*')
                .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
                .order('price', { ascending: true });

            if (newErr) throw newErr;
            
            // If it's STILL empty, THEN we return empty
            if (!newData || newData.length === 0) {
                console.log(`⚠️ Scraper returned no results for: ${search}`);
                return res.json({ status: "EMPTY", stations: [] });
            }
            
            return res.json({ status: "OK", stations: newData });
        }

        // Data found!
        res.json({ status: "OK", stations: data });

    } catch (err) {
        console.error("Backend Error:", err);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
