require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion, runIngestion } = require('./ingest.js');
const { runFullSweep } = require('./geocode-sweeper.js'); // Import the sweeper

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        if (!search) return res.status(400).json({ error: "Missing search" });

        const cleanSearch = search.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();

        const status = await smartIngestion(cleanSearch); 

        // Helper to trigger scrape + background geocoding
        const performScrapeAndSweep = async () => {
            await runIngestion(cleanSearch);
            // Fire-and-forget the sweeper so it doesn't delay the API response
            runFullSweep(5).then(count => console.log(`🌍 Sweeper finished. Items cleaned: ${count}`));
        };

        if (status === 'MISSING') {
            await performScrapeAndSweep();
            const { data } = await supabase.from('gas_stations').select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
                .order('price', { ascending: true });
            return res.json({ status: "OK", info: "Fetching new data...", stations: data || [] });
        }

        if (status === 'STALE' && !forceRefresh) {
            const { data } = await supabase.from('gas_stations').select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
                .order('price', { ascending: true });
            return res.json({ status: "STALE", message: "New data available. Refresh?", stations: data });
        }

        if (forceRefresh) {
            await performScrapeAndSweep();
        }

        const { data, error } = await supabase.from('gas_stations').select('*')
            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
            .order('price', { ascending: true });

        if (error) throw error;
        res.json({ status: "OK", info: forceRefresh ? "Updated successfully." : null, stations: data });

    } catch (err) {
        console.error("🚨 Backend Error:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
