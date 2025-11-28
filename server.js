// JavaScript Document
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");   // ✅ FIXED

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Serve static files (index.html must be in same folder)
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// =========================
// WebSocket Signaling Server
// =========================

const clients = new Map();
let broadcasterId = null;

wss.on("connection", (ws) => {
    const userId = crypto.randomUUID();
    clients.set(userId, ws);

    ws.send(JSON.stringify({ type: "id", id: userId }));

    if (broadcasterId) {
        ws.send(JSON.stringify({ type: "broadcaster_started", broadcasterId }));
    }

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        switch (data.type) {
            case "start_broadcast":
                if (!broadcasterId) {
                    broadcasterId = userId;

                    clients.forEach((client, id) => {
                        if (id !== userId)
                            client.send(
                                JSON.stringify({
                                    type: "broadcaster_started",
                                    broadcasterId,
                                })
                            );
                    });
                } else {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "A broadcaster already exists.",
                        })
                    );
                }
                break;

            case "stop_broadcast":
                if (userId === broadcasterId) {
                    broadcasterId = null;

                    clients.forEach((client) => {
                        client.send(JSON.stringify({ type: "broadcaster_ended" }));
                    });
                }
                break;

            case "offer":
            case "answer":
            case "candidate":
                const target = clients.get(data.targetId);
                if (target) {
                    target.send(
                        JSON.stringify({
                            type: data.type,
                            sdp: data.sdp,
                            candidate: data.candidate,
                            senderId: userId,
                        })
                    );
                }
                break;
        }
    });

    ws.on("close", () => {
        clients.delete(userId);

        if (userId === broadcasterId) {
            broadcasterId = null;

            clients.forEach((client) => {
                client.send(JSON.stringify({ type: "broadcaster_ended" }));
            });
        }
    });
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});