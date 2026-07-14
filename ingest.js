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

        const processedData = rawApifyItems.map(s => {
            const rawPrice = s.price_cash ?? s.price_credit ?? null;
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
                lat: null, // Initialized as null; Geocode Sweeper will catch this
                lon: null,
                geocoding_failed: false
            };
        });

        const { data: savedData, error: upsertError } = await supabase
            .from('gas_stations')
            .upsert(processedData, { onConflict: 'external_id' })
            .select(); 

        if (upsertError) throw upsertError;

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
        try {
            await runIngestion(cityObj.name, sortStrategy, stationLimit);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
            console.error(`❌ Failed to process ${cityObj.name}:`, err.message);
        }
    }
}

module.exports = { runIngestion, smartIngestion, runAllCities };
