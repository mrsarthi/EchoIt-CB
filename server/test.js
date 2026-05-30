const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
const JWT_SECRET = 'secret';
const JWT_EXPIRY = '4h';
const authResults = new Map();

app.post('/api/auth/callback', (req, res) => {
    const { sessionId, address, signature } = req.body;
    try {
        const token = jwt.sign({ address: address.toLowerCase() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        authResults.set(sessionId, { address, signature, timestamp: Date.now() });
        io.to('auth_' + sessionId).emit('wallet_auth_result', { address, signature, token });
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

server.listen(3000, async () => {
    console.log('Listening');
    try {
        const response = await fetch('http://localhost:3000/api/auth/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: "123", address: "0x123", signature: "0x456" })
        });
        const text = await response.text();
        console.log("Response:", response.status, text);
    } catch (e) {
        console.error("Fetch error:", e);
    }
    process.exit(0);
});
