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
    
    try {
        const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ search: searchQuery, sort: sortStrategy, limit: limit })
        });
        
        // ADDED LOGS
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

        const processedData = rawApifyItems.map(s => ({
            external_id: s.id.toString(),
            name: s.name,
            address: `${s.address_line1}, ${s.address_locality}, ${s.address_region} ${s.address_postalCode}`,
            city: s.address_locality?.toLowerCase() || 'unknown',
            zip: s.address_postalCode,
            price: parseFloat(s.price_cash || s.price_credit) || null,
            last_updated: new Date().toISOString(),
            lat: null,
            lon: null,
            geocoding_failed: false
        }));

        console.log(`💾 Attempting to upsert ${processedData.length} stations to Supabase...`);
        const { error } = await supabase.from('gas_stations').upsert(processedData, { onConflict: 'external_id' });

        if (error) {
            console.error("❌ Supabase Upsert Error:", error);
            throw error;
        }

        console.log(`💾 Upsert successful.`);
        
        // Trigger geocode in background
        geocodePending().catch(e => console.error("Geocode background task failed", e));
        
        return { status: 'SUCCESS', stations: processedData };
    } catch (err) {
        console.error(`❌ Ingestion failed for ${searchQuery}:`, err.message);
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

    // 1. BROAD SEARCH: Check if ANY relevant records exist
    // We use ilike to catch "Denver, CO", "Denver", or partial addresses.
    const { data, error } = await supabase
        .from('gas_stations')
        .select('last_updated')
        .or(`city.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`)
        .order('last_updated', { ascending: false })
        .limit(1);

    const dataMissing = (!data || data.length === 0 || error);

    if (dataMissing) {
        console.log(`📡 No match found for "${searchQuery}". Triggering fresh scrape...`);
        await runIngestion(searchQuery);
        return;
    }

    // 2. STALE CHECK: If data exists, check if it's older than 48 hours
    const lastUpdate = new Date(data[0].last_updated);
    const twoDaysAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));
    
    if (lastUpdate < twoDaysAgo) {
        console.log(`⏳ Data for "${searchQuery}" is stale. Refreshing...`);
        await runIngestion(searchQuery);
    } else {
        console.log(`✅ Data for "${searchQuery}" is fresh. Skipping scrape.`);
    }
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
