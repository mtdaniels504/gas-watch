require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion, runIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        const cleanSearch = search?.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();
        
        if (!cleanSearch) return res.status(400).json({ error: "Missing search" });

        const status = await smartIngestion(cleanSearch);

        // 1. MISSING: Run ingestion and return immediately
        if (status === 'MISSING' || forceRefresh) {
            const result = await runIngestion(cleanSearch);
            if (result.status === 'EMPTY') {
                return res.json({ 
                    status: "OK", 
                    info: "No Stations Found. Please check your search." 
                });
            }
            return res.json({ 
                status: "OK", 
                info: "Gas Prices Successfully Updated, Geocoding New Locations...", 
                stations: result.stations 
            });
        }

        // 2. STALE: Inform the user
        if (status === 'STALE' && !forceRefresh) {
            const { data } = await supabase.from('gas_stations')
                .select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`);

            // Only return the prompt if NOT forced
            return res.json({ 
                status: "STALE", 
                message: "Prices are over 48h old. Would you like to fetch new prices from the network?", 
                stations: data 
            });
        }

        // 3. FRESH: Fetch and include all, even if some are still geocoding
        const { data } = await supabase.from('gas_stations')
            .select('*')
            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`);

        // Check if we need to show the polling UI even for 'FRESH'
        const hasNulls = data.some(s => s.lat === null || s.lon === null);
        
        res.json({ 
            status: "OK", 
            stations: data,
            // If they are fresh but still have nulls, trigger the poller
            info: hasNulls ? "Geocoding New Locations..." : null 
        });

    } catch (err) {
        console.error("🚨 Backend Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Add this to server.js
app.get('/api/check-progress', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Query required" });

        // Check if any station matching the query still has NULL lat or lon
        const { count, error } = await supabase
            .from('gas_stations')
            .select('*', { count: 'exact', head: true })
            .or(`city.ilike.%${query}%,address.ilike.%${query}%`)
            .or('lat.is.null,lon.is.null,lat.eq.\'\',lon.eq.\'\'');

        if (error) throw error;

        // hasNulls is true if count > 0, meaning geocoding is still in progress
        res.json({ hasNulls: count > 0 });
    } catch (err) {
        console.error("🚨 Progress Check Error:", err);
        res.status(500).json({ error: "Failed to check progress" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
