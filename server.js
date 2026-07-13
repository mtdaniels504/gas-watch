require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion } = require('./ingest.js'); // Only need this now!

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        // Fetch data
        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        // 1. CASE: No Data at all
        if (!data || data.length === 0) {
            smartIngestion(search).catch(err => console.error("Background sync error:", err));
            return res.json({ status: "PENDING", message: "No data found, starting fresh scrape..." });
        }

        // 2. CASE: Data exists, check freshness (48hr rule)
        const oldestEntry = new Date(data[data.length - 1].last_updated);
        const isStale = (new Date() - oldestEntry) > (48 * 60 * 60 * 1000);

        res.json({ 
            status: "OK",
            isStale,
            origin: { lat: data[0].lat, lon: data[0].lon },
            stations: data
        });

    } catch (err) {
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
