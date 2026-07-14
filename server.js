require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        if (!search) return res.status(400).json({ error: "Search parameter is required" });

        // Use the RAW search string to query Supabase (ilike is your best friend here)
        let { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            // This now checks against the full string provided by the user
            .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0 || forceRefresh) {
            console.log(`🔍 No local data for "${search}". Triggering ingestion...`);
            
            await smartIngestion(search); 
            
            const { data: newData, error: newErr } = await supabase
                .from('gas_stations')
                .select('*')
                .or(`city.ilike.%${search}%,address.ilike.%${search}%`)
                .order('price', { ascending: true });

            if (newErr) throw newErr;
            
            if (!newData || newData.length === 0) {
                return res.json({ status: "EMPTY" });
            }
            return res.json({ status: "OK", stations: newData });
        }

        res.json({ status: "OK", stations: data });
    } catch (err) {
        console.error("Backend Error:", err);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
