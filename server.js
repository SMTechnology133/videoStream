// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

app.use(express.static(__dirname));

let users = new Map();        // userId -> { ws, name }
let broadcasterId = null;

function broadcastToAll(msg) {
    users.forEach(u => u.ws.send(JSON.stringify(msg)));
}

function updateBroadcasterList() {
    const list = [];
    if (broadcasterId) {
        list.push({
            id: broadcasterId,
            name: users.get(broadcasterId)?.name || "Unknown"
        });
    }
    broadcastToAll({ type: "broadcaster_list", list });
}

wss.on("connection", (ws) => {
    const userId = crypto.randomUUID();
    users.set(userId, { ws, name: null });

    ws.send(JSON.stringify({ type: "id", id: userId }));

    if (broadcasterId) updateBroadcasterList();

    ws.on("message", (msg) => {
        let data;
        try { data = JSON.parse(msg); } catch (e) { return; }

        switch (data.type) {
            case "set_name":
                users.get(userId).name = data.name;
                updateBroadcasterList();
                break;

            case "start_broadcast":
                broadcasterId = userId;
                broadcastToAll({
                    type: "broadcaster_started",
                    broadcasterId: userId,
                    broadcasterName: users.get(userId).name
                });
                updateBroadcasterList();
                break;

            case "stop_broadcast":
                broadcasterId = null;
                broadcastToAll({ type: "broadcaster_ended" });
                updateBroadcasterList();
                break;

            case "request_offer":
                if (broadcasterId) {
                    const host = users.get(broadcasterId)?.ws;
                    if (host) {
                        host.send(JSON.stringify({
                            type: "request_offer",
                            viewerId: userId
                        }));
                    }
                }
                break;

            case "offer":
            case "answer":
            case "candidate": {
                const targetUser = users.get(data.targetId);
                if (targetUser) {
                    targetUser.ws.send(JSON.stringify({
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
        users.delete(userId);

        if (userId === broadcasterId) {
            broadcasterId = null;
            broadcastToAll({ type: "broadcaster_ended" });
        }

        updateBroadcasterList();
    });
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});