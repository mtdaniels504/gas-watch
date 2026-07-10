require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const delay = ms => new Promise(res => setTimeout(res, ms));

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

async function geocodeAddress(address) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'GasWatch-App/1.0' }
        });
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
    } catch (err) { 
        console.error("❌ Geocoding fetch error:", err.message); 
    }
    return { lat: null, lon: null };
}

async function geocodePending() {
    const { data: pending } = await supabase
        .from('gas_stations')
        .select('external_id, address')
        .is('lat', null)
        .eq('geocoding_failed', false)
        .limit(50);

    if (!pending || pending.length === 0) return;

    for (const item of pending) {
        const coords = await geocodeAddress(item.address);
        
        if (coords.lat) {
            await supabase.from('gas_stations')
                .update({ lat: coords.lat, lon: coords.lon })
                .eq('external_id', item.external_id);
        } else {
            await supabase.from('gas_stations')
                .update({ geocoding_failed: true })
                .eq('external_id', item.external_id);
        }
        await delay(1100);
    }
}

async function runIngestion(searchQuery) {
    console.log(`📡 Fetching data for ${searchQuery}...`);
    const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: searchQuery })
    });
    
    const rawApifyItems = await response.json();
    if (!Array.isArray(rawApifyItems)) return;

    // Process stations one-by-one to geocode them before insertion
    const processedData = [];
    for (const s of rawApifyItems) {
        const address = `${s.address_line1}, ${s.address_locality}, ${s.address_region} ${s.address_postalCode}`;
        
        // 1. Geocode
        const coords = await geocodeAddress(address);
        
        // 2. Add to batch
        processedData.push({
            external_id: s.id.toString(),
            name: s.name,
            address: address,
            city: s.address_locality.toLowerCase(),
            zip: s.address_postalCode,
            price: parseFloat(s.price_cash || s.price_credit) || null,
            last_updated: new Date().toISOString(),
            lat: coords.lat,
            lon: coords.lon,
            geocoding_failed: coords.lat === null
        });

        // 3. Respect Rate Limits (Crucial for Nominatim)
        await delay(1100); 
    }

    const { error } = await supabase.from('gas_stations').upsert(processedData, { onConflict: 'external_id' });

    if (error) console.error("❌ Upsert Error:", error);
    else console.log(`✅ Ingested ${processedData.length} stations with coordinates.`);
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
