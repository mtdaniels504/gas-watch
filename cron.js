// cron.js - THE ORCHESTRATOR
const { runAllCities } = require('./ingest.js');

const tier = process.argv[2] || 'medium'; 

async function runMasterRefresh() {
    console.log(`🕒 Starting Master Refresh for TIER: ${tier}...`);
    
    // We pass a randomly selected "Sort Strategy" to ensure data diversity
    const strategies = ['price_asc', 'distance_asc', 'last_updated_desc'];
    const randomStrategy = strategies[Math.floor(Math.random() * strategies.length)];

    try {
        await runAllCities(tier, randomStrategy);
        console.log(`🚀 Finished ${tier} tier using strategy: ${randomStrategy}`);
    } catch (err) {
        console.error(`❌ Master Refresh failed:`, err.message);
    }
}

runMasterRefresh();
