require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const { runFullSweep } = require('./geocode-sweeper.js');

const Geocodio = require('geocodio-library-node');

const { spawn } = require('child_process');



const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const geocoder = new Geocodio(process.env.GEOCODIO_API_KEY);





// TIERED CITY CONFIGURATION

const CITIES = [

    // HIGH PRIORITY: 10 Largest (Update every 48h - 10 stations each)

    { name: 'New York, NY', tier: 'high' },

    { name: 'Los Angeles, CA', tier: 'high' },

    { name: 'Chicago, IL', tier: 'high' },

    { name: 'Houston, TX', tier: 'high' },

    { name: 'Denver, CO', tier: 'high' },

    { name: 'Phoenix, AZ', tier: 'high' },

    { name: 'Philadelphia, PA', tier: 'high' },

    { name: 'San Diego, CA', tier: 'high' },

    { name: 'Dallas, TX', tier: 'high' },

    { name: 'San Jose, CA', tier: 'high' },



    // MEDIUM PRIORITY: Next 20 Largest (Update every 7 days - 20 stations each)

    { name: 'Austin, TX', tier: 'medium' },

    { name: 'San Antonio, TX', tier: 'medium' },

    { name: 'Jacksonville, FL', tier: 'medium' },

    { name: 'Fort Worth, TX', tier: 'medium' },

    { name: 'Columbus, OH', tier: 'medium' },

    { name: 'Indianapolis, IN', tier: 'medium' },

    { name: 'Charlotte, NC', tier: 'medium' },

    { name: 'San Francisco, CA', tier: 'medium' },

    { name: 'Seattle, WA', tier: 'medium' },

    { name: 'Oklahoma City, OK', tier: 'medium' },

    { name: 'Nashville, TN', tier: 'medium' },

    { name: 'El Paso, TX', tier: 'medium' },

    { name: 'Washington, DC', tier: 'medium' },

    { name: 'Las Vegas, NV', tier: 'medium' },

    { name: 'Boston, MA', tier: 'medium' },

    { name: 'Portland, OR', tier: 'medium' },

    { name: 'Louisville, KY', tier: 'medium' },

    { name: 'Detroit, MI', tier: 'medium' },

    { name: 'Baltimore, MD', tier: 'medium' },

    { name: 'Miami, FL', tier: 'medium' }

];





function triggerGeocodeSweeper() {

    console.log("🚀 Triggering background geocoding sweep...");

    runFullSweep().catch(err => console.error("Sweeper Error:", err));

}



async function runIngestion(searchQuery, sortStrategy = 'price_asc', limit = 20) {

    console.log(`📡 Fetching data for ${searchQuery}...`);

   

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), 25000);



    try {

        const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({ search: searchQuery, sort: sortStrategy, limit: limit }),

            signal: controller.signal

        });

       

        clearTimeout(timeout);

        if (!response.ok) throw new Error(`Apify returned ${response.status}`);



        const rawApifyItems = await response.json();

        if (!Array.isArray(rawApifyItems) || rawApifyItems.length === 0) return { status: 'EMPTY', stations: [] };



        // --- NEW: LOOKUP EXISTING COORDINATES ---

        const externalIds = rawApifyItems.map(s => String(s.id));

        const { data: existingData } = await supabase

            .from('gas_stations')

            .select('external_id, lat, lon')

            .in('external_id', externalIds);



        // Create a Map for O(1) lookup

        const coordMap = new Map(existingData?.map(item => [item.external_id, { lat: item.lat, lon: item.lon }]) || []);



        const processedData = rawApifyItems.map(s => {

            const id = String(s.id);

            const existing = coordMap.get(id);

            const rawPrice = s.price_cash ?? s.price_credit ?? null;

            const line1 = s.address_line1 || '';

            const city = s.address_locality || 'unknown';

            const region = s.address_region || '';

            const zip = s.address_postalCode || '';

            const fullAddress = `${line1}, ${city}, ${region} ${zip}`.replace(/^, |, $/g, '');



            return {

                external_id: id,

                name: s.name || "Unknown Station",

                address: fullAddress,

                city: city.toLowerCase(),

                zip: zip,

                price: rawPrice ? parseFloat(rawPrice) : null,

                last_updated: new Date().toISOString(),

                // If it exists in the DB, use those values; otherwise, default to null

                lat: existing?.lat || null,

                lon: existing?.lon || null,

                geocoding_failed: false

            };

        });



        // --- UPSERT ---

        const { data: savedData, error: upsertError } = await supabase

            .from('gas_stations')

            .upsert(processedData, { onConflict: 'external_id' })

            .select();



        if (upsertError) throw upsertError;



        // Only trigger sweeper if there might be *new* nulls (for truly new stations)

        triggerGeocodeSweeper();



        return { status: 'SUCCESS', stations: savedData };

       

    } catch (err) {

        clearTimeout(timeout);

        console.error(`❌ Ingestion failed for ${searchQuery}:`, err.message);

        return { status: 'ERROR', error: err.message };

    }

}



async function smartIngestion(searchQuery) {

    const { data, error } = await supabase

        .from('gas_stations')

        .select('last_updated')

        .or(`city.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`)

        .order('last_updated', { ascending: false })

        .limit(1);



    if (error || !data || data.length === 0) return 'MISSING';

   

    const lastUpdate = new Date(data[0].last_updated);

    const twoDaysAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));

   

    return lastUpdate < twoDaysAgo ? 'STALE' : 'FRESH';

}



async function runAllCities(tierFilter, sortStrategy) {

    const citiesToProcess = CITIES.filter(c => c.tier === tierFilter);

    const stationLimit = (tierFilter === 'high') ? 10 : 20;

   

    for (const cityObj of citiesToProcess) {

        await runIngestion(cityObj.name, sortStrategy, stationLimit);

        await new Promise(resolve => setTimeout(resolve, 2000));

    }

}



module.exports = { runIngestion, smartIngestion, runAllCities };", server.js: "require('dotenv').config();

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



        // 1. PERFORM THE STATUS CHECK

        const status = await smartIngestion(cleanSearch);

        console.log(`🔍 [LOG] Data status for "${cleanSearch}": ${status}`);



        // 2. CASE: MISSING - Auto-scrape and inform frontend

        if (status === 'MISSING') {

            console.log(`📡 [LOG] Data missing. Auto-triggering scrape...`);

            await runIngestion(cleanSearch);

           

            const { data } = await supabase.from('gas_stations').select('*')

                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)

                .order('price', { ascending: true });

               

            return res.json({

                status: "OK",

                info: "No local data found. Fetching new prices now...",

                stations: data || []

            });

        }



        // 3. CASE: STALE - Prompt the user

        if (status === 'STALE' && !forceRefresh) {

            console.log(`⏳ [LOG] Data stale. Prompting user.`);

            const { data } = await supabase.from('gas_stations').select('*')

                .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)

                .order('price', { ascending: true });

               

            return res.json({

                status: "STALE",

                message: "New data available. Would you like to trigger a price refresh?",

                stations: data

            });

        }



        // 4. CASE: FRESH / FORCED REFRESH

        if (forceRefresh) {

            console.log(`⏳ [LOG] User forced refresh. Running ingestion...`);

            await runIngestion(cleanSearch);

        }



        const { data, error } = await supabase.from('gas_stations').select('*')

            .or(`city.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`)

            .order('price', { ascending: true });



        if (error) throw error;



        console.log(`✅ [LOG] Returning ${data.length} records.`);

        res.json({

            status: "OK",

            info: forceRefresh ? "Prices updated successfully." : null,

            stations: data

        });



    } catch (err) {

        console.error("🚨 [LOG] Backend Final Catch Block:", err);

        res.status(500).json({ error: err.message });

    }

});



const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));", geocode-sweeper.js: "/**

 * GEOCODE SWEEPER

 * Optimized to batch-process null coordinates from Supabase

 * via Geocodio. Use: "node geocode-sweeper.js"

 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const Geocodio = require('geocodio-library-node');



// 1. INITIALIZATION

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const geocoder = new Geocodio(process.env.GEOCODIO_API_KEY);



const BATCH_SIZE = 100;

const DELAY_MS = 2000;



async function runFullSweep(maxBatches = 50) {

    console.log("🚀 Starting Optimized Geocoding Drain...");

    let totalProcessed = 0;



    for (let i = 0; i < maxBatches; i++) {

        // 2. FETCH PENDING

        const { data: pending, error: fetchError } = await supabase

            .from('gas_stations')

            .select('external_id, address')

            .is('lat', null)

            .eq('geocoding_failed', false)

            .limit(BATCH_SIZE);



        if (fetchError) {

            console.error("❌ DB Fetch Error:", fetchError.message);

            break;

        }



        if (!pending || pending.length === 0) {

            console.log("✨ All stations geocoded. Cleanup complete.");

            break;

        }



        console.log(`🌍 Batch ${i + 1}: Geocoding ${pending.length} stations...`);



        // 3. GEOCODE BATCH

        const batchRequest = {};

        pending.forEach(item => batchRequest[item.external_id] = item.address);



        try {

            const response = await geocoder.geocode(batchRequest);

            const updates = Object.keys(response.results).map(id => {

                const res = response.results[id];

                const location = res.response.results[0]?.location;

                return {

                    external_id: id,

                    lat: location?.lat || null,

                    lon: location?.lng || null,

                    geocoding_failed: !location

                };

            });



            // 4. UPSERT UPDATES - Fixed with onConflict to avoid unique constraint errors

            const { error: upsertError } = await supabase

                .from('gas_stations')

                .upsert(updates, { onConflict: 'external_id' });



            if (upsertError) throw upsertError;



            totalProcessed += updates.length;

            console.log(`✅ Success. Total processed in this session: ${totalProcessed}`);



            // 5. THROTTLE

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

        } catch (err) {

            console.error("❌ API/Upsert Error:", err.message);

            break;

        }

    }

    console.log(`🏁 Session Finished. Total records updated: ${totalProcessed}`);

    process.exit(0);

}



// Start the process

runFullSweep().catch(err => {

    console.error("❌ Fatal Error:", err);

    process.exit(1);

});



module.exports = { runFullSweep };
