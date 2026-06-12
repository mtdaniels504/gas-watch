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
        
        // 🌍 CRASH-PROOF BACKEND LOCATION TRANSLATION
        if (Array.isArray(datasetItems)) {
            datasetItems = datasetItems.slice(0, 10); // Cap at 10 items max

            const geocodePromises = datasetItems.map(async (station) => {
                const fullAddressStr = `${station.address_line1 || ''}, ${station.address_locality || ''}, ${station.address_region || ''} ${station.address_postalCode || ''}`.trim();
                
                if (!fullAddressStr || fullAddressStr === ', ,') return station;

                try {
                    const geoRes = await geocoder.geocode(fullAddressStr);
                    // ✨ FIXED: Added array wrapper index [0] checking to prevent undefined variable failures
                    if (geoRes && geoRes.length > 0 && geoRes[0].latitude) {
                        station.latitude = parseFloat(geoRes[0].latitude);
                        station.longitude = parseFloat(geoRes[0].longitude);
                    } else {
                        // ✨ FIXED: Added optional chaining (?.) so a failing fallback lookup never crashes your server
                        const cityFallbackStr = `${station.address_locality || city || 'Denver'}, ${station.address_region || state || ''}`;
                        const cityRes = await geocoder.geocode(cityFallbackStr);
                        if (cityRes && cityRes.length > 0 && cityRes[0].latitude) {
                            station.latitude = parseFloat(cityRes[0].latitude);
                            station.longitude = parseFloat(cityRes[0].longitude);
                        }
                    }
                } catch (err) {
                    console.error("Failed to map item address:", fullAddressStr, err.message);
                }
                return station;
            });

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
