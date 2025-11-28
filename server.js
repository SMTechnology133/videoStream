// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Serve static files (index.html MUST be in same folder)
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// =========================
//   WEBRTC SIGNALING SERVER
// =========================

const clients = new Map();     // userId → ws
let broadcasterId = null;      // only ONE broadcaster allowed

wss.on("connection", (ws) => {
    const userId = crypto.randomUUID();
    clients.set(userId, ws);

    // Send user their system ID
    ws.send(JSON.stringify({ type: "id", id: userId }));

    // If a broadcaster already exists, notify new client
    if (broadcasterId) {
        ws.send(JSON.stringify({
            type: "broadcaster_started",
            broadcasterId
        }));
    }

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            return;
        }

        switch (data.type) {

            // ======================
            // BROADCASTER STARTS
            // ======================
            case "start_broadcast":
                if (!broadcasterId) {
                    broadcasterId = userId;

                    clients.forEach((client, id) => {
                        if (id !== userId) {
                            client.send(JSON.stringify({
                                type: "broadcaster_started",
                                broadcasterId,
                                name: data.name
                            }));
                        }
                    });
                } else {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "A broadcaster is already active."
                    }));
                }
                break;

            // ======================
            // BROADCASTER ENDS
            // ======================
            case "stop_broadcast":
                if (userId === broadcasterId) {
                    broadcasterId = null;

                    clients.forEach((client) => {
                        client.send(JSON.stringify({ type: "broadcaster_ended" }));
                    });
                }
                break;

            // ======================
            // VIEWER REQUESTS OFFER
            // ======================
            case "request_offer":
                if (broadcasterId) {
                    const host = clients.get(broadcasterId);
                    if (host) {
                        host.send(JSON.stringify({
                            type: "request_offer",
                            viewerId: data.viewerId
                        }));
                    }
                }
                break;

            // ======================
            // OFFER / ANSWER / ICE
            // ======================
            case "offer":
            case "answer":
            case "candidate": {
                const target = clients.get(data.targetId);
                if (target) {
                    target.send(JSON.stringify({
                        type: data.type,
                        sdp: data.sdp,
                        candidate: data.candidate,
                        senderId: userId
                    }));
                }
                break;
            }
        }
    });

    ws.on("close", () => {
        clients.delete(userId);

        // If broadcaster disconnects → reset everything
        if (userId === broadcasterId) {
            broadcasterId = null;

            clients.forEach((client) => {
                client.send(JSON.stringify({ type: "broadcaster_ended" }));
            });
        }
    });
});

server.listen(PORT, () => {
    console.log("✅ Server running on port " + PORT);
});