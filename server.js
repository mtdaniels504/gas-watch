require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// 1. Import your ingestion functions
const { smartIngestion, geocodePending } = require('./ingest.js'); 

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.use(express.static(path.join(__dirname, 'public')));

// Existing Gas Prices Route
app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        const isDataMissing = !data || data.length === 0;

        if (isDataMissing) {
            console.warn(`⚠️ No data found for: ${normalizedCity}. Triggering background sync...`);
            
            // 2. TRIGGER BACKGROUND SYNC
            smartIngestion(search).catch(err => console.error("Background scrape failed:", err));
            
            return res.json({ 
                origin: { lat: 39.7392, lon: -104.9903 }, 
                stations: [], 
                status: "PENDING",
                message: "We're fetching fresh prices for this area. Please wait a moment."
            });
        }

        res.json({ 
            origin: { lat: data[0].lat, lon: data[0].lon }, 
            stations: data,
            status: "OK"
        });

    } catch (err) {
        console.error("🔴 Database Route Error:", err);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

// 3. NEW: Internal Task Route for Batch Geocoding
// Call this endpoint from a CRON job service (e.g., cron-job.org)
app.post('/api/tasks/geocode-sweep', async (req, res) => {
    try {
        console.log("🛠️ Starting manual geocode sweep...");
        await geocodePending();
        res.status(200).json({ message: "Geocode sweep triggered successfully" });
    } catch (err) {
        console.error("🔴 Geocode Sweep Error:", err);
        res.status(500).json({ error: "Geocode sweep failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
