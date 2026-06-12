const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');

const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

router.post('/', async (req, res) => {
    try {
        const { search, radius, storeName, address, city, state, zip } = req.body;
        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("Critical: APIFY_TOKEN is missing from environment variables.");
            return res.status(500).json({ error: "Server configuration missing API key." });
        }

        // Build parameters for Apify
        let finalSearchParameter = zip || [address, city, state].filter(p => p).join(", ") || search || "Denver";
        
        let cacheKeyParts = [`text-${finalSearchParameter.replace(/\s+/g, '-').toLowerCase()}`];
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

        const apifyResponse = await fetch(apifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inputConfig)
        });

        if (!apifyResponse.ok) {
            return res.status(502).json({ error: "Gas price provider is currently unavailable." });
        }
        
        let datasetItems = await apifyResponse.json();

        // Brand Filtering
        if (storeName && Array.isArray(datasetItems)) {
            const cleanTargetBrand = storeName.toLowerCase().trim();
            datasetItems = datasetItems.filter(station => (station.name || '').toLowerCase().includes(cleanTargetBrand));
        }

        // Send the raw dataset straight to the frontend immediately! 
        gasCache.set(cacheKey, datasetItems);
        res.json(datasetItems);

    } catch (error) {
        console.error("🔴 Backend error:", error.message);
        res.status(500).json({ error: "Failed to fetch fuel prices safely." });
    }
});

module.exports = router;
