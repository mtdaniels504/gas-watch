/**
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
