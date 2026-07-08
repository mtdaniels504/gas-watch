const express = require('express');
const cors = require('cors');
const compression = require('compression'); 
const path = require('path'); 
require('dotenv').config(); 

// 🛡️ BARE BONES ROUTING PROFILE
const PROJECT_NAME = 'gas-watch'; 

// Pull in independent route file
const gasPricesRoute = require('./routes/gasPrices');

const app = express();

app.use(compression()); 
app.use(express.json()); 

// 🛡️ SECURITY SCHEMA (UNIVERSAL SKELETON)
const allowedOrigins = [
    'https://gas-watch.com', 
    'http://localhost:5500',        
    'http://localhost:3000'         
]; 

app.use(cors({
    origin: function (origin, callback) {
        // 1. Allow internal/local requests or empty testing origins
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }

        // FIXED: Double-escaped literal dots to ensure full string-to-regex literal compilation safety
        const vercelRegex = new RegExp(`^https:\\/\\/([a-zA-Z0-9-]+-)?${PROJECT_NAME}(-.*)?\\.vercel\\.app$`);
                
        if (vercelRegex.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS policy: Unauthorized domain request.'));
        }
    }
}));

// Tell Express where static assets live so it can serve index.html
app.use(express.static(path.join(__dirname, 'public')));

// Mount main price fetch API path
app.use('/api/gas-prices', gasPricesRoute);

// Catch-all route to serve the core SPA layout
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Local server port configuration
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Secure gateway running locally on port ${PORT}`));
}

module.exports = app; // Required by Vercel serverless functions
