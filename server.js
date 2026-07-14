require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { smartIngestion, runIngestion } = require('./ingest.js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/gas-prices', async (req, res) => {
    try {
        const { search, forceRefresh } = req.body;
        console.log(`📥 [LOG] Request received: search="${search}", forceRefresh=${forceRefresh}`);

        if (!search) return res.status(400).json({ error: "Missing search" });

        const cleanSearch = search.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();

        // 1. PERFORM THE STATUS CHECK (This replaces your internal stale logic)
        const status = await smartIngestion(cleanSearch); 
        console.log(`🔍 [LOG] Data status for "${cleanSearch}": ${status}`);

        // 2. CASE: MISSING - Auto-scrape immediately
        if (status === 'MISSING') {
            console.log(`📡 [LOG] Data missing. Auto-triggering scrape...`);
            await runIngestion(cleanSearch);
            // Re-fetch after scrape
            const { data } = await supabase.from('gas_stations').select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
                .order('price', { ascending: true });
            return res.json({ status: "OK", stations: data || [] });
        }

        // 3. CASE: STALE - If NOT forcing, tell frontend to prompt user
        if (status === 'STALE' && !forceRefresh) {
            console.log(`⏳ [LOG] Data stale. Prompting user.`);
            const { data } = await supabase.from('gas_stations').select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
                .order('price', { ascending: true });
            // Send status "STALE" so the frontend knows to show your prompt
            return res.json({ status: "STALE", message: "New data available. Refresh?", stations: data });
        }

        // 4. CASE: FRESH (or User chose to force refresh)
        if (forceRefresh) {
            console.log(`⏳ [LOG] User forced refresh.`);
            await runIngestion(cleanSearch);
        }

        const { data, error } = await supabase.from('gas_stations').select('*')
            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
            .order('price', { ascending: true });

        if (error) throw error;

        console.log(`✅ [LOG] Returning ${data.length} records.`);
        res.json({ status: "OK", stations: data });

    } catch (err) {
        console.error("🚨 [LOG] Backend Final Catch Block:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
