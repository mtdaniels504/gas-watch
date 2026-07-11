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

        const { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${normalizedCity}%,address.ilike.%${normalizedCity}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        // If no data, trigger background sync
        if (!data || data.length === 0) {
            console.warn(`⚠️ No data for: ${normalizedCity}. Triggering background sync...`);
            
            // Background process handles both scraping and geocoding
            smartIngestion(search).catch(err => console.error("Background sync error:", err));
            
            return res.json({ 
                status: "PENDING", 
                message: "Fetching fresh prices for this area. Please wait..." 
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
