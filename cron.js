// 1. Import the new Tiered Runner
const { runAllCities } = require('./ingest.js');

// 2. Determine which tier this instance should run
// You can pass the tier as a process argument: node cron.js high
const tier = process.argv[2] || 'medium'; 

async function runMasterRefresh() {
    console.log(`🕒 Starting Master Refresh for TIER: ${tier}...`);
    
    try {
        await runAllCities(tier);
        console.log(`🚀 Finished processing all cities in tier: ${tier}`);
    } catch (err) {
        console.error(`❌ Master Refresh failed:`, err.message);
    }
}

runMasterRefresh();
