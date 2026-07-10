require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// 1. Import your ingestion functions
const { smartIngestion } = require('./ingest.js'); 

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.static(path.join(__dirname, 'public')));

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
            // We do NOT await this, so the API response isn't delayed
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
