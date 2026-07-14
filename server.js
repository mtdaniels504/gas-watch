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
        console.log(`📥 [LOG] Request received: search="${search}", forceRefresh=${forceRefresh}`);

        if (!search) {
            console.warn("⚠️ [LOG] Missing search parameter");
            return res.status(400).json({ error: "Missing search" });
        }

        // 1. CLEAN THE SEARCH IMMEDIATELY: Prevents PGRST100 errors
        const cleanSearch = search.replace(/[^a-zA-Z0-9\s]/g, '');
        console.log(`🧹 [LOG] Cleaned search term to: "${cleanSearch}"`);

        // 2. Database Check using the cleaned search term
        let { data, error } = await supabase
            .from('gas_stations')
            .select('*')
            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
            .order('price', { ascending: true });

        if (error) {
            console.error("❌ [LOG] Supabase query error:", error);
            throw error;
        }

        // 3. Logic Check
        const isDataEmpty = !data || data.length === 0;
        console.log(`🔍 [LOG] Database returned ${data ? data.length : 0} records.`);

        if (isDataEmpty || forceRefresh) {
            console.log(`📡 [LOG] Triggering smartIngestion for: "${cleanSearch}"`);
            
            try {
                // Pass the cleaned search to ingestion
                await smartIngestion(cleanSearch);
                console.log(`✅ [LOG] smartIngestion completed for: "${cleanSearch}"`);
            } catch (ingestErr) {
                console.error(`🚨 [LOG] CRITICAL: smartIngestion failed for "${cleanSearch}":`, ingestErr);
                return res.status(500).json({ error: "Ingestion failed" });
            }
            
            // Re-fetch data to return the fresh results
            let { data: newData, error: newErr } = await supabase
                .from('gas_stations')
                .select('*')
                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)
                .order('price', { ascending: true });

            if (newErr) {
                console.error("❌ [LOG] Supabase re-query error:", newErr);
                return res.status(500).json({ error: "Data retrieval failed" });
            }
            
            console.log(`📊 [LOG] Post-ingestion fetch returned ${newData ? newData.length : 0} records.`);
            return res.json({ status: "OK", stations: newData || [] });
        }

        console.log(`✅ [LOG] Returning existing data from database.`);
        res.json({ status: "OK", stations: data });

    } catch (err) {
        console.error("🚨 [LOG] Backend Final Catch Block:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
