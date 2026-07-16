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

        // 1. CASE: MISSING DATA
        if (status === 'MISSING') {
            const result = await runIngestion(cleanSearch);
            
            if (result.status === 'EMPTY') {
                // This message DOES NOT contain "Geocoding", so polling will NOT trigger
                return res.json({ 
                    status: "OK", 
                    info: "No Stations Were Found for the Searched Location, Please Review the Search Query or Add a Gas Station for Review" 
                });
            }
            
            // This message contains "Geocoding", so polling WILL trigger
            return res.json({ 
                status: "OK", 
                info: "Gas Prices Successfully Updated, Geocoding New Locations...", 
                stations: result.stations 
            });
        }

        // 2. CASE: STALE DATA
        if (status === 'STALE' && !forceRefresh) {
            const { data } = await supabase.from('gas_stations').select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`);
                
            return res.json({ 
                status: "STALE", 
                message: "New data available. Would you like to trigger a price refresh?", 
                stations: data 
            });
        }

        // 3. CASE: REFRESH TRIGGERED (From STALE-Yes or Forced)
        if (forceRefresh) {
            const result = await runIngestion(cleanSearch);
            return res.json({ 
                status: "OK", 
                info: "Gas Prices Successfully Updated, Geocoding New Locations...", 
                stations: result.stations 
            });
        }

        // 4. CASE: FRESH DATA
        const { data } = await supabase.from('gas_stations').select('*')
            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`);

        res.json({ status: "OK", stations: data });

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
            .or('lat.is.null,lon.is.null');

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
