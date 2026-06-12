const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');
const NodeGeocoder = require('node-geocoder'); // ⚡ Efficient, production-ready lookup engine

const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

// Configure the backend lookup settings using official OpenStreetMap rules
// 🛡️ CRITICAL FIX: Added a unique User-Agent header so OpenStreetMap doesn't block the request!
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    apiKey: null, // OpenStreetMap does not require an API key
    fetch: async (url, options = {}) => {
        // Enforce safe headers natively across Vercel serverless nodes
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
            console.error("❌ Critical: APIFY_TOKEN is missing from environment variables.");
            return res.status(500).json({ error: "Server configuration missing API key." });
        }

        // Build the query parameter for Apify
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
            console.log(`🚀 [Backend Cache Hit] Serving data for: [${cacheKey}]`);
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

        const apifyUrl = `https://apify.com{ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`;

        const apifyResponse = await fetch(apifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inputConfig)
        });

        if (!apifyResponse.ok) {
            throw new Error(`Apify request failed with status code: ${apifyResponse.status}`);
        }
        
        let datasetItems = await apifyResponse.json();

        // Brand Filtering
        if (storeName && Array.isArray(datasetItems)) {
            const cleanTargetBrand = storeName.toLowerCase().trim();
            datasetItems = datasetItems.filter(station => (station.name || '').toLowerCase().includes(cleanTargetBrand));
        }
        
        // 🌍 EFFICIENT BACKEND LOCATION TRANSLATION
        if (Array.isArray(datasetItems)) {
            // Cap at 10 items max to prevent network throttling and keep fetches under 2 seconds
            datasetItems = datasetItems.slice(0, 10); 

            // Map each item to a batch lookup promise
            const geocodePromises = datasetItems.map(async (station) => {
                const fullAddressStr = `${station.address_line1 || ''}, ${station.address_locality || ''}, ${station.address_region || ''} ${station.address_postalCode || ''}`.trim();
                
                if (!fullAddressStr || fullAddressStr === ', ,') return station; // Skip empty profiles gracefully

                try {
                    const geoRes = await geocoder.geocode(fullAddressStr);
                    if (geoRes && geoRes.length > 0) {
                        station.latitude = parseFloat(geoRes[0].latitude);
                        station.longitude = parseFloat(geoRes[0].longitude);
                    } else {
                        // ⚡ SAFE FALLBACK: Fallback to general city center if street numbers fail
                        const cityFallbackStr = `${station.address_locality || city || 'Denver'}, ${station.address_region || state || ''}`;
                        const cityRes = await geocoder.geocode(cityFallbackStr);
                        if (cityRes && cityRes.length > 0) {
                            station.latitude = parseFloat(cityRes[0].latitude);
                            station.longitude = parseFloat(cityRes[0].longitude);
                        }
                    }
                } catch (err) {
                    console.error("⚠️ Failed to map item address on backend:", fullAddressStr, err.message);
                }
                return station;
            });

            // Run all lookups simultaneously across the network
            datasetItems = await Promise.all(geocodePromises);
            
            // Filter out any entries that completely failed to translate anywhere on the globe
            datasetItems = datasetItems.filter(station => station.latitude && station.longitude);
        }
        
        gasCache.set(cacheKey, datasetItems);
        res.json(datasetItems);

    } catch (error) {
        console.error("🔴 Backend error loop tripped:", error.message);
        res.status(500).json({ error: "Failed to fetch fuel prices securely." });
    }
});

module.exports = router;
