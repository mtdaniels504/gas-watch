const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');

const gasCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

router.post('/', async (req, res) => {
    try {
        // ⚡ THE FIX: Add "= {}" at the end to prevent native engine crashes if req.body is undefined
        const { search, radius, storeName, address, city, state, zip } = req.body || {};
        
        const APIFY_TOKEN = process.env.APIFY_TOKEN; 
        const ACTOR_ID = "johnvc~fuelprices";
        
        if (!APIFY_TOKEN) {
            console.error("Critical: APIFY_TOKEN is missing from environment vault.");
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

        // Fetch from Apify
        const inputConfig = {
            "search": finalSearchParameter, 
            "fuel": 1,
            "maxAge": 0,
            "lang": "en",
            "radius": searchRadius
        };

        // ✨ THE FIXED URL ENDPOINT DIRECTORY Endpoints
        const apifyUrl = `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=8`;

        let datasetItems = [];

        // 🛡️ CRASH PROTECTOR: Wrap the raw fetch call inside its own catch loop to prevent server restarts
        try {
            console.log(`📡 [Backend Miss] Contacting Apify securely: ${finalSearchParameter}`);
            const apifyResponse = await fetch(apifyUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inputConfig)
            });

            if (!apifyResponse.ok) {
                console.error(`⚠️ Apify server returned an error status: ${apifyResponse.status}`);
                return res.status(502).json({ error: "Gas price database provider is currently unavailable." });
            }
            
            datasetItems = await apifyResponse.json();
        } catch (fetchErr) {
            console.error("🔴 Fatal Fetch Error: Apify URL connection failed completely.", fetchErr.message);
            return res.status(502).json({ error: "Failed to connect to the gas price database engine repository." });
        }

        // Brand Filtering
        if (storeName && Array.isArray(datasetItems)) {
            const cleanTargetBrand = storeName.toLowerCase().trim();
            datasetItems = datasetItems.filter(station => (station.name || '').toLowerCase().includes(cleanTargetBrand));
        }

        // ✨ PRODUCTION SORTING: Sort by Cheapest Cash/Credit Price First
        if (Array.isArray(datasetItems)) {
            datasetItems.sort((a, b) => {
                const priceA = parseFloat(a.price_cash || a.price_credit || Infinity);
                const priceB = parseFloat(b.price_cash || b.price_credit || Infinity);
                return priceA - priceB;
            });
        }

        // Send the raw dataset straight back
        gasCache.set(cacheKey, datasetItems);
        res.json(datasetItems);

    } catch (error) {
        console.error("🔴 Backend error:", error.message);
        res.status(500).json({ error: "Failed to fetch fuel prices safely." });
    }
});

module.exports = router;
