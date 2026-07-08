require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize with the PUBLIC anon key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// The consolidated gas prices endpoint
app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        // Normalize city to lowercase to match your database
        const city = (search || "denver").toLowerCase().trim();

        // 1. Query Supabase
        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .eq('city', city)
            .order('price', { ascending: true }); // Cheapest first for best UX

        if (error) throw error;

        // 2. Safe Defaults: Prevent frontend crashes if no data exists
        const defaultOrigin = { lat: 39.7392, lon: -104.9903 };
        const origin = (data && data.length > 0) 
            ? { lat: data[0].lat, lon: data[0].lon } 
            : defaultOrigin;

        // 3. Return clean JSON
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