require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize with the PUBLIC anon key for the server
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        const normalizedCity = search.split(',')[0].trim().toLowerCase();

        // 1. READ ONLY: Just query the database
        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .eq('city', normalizedCity)
            .order('price', { ascending: true });

        if (error) throw error;

        // 2. CHECK IF DATA IS MISSING
        const isDataMissing = !data || data.length === 0;

        // 3. Safe Defaults
        const defaultOrigin = { lat: 39.7392, lon: -104.9903 }; 
        const origin = (!isDataMissing) 
            ? { lat: data[0].lat, lon: data[0].lon } 
            : defaultOrigin;

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

// Fallback for all other routes to serve index.html
app.get('/:url(.*)', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
