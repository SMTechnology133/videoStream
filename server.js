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
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
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

    // send assigned id (clients may keep it internally but should not display it)
    safeSend(ws, { type: "id", id: userId });

    // send initial broadcaster list so client can populate UI
    safeSend(ws, { type: "broadcaster_list", list: getBroadcasterList() });

    ws.on("message", (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return;
        }

        const me = users.get(userId);
        if (!me) return;

        switch (data.type) {
            case "set_name":
                me.name = data.name || null;
                // broadcast updated list and notify all of name change
                sendBroadcasterListToAll();
                break;

            case "set_profile":
            case "setProfile":
                // accept either shape
                me.name = data.username || data.name || me.name;
                me.profilePic = data.profilePic || data.picture || me.profilePic;
                // inform everyone so UI updates
                sendBroadcasterListToAll();
                break;

            case "start_broadcast":
                me.isBroadcasting = true;
                // announce
                broadcastToAll({
                    type: "broadcaster_started",
                    broadcasterId: userId,
                    broadcasterName: me.name || "Anonymous",
                    profilePic: me.profilePic || null,
                    list: getBroadcasterList()
                });
                // send updated list
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
                // viewer requests to connect to a specific broadcaster (targetId)
                // payload should include: { type: "request_offer", viewerId, targetId }
                {
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
                // Forward these to the intended targetId
                const targetId = data.targetId || data.to || data.target;
                if (!targetId) break;
                const target = users.get(targetId);
                if (!target) break;

                // include sender metadata for name-friendly UI
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
                // optional: user logs out from UI; clear profile and stop broadcast
                me.isBroadcasting = false;
                me.name = null;
                me.profilePic = null;
                sendBroadcasterListToAll();
                break;

            default:
                // unknown — ignore or log
                break;
        }
    });

    ws.on("close", () => {
        const wasBroadcaster = users.get(userId)?.isBroadcasting;
        users.delete(userId);

        if (wasBroadcaster) {
            // notify all that a broadcaster ended
            broadcastToAll({ type: "broadcaster_ended", broadcasterId: userId, list: getBroadcasterList() });
        }
        sendBroadcasterListToAll();
    });

    ws.on("error", () => {
        // ignore errors; cleanup happens on close
    });
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});