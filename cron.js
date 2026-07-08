// 1. Import the functions from your ingest engine
const { runIngestion, geocodePending } = require('./ingest.js');

const cities = ["Denver, CO", "Los Angeles, CA", "New York, NY"];

async function runMasterRefresh() {
    console.log(`🕒 Starting Master Refresh for ${cities.length} cities...`);
    
    for (const city of cities) {
        try {
            console.log(`--- Processing ${city} ---`);
            // 2. Fetch/Upsert prices for the city
            await runIngestion(city);
            
            // 3. Clean up/Geocode any new stations found during this ingest
            await geocodePending();
            
        } catch (err) {
            console.error(`❌ Failed to refresh ${city}:`, err.message);
        }
    }
    console.log("🚀 All scheduled cities processing finished.");
}

runMasterRefresh();