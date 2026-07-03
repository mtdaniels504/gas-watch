/* ==========================================================================
   MODULE IMPORT DIRECTORY & CACHE MANAGEMENT
   ========================================================================== */
const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');

// 💾 Cache spatial responses for 15 minutes (900s)
const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

/* ==========================================================================
   SPATIAL CALCULATIONS UTILITY (HAVERSINE GEOMETRY ENGINE)
   ========================================================================== */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    
    const R = 3958.8; // Earth Radius in Miles
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
        const { search, radius, storeName, address, city, state, zip } = req.body || {};
        
        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("🚨 Critical Error: APIFY_TOKEN is missing from the environment vault.");
            return res.status(500).json({ error: "Server configuration missing active data key." });
        }

        // Build a consistent location query
        let finalSearchParameter = zip || [address, city, state].filter(p => p).join(", ") || search || "Denver";
        finalSearchParameter = finalSearchParameter.trim();
        
        const targetRadius = parseInt(radius, 10) && !isNaN(parseInt(radius, 10)) ? parseInt(radius, 10) : 15;

        // Location-centric caching key layout to optimize hit ratios
        const locationCacheKey = `loc-${finalSearchParameter.replace(/\s+/g, '-').toLowerCase()}`;

        let stationsDataset = gasCache.get(locationCacheKey);

        if (!stationsDataset) {
            console.log(`📡 [Cache Miss] Running wide-net data sweep on Apify Actor for: "${finalSearchParameter}"`);
            
            /* ==========================================================================
               PHASE 1: GEOLOCATION ORIGIN ANCHORING (FIXED RUNTIME EVALUATION)
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
                console.warn("⚠️ Geocoding failed on search origin text query.", geoErr.message);
            }

            /* ==========================================================================
               PHASE 2: LIVE WIDE-NET DATA SCRAPE WITH MAX ITEMS EXPANSION
               ========================================================================== */
            const inputConfig = {
                "search": finalSearchParameter, 
                "fuel": 1,
                "maxAge": 0,
                "lang": "en",
                "radius": 25,
                "maxResults": 100, // ⚡ ADDED: Explicit result target limits 
                "limit": 100       // ⚡ ADDED: Secondary catch-all limit parameters
            };

            const apifyUrl = `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=30`;
            let rawDatasetItems = [];

            try {
                const apifyResponse = await fetch(apifyUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(inputConfig)
                });

                if (!apifyResponse.ok) {
                    console.error(`🚨 Apify responded with status: ${apifyResponse.status}`);
                    return res.status(502).json({ error: "Live gas price repository provider is temporarily unavailable." });
                }
                rawDatasetItems = await apifyResponse.json();
            } catch (fetchErr) {
                console.error("🚨 Apify Fetch Execution Error:", fetchErr.message);
                return res.status(502).json({ error: "Failed to establish synchronization with data source stream." });
            }

            /* ==========================================================================
               PHASE 3: TRANSLATION & SPATIAL INJECTION MATRIX (COORDINATE PARSER FIXED)
               ========================================================================== */
            if (Array.isArray(rawDatasetItems)) {
                stationsDataset = rawDatasetItems.map((station, index) => {
                    // 🛡️ ACCURATE DATA PARSING MAP: Capture data locations from the nested structures
                    const sLat = parseFloat(station.latitude || station.lat || station.location?.lat || station.coords?.lat || (centerLat ? centerLat + (index * 0.0015) : null));
                    const sLon = parseFloat(station.longitude || station.lng || station.lon || station.location?.lng || station.coords?.lng || (centerLon ? centerLon + (index * 0.0015) : null));

                    const cash = parseFloat(station.cashPrice || station.price_cash || station.price || 0);
                    const credit = parseFloat(station.creditPrice || station.price_credit || 0);
                    const resolvedPrice = cash > 0 ? cash : (credit > 0 ? credit : 0);

                    const computedDistance = (centerLat && centerLon && sLat && sLon) 
                        ? calculateHaversineDistance(centerLat, centerLon, sLat, sLon)
                        : 0;

                    return {
                        name: station.name || "Gas Station",
                        address: station.address || station.address_line1 || "Unknown Address",
                        city: station.city || station.address_locality || "",
                        zip: station.zip || station.address_postal_code || "",
                        price: resolvedPrice,
                        displayPrice: resolvedPrice > 0 ? `$${resolvedPrice.toFixed(2)}` : "N/A",
                        postedTime: station.cashPosted || station.creditPosted || station.postedTime || null,
                        lat: sLat,
                        lon: sLon,
                        distance: computedDistance
                    };
                });
                
                // Commit complete location array down to raw cache
                gasCache.set(locationCacheKey, stationsDataset);
            } else {
                stationsDataset = [];
            }
        } else {
            console.log(`🎯 [Cache Hit] Serving high-performance data array for location key: ${locationCacheKey}`);
        }

        /* ==========================================================================
           PHASE 4: LIVE DYNAMIC MEMORY SLICING (RADIUS & BRAND)
           ========================================================================== */
        let filteredResponse = stationsDataset.filter(station => station.distance <= targetRadius);

        if (storeName) {
            const cleanTargetBrand = storeName.toLowerCase().trim();
            filteredResponse = filteredResponse.filter(station => station.name.toLowerCase().includes(cleanTargetBrand));
        }

        // Sort ascending by lowest price
        filteredResponse.sort((a, b) => {
            if (a.price === 0) return 1;
            if (b.price === 0) return -1;
            return a.price - b.price;
        });

        console.log(`⚡ Output Complete: Returning ${filteredResponse.length} matching localized stations.`);
        res.json(filteredResponse);

    } catch (error) {
        console.error("🔴 Unhandled route runtime error exception thrown:", error.stack || error.message);
        res.status(500).json({ error: "Failed to complete processing operations on live fuel data structures." });
    }
});

module.exports = router;
