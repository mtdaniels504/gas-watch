const express = require('express');
const cors = require('cors');
const compression = require('compression'); 
const path = require('path'); 
require('dotenv').config(); 

// 🛡️ BARE BONES ROUTING PROFILE: Replace 'gas-watch' with your exact Vercel project dashboard name prefix
const PROJECT_NAME = 'gas-watch'; 

// 🛸 Pull in your independent route file
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
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }

        // 🛸 DYNAMIC VERCEL SHIELD: Validates requests originating from your live Vercel subdomains
        const isVercelSubdomain = origin.endsWith('.vercel.app') && origin.includes(PROJECT_NAME);

        if (isVercelSubdomain) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS policy: Unauthorized domain request.'));
        }
    }
}));

// 🗺️ Tell Express where your static assets live so it can serve index.html!
app.use(express.static(path.join(__dirname, 'public')));

// 🔌 Mount it instantly onto your server routing path
app.use('/api/gas-prices', gasPricesRoute);

// Express v5 Modern Catch-all Fallback
app.get('/:path*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// local server port configuration
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Secure gateway running locally on port ${PORT}`));
}

module.exports = app; // Required by Vercel serverless functions
