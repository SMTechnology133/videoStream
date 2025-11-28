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

// users: Map<userId, { ws, name, profilePic, isBroadcasting }>
const users = new Map();

function safeSend(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore send errors */ }
}

function broadcastToAll(obj) {
    for (const [, user] of users) {
        safeSend(user.ws, obj);
    }
}

function getBroadcasterList() {
    const list = [];
    for (const [id, u] of users) {
        if (u.isBroadcasting) {
            list.push({
                id,
                name: u.name || "Anonymous",
                profilePic: u.profilePic || null
            });
        }
    }
    return list;
}

function sendBroadcasterListToAll() {
    const list = getBroadcasterList();
    broadcastToAll({ type: "broadcaster_list", list });
}

wss.on("connection", (ws) => {
    const userId = crypto.randomUUID();
    users.set(userId, { ws, name: null, profilePic: null, isBroadcasting: false });

    // send assigned id (clients keep internal id but UI shows name)
    safeSend(ws, { type: "id", id: userId });

    // send initial broadcaster list
    safeSend(ws, { type: "broadcaster_list", list: getBroadcasterList() });

    ws.on("message", (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }

        const me = users.get(userId);
        if (!me) return;

        switch (data.type) {
            case "set_name":
                me.name = data.name || me.name;
                sendBroadcasterListToAll();
                break;

            case "set_profile":
            case "setProfile":
                me.name = data.username || data.name || me.name;
                me.profilePic = data.profilePic || data.picture || me.profilePic;
                sendBroadcasterListToAll();
                break;

            case "start_broadcast":
                me.isBroadcasting = true;
                broadcastToAll({
                    type: "broadcaster_started",
                    broadcasterId: userId,
                    broadcasterName: me.name || "Anonymous",
                    profilePic: me.profilePic || null,
                    list: getBroadcasterList()
                });
                sendBroadcasterListToAll();
                break;

            case "stop_broadcast":
                me.isBroadcasting = false;
                broadcastToAll({
                    type: "broadcaster_ended",
                    broadcasterId: userId,
                    list: getBroadcasterList()
                });
                sendBroadcasterListToAll();
                break;

            case "request_offer":
                {
                    // viewer requests to join target broadcaster
                    const targetId = data.targetId || data.to || data.target;
                    const viewerId = userId;
                    const viewerName = me.name || "Anonymous";

                    if (!targetId) break;
                    const target = users.get(targetId);
                    if (target) {
                        safeSend(target.ws, {
                            type: "request_offer",
                            viewerId,
                            viewerName
                        });
                    }
                }
                break;

            case "offer":
            case "answer":
            case "candidate": {
                const targetId = data.targetId || data.to || data.target;
                if (!targetId) break;
                const target = users.get(targetId);
                if (!target) break;

                const payload = {
                    type: data.type,
                    sdp: data.sdp,
                    candidate: data.candidate,
                    senderId: userId,
                    senderName: me.name || "Anonymous"
                };
                safeSend(target.ws, payload);
                break;
            }

            case "logout":
                me.isBroadcasting = false;
                me.name = null;
                me.profilePic = null;
                sendBroadcasterListToAll();
                break;

            default:
                // ignore unknown messages
                break;
        }
    });

    ws.on("close", () => {
        const wasBroadcasting = users.get(userId)?.isBroadcasting;
        users.delete(userId);

        if (wasBroadcasting) {
            broadcastToAll({ type: "broadcaster_ended", broadcasterId: userId, list: getBroadcasterList() });
        }
        sendBroadcasterListToAll();
    });

    ws.on("error", () => {
        // ignore
    });
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});