require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize with the PUBLIC anon key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 1. Static file serving (This serves index.html at root automatically)
app.use(express.static(path.join(__dirname, 'public')));

// 2. API Routes
app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .eq('city', normalizedCity)
            .order('price', { ascending: true });

        if (error) throw error;

        const isDataMissing = !data || data.length === 0;
        const defaultOrigin = { lat: 39.7392, lon: -104.9903 }; 
        const origin = (!isDataMissing) ? { lat: data[0].lat, lon: data[0].lon } : defaultOrigin;

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

// REMOVED: The problematic app.get('*', ...) route. 
// Express now handles the index.html routing via the static middleware above.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
