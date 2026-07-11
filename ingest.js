require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Geocodio } = require('geocodio-library-node');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const geocoder = new Geocodio(process.env.GEOCODIO_API_KEY);


// TIERED CITY CONFIGURATION
const CITIES = [
    // HIGH PRIORITY (20 Largest - Update every 12h)
    { name: 'New York, NY', tier: 'high' },
    { name: 'Los Angeles, CA', tier: 'high' },
    { name: 'Chicago, IL', tier: 'high' },
    { name: 'Houston, TX', tier: 'high' },
    { name: 'Phoenix, AZ', tier: 'high' },
    { name: 'Philadelphia, PA', tier: 'high' },
    { name: 'San Antonio, TX', tier: 'high' },
    { name: 'San Diego, CA', tier: 'high' },
    { name: 'Dallas, TX', tier: 'high' },
    { name: 'San Jose, CA', tier: 'high' },
    { name: 'Austin, TX', tier: 'high' },
    { name: 'Jacksonville, FL', tier: 'high' },
    { name: 'Fort Worth, TX', tier: 'high' },
    { name: 'Columbus, OH', tier: 'high' },
    { name: 'Indianapolis, IN', tier: 'high' },
    { name: 'Charlotte, NC', tier: 'high' },
    { name: 'San Francisco, CA', tier: 'high' },
    { name: 'Seattle, WA', tier: 'high' },
    { name: 'Denver, CO', tier: 'high' },
    { name: 'Oklahoma City, OK', tier: 'high' },

    // MEDIUM PRIORITY (50 Mid-Size - Update every 24h)
    { name: 'Nashville, TN', tier: 'medium' },
    { name: 'El Paso, TX', tier: 'medium' },
    { name: 'Washington, DC', tier: 'medium' },
    { name: 'Las Vegas, NV', tier: 'medium' },
    { name: 'Boston, MA', tier: 'medium' },
    { name: 'Portland, OR', tier: 'medium' },
    { name: 'Louisville, KY', tier: 'medium' },
    { name: 'Detroit, MI', tier: 'medium' },
    { name: 'Baltimore, MD', tier: 'medium' },
    { name: 'Milwaukee, WI', tier: 'medium' },
    { name: 'Albuquerque, NM', tier: 'medium' },
    { name: 'Tucson, AZ', tier: 'medium' },
    { name: 'Fresno, CA', tier: 'medium' },
    { name: 'Sacramento, CA', tier: 'medium' },
    { name: 'Kansas City, MO', tier: 'medium' },
    { name: 'Mesa, AZ', tier: 'medium' },
    { name: 'Atlanta, GA', tier: 'medium' },
    { name: 'Omaha, NE', tier: 'medium' },
    { name: 'Colorado Springs, CO', tier: 'medium' },
    { name: 'Raleigh, NC', tier: 'medium' },
    { name: 'Virginia Beach, VA', tier: 'medium' },
    { name: 'Long Beach, CA', tier: 'medium' },
    { name: 'Miami, FL', tier: 'medium' },
    { name: 'Oakland, CA', tier: 'medium' },
    { name: 'Minneapolis, MN', tier: 'medium' },
    { name: 'Tulsa, OK', tier: 'medium' },
    { name: 'Bakersfield, CA', tier: 'medium' },
    { name: 'Wichita, KS', tier: 'medium' },
    { name: 'Arlington, TX', tier: 'medium' },
    { name: 'Aurora, CO', tier: 'medium' },
    { name: 'Tampa, FL', tier: 'medium' },
    { name: 'New Orleans, LA', tier: 'medium' },
    { name: 'Cleveland, OH', tier: 'medium' },
    { name: 'Honolulu, HI', tier: 'medium' },
    { name: 'Anaheim, CA', tier: 'medium' },
    { name: 'Lexington, KY', tier: 'medium' },
    { name: 'Stockton, CA', tier: 'medium' },
    { name: 'Henderson, NV', tier: 'medium' },
    { name: 'Riverside, CA', tier: 'medium' },
    { name: 'Newark, NJ', tier: 'medium' },
    { name: 'Saint Paul, MN', tier: 'medium' },
    { name: 'Santa Ana, CA', tier: 'medium' },
    { name: 'Cincinnati, OH', tier: 'medium' },
    { name: 'Irvine, CA', tier: 'medium' },
    { name: 'Orlando, FL', tier: 'medium' },
    { name: 'Pittsburgh, PA', tier: 'medium' },
    { name: 'St. Louis, MO', tier: 'medium' },
    { name: 'Anchorage, AK', tier: 'medium' },
];


/**
 * 1. REFACTORED: Fast Ingestion (No geocoding here)
 */
async function runIngestion(searchQuery) {
    console.log(`📡 Fetching data for ${searchQuery}...`);
    const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: searchQuery })
    });
    
    const rawApifyItems = await response.json();
    if (!Array.isArray(rawApifyItems)) return;

    const processedData = rawApifyItems.map(s => ({
        external_id: s.id.toString(),
        name: s.name,
        address: `${s.address_line1}, ${s.address_locality}, ${s.address_region} ${s.address_postalCode}`,
        city: s.address_locality.toLowerCase(),
        zip: s.address_postalCode,
        price: parseFloat(s.price_cash || s.price_credit) || null,
        last_updated: new Date().toISOString(),
        lat: null, // Set to null; will be filled by geocodePending
        lon: null,
        geocoding_failed: false
    }));

    const { error } = await supabase.from('gas_stations').upsert(processedData, { onConflict: 'external_id' });

    if (error) console.error("❌ Upsert Error:", error);
    else console.log(`✅ Ingested ${processedData.length} stations. Awaiting batch geocode.`);
}

/**
 * 2. REFACTORED: Batch Geocoding (The Sweeper)
 */
async function geocodePending() {
    const { data: pending } = await supabase
        .from('gas_stations')
        .select('external_id, address')
        .is('lat', null)
        .eq('geocoding_failed', false)
        .limit(1000); // Geocodio handles large batches easily

    if (!pending || pending.length === 0) return;

    console.log(`🌍 Batch geocoding ${pending.length} stations...`);

    // Create a key-value map for Geocodio: { "id": "address" }
    const batchRequest = {};
    pending.forEach(item => batchRequest[item.external_id] = item.address);

    try {
        const response = await geocoder.geocode(batchRequest);
        
        const updates = response.results.map(res => {
            const result = res.response.results[0];
            return {
                external_id: res.query_id,
                lat: result?.location.lat || null,
                lon: result?.location.lng || null,
                geocoding_failed: !result
            };
        });

        // Bulk update all results at once
        await supabase.from('gas_stations').upsert(updates);
        console.log(`✅ Batch geocode complete.`);
    } catch (err) {
        console.error("❌ Geocodio Batch Error:", err);
    }
}

async function needsUpdate(city) {
    const { data } = await supabase
        .from('gas_stations')
        .select('last_updated')
        .eq('city', city.split(',')[0].toLowerCase()) // Match the city name
        .order('last_updated', { ascending: false })
        .limit(1);

    if (!data || data.length === 0) return true; // Never scraped: Run it

    const lastUpdate = new Date(data[0].last_updated);
    const twoDaysAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));
    
    return lastUpdate < twoDaysAgo;
}

async function smartIngestion(searchQuery) {
    const isStale = await needsUpdate(searchQuery);
    if (isStale) {
        console.log(`📡 Data for ${searchQuery} is stale or missing. Scraping now...`);
        await runIngestion(searchQuery);
    } else {
        console.log(`✅ Data for ${searchQuery} is fresh. Skipping scrape.`);
    }
}

// --- THE TIERED RUNNER ---
async function runAllCities(tierFilter) {
    const targets = CITIES.filter(c => c.tier === tierFilter);
    for (const city of targets) {
        try {
            console.log(`--- Processing ${city.name} ---`);
            await smartIngestion(city.name);
        } catch (err) {
            console.error(`❌ Failed to process ${city.name}:`, err.message);
            // The loop continues to the next city instead of dying
        }
    }
    console.log(`--- Starting Geocode Cleanup ---`);
    await geocodePending();
}

module.exports = { runIngestion, smartIngestion, geocodePending, runAllCities };
