require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize with the PUBLIC anon key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 1. Static file serving (Serves your index.html and frontend assets)
app.use(express.static(path.join(__dirname, 'public')));

// 2. API Route to fetch gas prices
app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        console.log("🔍 Search requested for:", search);

        if (!search) {
            return res.status(400).json({ error: "Search parameter is required" });
        }

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        // Ensure env variables are present before calling Supabase
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error("Missing Supabase environment variables");
        }

        // Query: Uses ILIKE to search both city and address columns for a match
        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
            .order('price', { ascending: true });

        if (error) {
            console.error("❌ Supabase Query Error:", error);
            throw error;
        }

        // Check if data is empty
        const isDataMissing = !data || data.length === 0;

        if (isDataMissing) {
            console.warn(`⚠️ No gas stations found for: ${normalizedCity}`);
        } else {
            console.log(`✅ Found ${data.length} stations.`);
        }

        // Logic for map origin: fallback to default if nothing found
        const defaultOrigin = { lat: 39.7392, lon: -104.9903 }; 
        const origin = (!isDataMissing) ? { lat: data[0].lat, lon: data[0].lon } : defaultOrigin;

        // Final JSON response
        res.json({ 
            origin: origin, 
            stations: data || [],
            status: isDataMissing ? "PENDING" : "OK"
        });

    } catch (err) {
        console.error("🔴 Database Route Error:", err);
        res.status(500).json({ error: "Failed to fetch station data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
