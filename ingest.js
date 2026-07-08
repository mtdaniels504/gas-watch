require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const delay = ms => new Promise(res => setTimeout(res, ms));

// I assume you have this helper function already defined in your file
async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
            headers: { 'User-Agent': 'GasWatch-App/1.0' }
        });
        const data = await response.json();
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
    } catch (err) { console.error("Geocoding failed:", err.message); }
    return { lat: null, lon: null };
}

async function geocodePending() {
    const { data: pending } = await supabase
        .from('gas_stations')
        .select('external_id, address')
        .is('lat', null)
        .eq('geocoding_failed', false) // Use your new SQL column
        .limit(50);

    if (!pending || pending.length === 0) return console.log("✅ Nothing to geocode!");

    for (const item of pending) {
        console.log(`📍 Geocoding: ${item.address}`);
        const coords = await geocodeAddress(item.address);
        
        if (coords.lat) {
            await supabase.from('gas_stations')
                .update({ lat: coords.lat, lon: coords.lon })
                .eq('external_id', item.external_id);
        } else {
            // Mark as failed so we don't retry forever
            await supabase.from('gas_stations')
                .update({ geocoding_failed: true })
                .eq('external_id', item.external_id);
        }
        await delay(1100);
    }
}

async function runIngestion(searchQuery) {
    console.log(`📡 Fetching data for: ${searchQuery}...`);
    
    const response = await fetch(`https://api.apify.com/v2/actors/johnvc~fuelprices/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: searchQuery })
    });
    
    const rawApifyItems = await response.json();
    if (!Array.isArray(rawApifyItems)) return console.error("Invalid Apify response");

    const rawData = rawApifyItems.map(s => ({
        external_id: s.id.toString(),
        name: s.name,
        address: `${s.address_line1}, ${s.address_locality}, ${s.address_region} ${s.address_postalCode}`,
        city: s.address_locality.toLowerCase(),
        price: parseFloat(s.price_cash || s.price_credit) || null,
        last_updated: new Date().toISOString(),
        geocoding_failed: false
    }));

    const { error } = await supabase.from('gas_stations').upsert(rawData, { onConflict: 'external_id' });

    if (error) console.error("❌ Upsert Error:", error);
    else console.log(`✅ Ingested ${rawData.length} stations for ${searchQuery}.`);
}

// REMOVED the auto-run call at the bottom.
// Only export the functions for cron.js to use.
module.exports = { runIngestion, geocodePending };