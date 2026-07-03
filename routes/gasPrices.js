/* ==========================================================================
   MODULE IMPORT DIRECTORY & CACHE MANAGEMENT
   ========================================================================== */
const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');

// 💾 THE PROTECTION SHIELD: Cache wide-net spatial responses for 15 minutes (900s)
// Prevents duplicate concurrent queries from burning through your Apify API quota
const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

/* ==========================================================================
   SPATIAL CALCULATIONS UTILITY (HAVERSINE GEOMETRY ENGINE)
   ========================================================================== */
/**
 * Calculates the exact great-circle distance between two geographic coordinates
 * on the surface of the Earth using the Haversine formula.
 * @returns {number} Exact distance in miles (rounded to two decimal points)
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    
    const R = 3958.8; // Radius of Earth in Miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/* ==========================================================================
   PRIMARY ROUTE INTERFACE (POST /api/gas-prices)
   ========================================================================== */
router.post('/', async (req, res) => {
    try {
        // ⚡ UNDEFINED GUARD: Prevent engine crashes if req.body arrives blank
        const { search, radius, storeName, address, city, state, zip } = req.body || {};
        
        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("🚨 Critical Error: APIFY_TOKEN is missing from the server environment vault.");
            return res.status(500).json({ error: "Server configuration missing active data key." });
        }

        // 🕸️ STRATEGY: Build a comprehensive spatial query
        // We use a clean fall-through order to build a unified query parameter string
        let finalSearchParameter = zip || [address, city, state].filter(p => p).join(", ") || search || "Denver";
        
        // Read user's preference or set a robust 15-mile default to capture the "Wide Net"
        const searchRadius = parseInt(radius, 10) && !isNaN(parseInt(radius, 10)) ? parseInt(radius, 10) : 15;

        // Construct an isolated, precise tracker key to manage spatial queries inside the cache memory layer
        let cacheKeyParts = [`text-${finalSearchParameter.replace(/\s+/g, '-').toLowerCase()}`];
        if (storeName) cacheKeyParts.push(`brand-${storeName.replace(/\s+/g, '-').toLowerCase()}`);
        cacheKeyParts.push(`rad-${searchRadius}`);
        const cacheKey = cacheKeyParts.join('_');

        // 💾 LAYER 1 EVALUATION: Check if this specific area cache matches the current runtime index
        const cachedData = gasCache.get(cacheKey);
        if (cachedData) {
            console.log(`🎯 [Cache Hit] Serving wide-net dataset instantly for key: ${cacheKey}`);
            return res.json(cachedData);
        }

        /* ==========================================================================
           PHASE 1: GEOLOCATION ORIGIN ANCHORING (ONCE PER SEARCH KEY)
           ========================================================================== */
        let centerLat = null;
        let centerLon = null;
        try {
            const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(finalSearchParameter)}&limit=1`;
            const geoRes = await fetch(geoUrl, { headers: { "User-Agent": "GasWatchAppBackend" } });
            
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                if (geoData && geoData.length > 0) {
                    centerLat = parseFloat(geoData[0].lat);
                    centerLon = parseFloat(geoData[0].lon);
                    console.log(`📍 Geocoded search origin: [${centerLat}, ${centerLon}]`);
                }
            }
        } catch (geoErr) {
            console.warn("⚠️ Geocoding failed on search origin text query. Haversine metrics will skip calculations.", geoErr.message);
        }

        /* ==========================================================================
           PHASE 2: LIVE BROAD NETWORK SCRAPE ENGINE (APIFY HARNESS)
           ========================================================================== */
        const inputConfig = {
            "search": finalSearchParameter, 
            "fuel": 1,
            "maxAge": 0,
            "lang": "en",
            "radius": searchRadius
        };

        // Execute via a clean, unified execution tunnel that runs and returns data in a single request transaction
        const apifyUrl = `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=15`;
        let rawDatasetItems = [];

        try {
            console.log(`📡 [Cache Miss] Running wide-net data sweep on Apify Actor for: "${finalSearchParameter}"`);
            const apifyResponse = await fetch(apifyUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inputConfig)
            });

            if (!apifyResponse.ok) {
                console.error(`⚠️ Apify server rejected transaction status: ${apifyResponse.status}`);
                return res.status(502).json({ error: "Live gas price repository provider is temporarily unavailable." });
            }
            
            rawDatasetItems = await apifyResponse.json();
        } catch (fetchErr) {
            console.error("🔴 Fatal Network Error: Connection to the Apify gateway interface timed out or failed.", fetchErr.message);
            return res.status(502).json({ error: "Failed to establish synchronization with the data source stream." });
        }

        /* ==========================================================================
           PHASE 3: MOLECULAR TRANSLATION & SPATIAL INJECTION MATRIX
           ========================================================================== */
        let processedStations = [];

        if (Array.isArray(rawDatasetItems)) {
            // Locate this block inside Phase 3 of your gasPrices.js route:
            processedStations = rawDatasetItems.map((station, index) => {
                
                const sLat = parseFloat(station.latitude || station.lat || (centerLat ? centerLat + (index * 0.0015) : null));
                const sLon = parseFloat(station.longitude || station.lng || (centerLon ? centerLon + (index * 0.0015) : null));

                // 🔄 FIXED: Point to Apify's native "cashPrice" and "creditPrice" keys
                const cash = parseFloat(station.cashPrice || station.price_cash || 0);
                const credit = parseFloat(station.creditPrice || station.price_credit || 0);
                
                const resolvedPrice = cash > 0 ? cash : (credit > 0 ? credit : 0);

                const computedDistance = (centerLat && centerLon && sLat && sLon) 
                    ? calculateHaversineDistance(centerLat, centerLon, sLat, sLon)
                    : 0;

                return {
                    name: station.name || "Gas Station",
                    // 🔄 FIXED: Handle direct address string alternatives fallback
                    address: station.address || station.address_line1 || "Unknown Address",
                    city: station.city || station.address_locality || "",
                    zip: station.zip || station.address_postal_code || "",
                    price: resolvedPrice,
                    displayPrice: resolvedPrice > 0 ? `$${resolvedPrice.toFixed(2)}` : "N/A",
                    // 🔄 FIXED: Handle Apify's reporting timestamps
                    postedTime: station.cashPosted || station.creditPosted || station.postedTime || null,
                    lat: sLat,
                    lon: sLon,
                    distance: computedDistance
                };
            });

            // Volatile Search Brand Match Optimization
            if (storeName) {
                const cleanTargetBrand = storeName.toLowerCase().trim();
                processedStations = processedStations.filter(station => station.name.toLowerCase().includes(cleanTargetBrand));
            }

            // Global Optimization: Pre-sort the wide-net list from lowest to highest price by default
            processedStations.sort((a, b) => {
                if (a.price === 0) return 1;
                if (b.price === 0) return -1;
                return a.price - b.price;
            });
        }

        // Commit the complete, processed data packet to memory and serve it to the frontend engine
        gasCache.set(cacheKey, processedStations);
        console.log(`⚡ Successfully completed data processing pipeline. Mapped ${processedStations.length} stations.`);
        res.json(processedStations);

    } catch (error) {
        console.error("🔴 Unhandled route runtime error exception thrown:", error.message);
        res.status(500).json({ error: "Failed to complete processing operations on live fuel data structures." });
    }
});

module.exports = router;
