// JavaScript Document
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Set up static serving for the client file
app.use(express.static(__dirname));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- WebSocket Signaling Logic ---

// Store all connected clients
const clients = new Map();
let broadcasterId = null;

wss.on('connection', (ws) => {
    const userId = crypto.randomUUID();
    clients.set(userId, ws);
    console.log(`[User Connected] ID: ${userId}. Total users: ${clients.size}`);

    // Send the user ID to the client for debugging/identification
    ws.send(JSON.stringify({ type: 'id', id: userId }));
    
    // Notify if a broadcaster is already active
    if (broadcasterId) {
        ws.send(JSON.stringify({ type: 'broadcaster_online', broadcasterId }));
    }

    ws.on('message', (message) => {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
            case 'start_broadcast':
                // A user wants to be the broadcaster
                if (!broadcasterId) {
                    broadcasterId = userId;
                    console.log(`[BROADCAST START] User ID ${userId} is now the broadcaster.`);
                    
                    // Notify all other clients that a broadcast has started
                    clients.forEach((client, id) => {
                        if (id !== userId && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'broadcaster_started', broadcasterId }));
                        }
                    });
                } else {
                    // Send error if another broadcaster exists
                    ws.send(JSON.stringify({ type: 'error', message: 'A broadcast is already active.' }));
                }
                break;

            case 'offer':
                // Broadcaster sends an Offer (SDP)
                console.log(`[SIGNAL] Offer received from Broadcaster (${userId}). Forwarding to viewer ${data.targetId}`);
                
                const viewerWs = clients.get(data.targetId);
                if (viewerWs && viewerWs.readyState === WebSocket.OPEN) {
                    // Forward the offer to the specified viewer
                    viewerWs.send(JSON.stringify({ 
                        type: 'offer', 
                        sdp: data.sdp,
                        senderId: userId // The broadcaster's ID
                    }));
                }
                break;

            case 'answer':
                // Viewer sends an Answer (SDP)
                console.log(`[SIGNAL] Answer received from Viewer (${userId}). Forwarding to Broadcaster ${data.targetId}`);
                
                const broadcasterWs = clients.get(data.targetId);
                if (broadcasterWs && broadcasterWs.readyState === WebSocket.OPEN) {
                    // Forward the answer back to the broadcaster
                    broadcasterWs.send(JSON.stringify({ 
                        type: 'answer', 
                        sdp: data.sdp,
                        senderId: userId // The viewer's ID
                    }));
                }
                break;

            case 'candidate':
                // ICE Candidate exchange
                const targetWs = clients.get(data.targetId);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    // Forward the ICE candidate
                    targetWs.send(JSON.stringify({ 
                        type: 'candidate', 
                        candidate: data.candidate,
                        senderId: userId
                    }));
                }
                break;
                
            default:
                console.warn(`Unknown message type: ${data.type}`);
        }
    });

    ws.on('close', () => {
        clients.delete(userId);
        console.log(`[User Disconnected] ID: ${userId}. Total users: ${clients.size}`);
        
        // If the broadcaster disconnects, notify everyone
        if (userId === broadcasterId) {
            broadcasterId = null;
            console.log("[BROADCAST END] Broadcaster disconnected.");
            clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'broadcaster_ended' }));
                }
            });
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket Error for user ${userId}:`, err);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log("WebSocket Signaling Server is active.");
});