require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        // 1. Initial Fetch (check if we even need to scrape)
        let { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        // 2. Logic: Scrape if no data OR if user specifically requested a force refresh
        if (!data || data.length === 0 || forceRefresh) {
            console.log(`🔍 ${forceRefresh ? 'Manual refresh' : 'No local data'} for ${search}. Running ingestion...`);
            
            await smartIngestion(search); 
            
            // Re-fetch after Ingestion
            const { data: newData, error: newErr } = await supabase
                .from('gas_stations')
                .select('*')
                .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
                .order('price', { ascending: true });

            if (newErr) throw newErr;
            
            // If it's STILL empty, tell the frontend to STOP the search loop
            if (!newData || newData.length === 0) {
                return res.json({ status: "EMPTY" });
            }
            
            return res.json({ status: "OK", stations: newData });
        }

        // 3. Return existing/fresh data
        res.json({ status: "OK", stations: data });

    } catch (err) {
        console.error("Backend Error:", err);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
