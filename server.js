require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

// Initialize with the PUBLIC anon key for the server
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        // Normalize city: "New York, NY" -> "new york"
        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        // 1. Run smartIngestion (Only scrapes if data is > 48h old or missing)
        await smartIngestion(search); 

        // 2. Query Supabase using the normalized city
        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .eq('city', normalizedCity)
            .order('price', { ascending: true });

        if (error) throw error;

        // 3. Safe Defaults: Prevent frontend crashes
        const defaultOrigin = { lat: 39.7392, lon: -104.9903 }; // Denver default
        const origin = (data && data.length > 0) 
            ? { lat: data[0].lat, lon: data[0].lon } 
            : defaultOrigin;

        // 4. Return clean JSON
        res.json({ 
            origin: origin, 
            stations: data || [] 
        });

    } catch (err) {
        console.error("🔴 Database Route Error:", err);
        res.status(500).json({ error: "Failed to fetch station data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
