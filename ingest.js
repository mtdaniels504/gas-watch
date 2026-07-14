require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Geocodio = require('geocodio-library-node');

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


/**
 * 1. REFACTORED: Ingestion + Auto-Geocode with Result Reporting
 */
async function runIngestion(searchQuery, sortStrategy = 'price_asc', limit = 20) {
    console.log(`📡 Fetching data for ${searchQuery}...`);
    
    // NEW: Create an abort controller to kill the request after 25 seconds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); 

    try {
        const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ search: searchQuery, sort: sortStrategy, limit: limit }),
            signal: controller.signal // <--- THIS KILLS THE HANG
        });
        
        clearTimeout(timeout); // Clear the timer if it succeeds
        
        console.log(`📡 Response status from Apify: ${response.status}`);
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Apify returned ${response.status}: ${errText}`);
        }

        const rawApifyItems = await response.json();
        console.log(`✅ Received ${rawApifyItems.length} items from Apify.`);
        
        if (!Array.isArray(rawApifyItems) || rawApifyItems.length === 0) {
            console.log(`⚠️ No stations found for ${searchQuery}.`);
            return { status: 'EMPTY', stations: [] };
        }

        const processedData = rawApifyItems.map(s => {

            // 1. Defensively pick price, prioritizing cash
            const rawPrice = s.price_cash ?? s.price_credit ?? null;

            
            // 2. Safely build address
            const line1 = s.address_line1 || '';
            const city = s.address_locality || 'unknown';
            const region = s.address_region || '';
            const zip = s.address_postalCode || '';
            const fullAddress = `${line1}, ${city}, ${region} ${zip}`.replace(/^, |, $/g, '');


            return {
                external_id: String(s.id),
                name: s.name || "Unknown Station",
                address: fullAddress,
                city: city.toLowerCase(),
                zip: zip,
                price: rawPrice ? parseFloat(rawPrice) : null,
                last_updated: new Date().toISOString(),
                lat: null, // Initialized as null for geocoding
                lon: null,
                geocoding_failed: false
            };
        });

        console.log(`🔍 Preparing to upsert ${processedData.length} records...`);

        // ADDED: .select() to return the records that were saved
        const { data: savedData, error: upsertError } = await supabase
            .from('gas_stations')
            .upsert(processedData, { onConflict: 'external_id' })
            .select(); 

        if (upsertError) {
            console.error("❌ SUPABASE UPSERT ERROR DETAILS:", JSON.stringify(upsertError, null, 2));
            throw upsertError;
        }

        console.log(`✅ Successfully upserted ${savedData.length} records to Supabase.`);
        return { status: 'SUCCESS', stations: savedData };
        
    } catch (err) {
        clearTimeout(timeout); // Ensure timer is cleared on error
        if (err.name === 'AbortError') {
            console.error(`❌ CRITICAL: Fetch timed out for ${searchQuery}.`);
        } else {
            console.error(`❌ Ingestion failed for ${searchQuery}:`, err.message);
        }
        return { status: 'ERROR', error: err.message };
    }
}
/**
 * 2. Batch Geocoding (The Sweeper)
 */
async function geocodePending() {
    const { data: pending } = await supabase
        .from('gas_stations')
        .select('external_id, address')
        .is('lat', null)
        .eq('geocoding_failed', false)
        .limit(100);

    if (!pending || pending.length === 0) return;

    console.log(`🌍 Batch geocoding ${pending.length} stations...`);
    
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

        // ADDED: { onConflict: 'external_id' } to prevent the crash
        const { error } = await supabase
            .from('gas_stations')
            .upsert(updates, { onConflict: 'external_id' }); 
            
        if (error) throw error;
        
        console.log(`✅ Batch geocode complete for ${updates.length} stations.`);
    } catch (err) {
        console.error("❌ Geocodio Batch Error:", err.message);
    }
}

async function needsUpdate(searchQuery) {
    // Use the same fuzzy matching logic as smartIngestion
    const { data, error } = await supabase
        .from('gas_stations')
        .select('last_updated')
        .or(`city.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`)
        .order('last_updated', { ascending: false })
        .limit(1);

    if (!data || data.length === 0 || error) return true;

    const lastUpdate = new Date(data[0].last_updated);
    const twoDaysAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));
    return lastUpdate < twoDaysAgo;
}

async function smartIngestion(searchQuery) {
    console.log(`🔍 Checking database for: "${searchQuery}"`);

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
    // Define the limit based on the tier
    const stationLimit = (tierFilter === 'high') ? 10 : 20;
    
    console.log(`🚀 Starting batch for ${citiesToProcess.length} cities (Tier: ${tierFilter}, Limit: ${stationLimit})...`);

    for (const cityObj of citiesToProcess) {
        try {
            await runIngestion(cityObj.name, sortStrategy, stationLimit);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
            console.error(`❌ Failed to process ${cityObj.name}:`, err.message);
        }
    }
}

module.exports = { runIngestion, smartIngestion, geocodePending, runAllCities };
