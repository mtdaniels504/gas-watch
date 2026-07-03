/* ==========================================================================
   MODULE IMPORT DIRECTORY & CACHE MANAGEMENT
   ========================================================================== */
const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');

// 💾 Cache spatial responses for 15 minutes (900s)
const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

// Map incoming frontend fuel grades to the structural integer definitions expected by the Apify scraper
const FUEL_GRADE_MAP = {
    'regular': 1,
    'midgrade': 2,
    'premium': 3,
    'diesel': 4
};

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
        // ⚡ FIXED: Added fallback extraction matching 'brandName', 'zipCode', and 'fuelGradeSelection' from client payloads
        const { 
            search, 
            radius, 
            storeName, brandName, 
            address, 
            city, 
            state, 
            zip, zipCode,
            fuelGradeSelection 
        } = req.body || {};
        
        const targetStore = (storeName || brandName || "").trim();
        const targetZip = (zip || zipCode || "").trim();
        const targetFuelGrade = fuelGradeSelection || "regular";

        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("🚨 Critical Error: APIFY_TOKEN is missing from the environment vault.");
            return res.status(500).json({ error: "Server configuration missing active data key." });
        }

        // Build a consistent location query
        let finalSearchParameter = targetZip || [address, city, state].filter(p => p).join(", ") || search || "Denver";
        finalSearchParameter = finalSearchParameter.trim();
        
        const targetRadius = parseInt(radius, 10) && !isNaN(parseInt(radius, 10)) ? parseInt(radius, 10) : 15;

        // Include the fuel type selection inside the cache signature to prevent cross-grade display leakage
        const locationCacheKey = `loc-${finalSearchParameter.replace(/\s+/g, '-').toLowerCase()}-${targetFuelGrade}`;

        let stationsDataset = gasCache.get(locationCacheKey);

        if (!stationsDataset) {
            console.log(`📡 [Cache Miss] Running sweep on Apify Actor for: "${finalSearchParameter}" [Grade: ${targetFuelGrade}]`);
            
            /* ==========================================================================
               PHASE 1: GEOLOCATION ORIGIN ANCHORING
               ========================================================================== */
            let centerLat = 39.7392; 
            let centerLon = -104.9903;
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
               PHASE 2: LIVE ORIGINAL WORKING SCRAPE
               ========================================================================== */
            // ⚡ FIXED: Map string fuel preferences directly to the target configuration parameters
            const apifyFuelId = FUEL_GRADE_MAP[targetFuelGrade.toLowerCase()] || 1;

            const inputConfig = {
                "search": finalSearchParameter, 
                "fuel": apifyFuelId,
                "maxAge": 0,
                "lang": "en",
                "radius": 25 
            };

            const apifyUrl = `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=15`;
            let rawDatasetItems = [];

            try {
                const apifyResponse = await fetch(apifyUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(inputConfig)
                });

                if (!apifyResponse.ok) {
                    console.error(`🚨 Apify responded with status: ${apifyResponse.status}`);
                    return res.status(502).json({ error: "Live gas price data provider unavailable." });
                }
                rawDatasetItems = await apifyResponse.json();
            } catch (fetchErr) {
                console.error("🚨 Apify Fetch Execution Error:", fetchErr.message);
                return res.status(502).json({ error: "Failed to establish synchronization with data source stream." });
            }

            /* ==========================================================================
               PHASE 3: TRANSLATION & GEOMETRIC DISTRIBUTION MATRIX
               ========================================================================== */
            if (Array.isArray(rawDatasetItems)) {
                stationsDataset = rawDatasetItems.map((station, index) => {
                    
                    const computedDistance = station.distance ? parseFloat(station.distance) : 0;
                    
                    // Convert distances into coordinate displacements distributed evenly around a circle
                    const angle = (index * (360 / Math.max(rawDatasetItems.length, 1))) * (Math.PI / 180);
                    const latOffset = (computedDistance / 69.0) * Math.sin(angle); 
                    const lonOffset = (computedDistance / (69.0 * Math.cos(centerLat * Math.PI / 180))) * Math.cos(angle);

                    const sLat = centerLat + latOffset;
                    const sLon = centerLon + lonOffset;

                    const cash = parseFloat(station.cashPrice || station.price_cash || 0);
                    const credit = parseFloat(station.creditPrice || station.price_credit || 0);
                    const resolvedPrice = cash > 0 ? cash : (credit > 0 ? credit : 0);

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
        }

        /* ==========================================================================
           PHASE 4: LIVE FILTER SLICING
           ========================================================================== */
        let filteredResponse = stationsDataset.filter(station => station.distance <= targetRadius);

        // ⚡ FIXED: Uses structural safe fallbacks for normalized brand string searches
        if (targetStore) {
            const cleanTargetBrand = targetStore.toLowerCase();
            filteredResponse = filteredResponse.filter(station => station.name.toLowerCase().includes(cleanTargetBrand));
        }

        // Sort ascending by lowest price
        filteredResponse.sort((a, b) => {
            if (a.price === 0) return 1;
            if (b.price === 0) return -1;
            return a.price - b.price;
        });

        console.log(`⚡ Output Complete: Returning ${filteredResponse.length} matching localized stations for grade [${targetFuelGrade}].`);
        res.json(filteredResponse);

    } catch (error) {
        console.error("🔴 Unhandled route runtime error exception thrown:", error.stack || error.message);
        res.status(500).json({ error: "Failed to complete processing operations." });
    }
});

module.exports = router;
