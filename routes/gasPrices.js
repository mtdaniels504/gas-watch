const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');
const NodeGeocoder = require('node-geocoder');

const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

// Configure the backend lookup settings using official OpenStreetMap rules
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    apiKey: null,
    fetch: async (url, options = {}) => {
        options.headers = {
            ...options.headers,
            'User-Agent': 'GasWatchAppVercelBackend/2.0 (contact: mtdaniels504@gas-watch.com)'
        };
        return fetch(url, options);
    }
});

router.post('/', async (req, res) => {
    try {
        const { search, lat, lon, radius, storeName, address, city, state, zip } = req.body;
        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("Critical: APIFY_TOKEN is missing from environment vault.");
            return res.status(500).json({ error: "Server configuration missing API key." });
        }

        let finalSearchParameter = "";
        let cacheKeyParts = [];

        if (zip) {
            finalSearchParameter = zip;
            cacheKeyParts.push(`zip-${zip}`);
        } else {
            const locationParts = [address, city, state].filter(p => p);
            const explicitLocation = locationParts.join(", ");

            if (!explicitLocation && !search && storeName) {
                return res.status(400).json({ 
                    error: "Please provide a City, State, or ZIP code alongside your brand filter." 
                });
            }

            finalSearchParameter = explicitLocation || search || "Denver";
            cacheKeyParts.push(`text-${finalSearchParameter.replace(/\s+/g, '-').toLowerCase()}`);
        }

        if (storeName) cacheKeyParts.push(`brand-${storeName.replace(/\s+/g, '-').toLowerCase()}`);
        const searchRadius = parseInt(radius) && !isNaN(parseInt(radius)) ? parseInt(radius) : 15;
        cacheKeyParts.push(`rad-${searchRadius}`);

        const cacheKey = cacheKeyParts.join('_');

        // Cache Check
        const cachedData = gasCache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        console.log(`📡 [Backend Cache Miss] Querying Apify for: ${finalSearchParameter}`);

        // Fetch from Apify
        const inputConfig = {
            "search": finalSearchParameter, 
            "fuel": 1,
            "maxAge": 0,
            "lang": "en",
            "radius": searchRadius
        };

        const apifyUrl = `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`;

        let datasetItems = [];

        // 🛡️ CRITICAL ENDPOINT SHIELD: Wrap the Apify network block to completely protect Node from crashing
        try {
            const apifyResponse = await fetch(apifyUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inputConfig)
            });

            if (!apifyResponse.ok) {
                console.error(`⚠️ Apify server returned an error status: ${apifyResponse.status}`);
                return res.status(502).json({ error: "Gas price provider is currently unavailable." });
            }
            
            datasetItems = await apifyResponse.json();
        } catch (fetchErr) {
            console.error("🔴 Network call failed: Apify endpoint unreachable.", fetchErr.message);
            return res.status(502).json({ error: "Failed to connect to the gas price engine repository." });
        }

        // Brand Filtering
        if (storeName && Array.isArray(datasetItems)) {
            const cleanTargetBrand = storeName.toLowerCase().trim();
            datasetItems = datasetItems.filter(station => (station.name || '').toLowerCase().includes(cleanTargetBrand));
        }
        
        // 🌍 CRASH-PROOF BACKEND LOCATION TRANSLATION
        if (Array.isArray(datasetItems) && datasetItems.length > 0) {
            datasetItems = datasetItems.slice(0, 10); // Cap at 10 items max

            const geocodePromises = datasetItems.map(async (station) => {
                const fullAddressStr = `${station.address_line1 || ''}, ${station.address_locality || ''}, ${station.address_region || ''} ${station.address_postalCode || ''}`.trim();
                
                if (!fullAddressStr || fullAddressStr === ', ,') return station;

                try {
                    const geoRes = await geocoder.geocode(fullAddressStr);
                    
                    // ✨ FIXED: Check explicitly if latitude numbers exist to block type crashes
                    if (geoRes && geoRes.length > 0 && geoRes[0].latitude !== undefined) {
                        station.latitude = parseFloat(geoRes[0].latitude);
                        station.longitude = parseFloat(geoRes[0].longitude);
                    } else {
                        // Safe Fallback to city center if specific street numbers fail
                        const cityFallbackStr = `${station.address_locality || city || 'Denver'}, ${station.address_region || state || ''}`;
                        const cityRes = await geocoder.geocode(cityFallbackStr);
                        
                        if (cityRes && cityRes.length > 0 && cityRes[0].latitude !== undefined) {
                            station.latitude = parseFloat(cityRes[0].latitude);
                            station.longitude = parseFloat(cityRes[0].longitude);
                        }
                    }
                } catch (err) {
                    console.error("Failed to map item address smoothly:", fullAddressStr, err.message);
                }
                return station;
            });

            datasetItems = await Promise.all(geocodePromises);
            
            // Filter out any entries that completely failed to translate anywhere on the globe
            datasetItems = datasetItems.filter(station => station.latitude && station.longitude);
        }
        
        // Only set cache footprint if valid geocoded objects exist
        if (Array.isArray(datasetItems) && datasetItems.length > 0) {
            gasCache.set(cacheKey, datasetItems);
        }
        
        res.json(datasetItems);

    } catch (error) {
        console.error("🔴 Backend error loop tripped:", error.message);
        res.status(500).json({ error: "Failed to fetch fuel prices securely." });
    }
});

module.exports = router;
