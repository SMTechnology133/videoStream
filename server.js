const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

// Serve public folder
app.use(express.static("public"));

// Keep track of broadcasters and viewers
let broadcasters = new Map(); // socket.id => { username, profilePic }
let viewers = new Map(); // socket.id => { username, profilePic }

io.on("connection", socket => {
    console.log("User connected:", socket.id);

    // Receive user profile (name + picture)
    socket.on("setProfile", data => {
        socket.username = data.username || "Unknown";
        socket.profilePic = data.profilePic || "";
        viewers.set(socket.id, { username: socket.username, profilePic: socket.profilePic });
        io.emit("broadcaster_list", getBroadcasterList());
    });

    // Start broadcasting
    socket.on("start_broadcast", data => {
        broadcasters.set(socket.id, { username: data.name, profilePic: socket.profilePic });
        io.emit("broadcaster_started", {
            broadcasterId: socket.id,
            broadcasterName: data.name,
            list: getBroadcasterList()
        });
        console.log(`${data.name} started broadcasting`);
    });

    // Stop broadcasting
    socket.on("stop_broadcast", () => {
        if (broadcasters.has(socket.id)) {
            const name = broadcasters.get(socket.id).username;
            broadcasters.delete(socket.id);
            io.emit("broadcaster_ended", {
                broadcasterId: socket.id,
                list: getBroadcasterList()
            });
            console.log(`${name} stopped broadcasting`);
        }
    });

    // Logout / Change profile
    socket.on("logout", () => {
        if (broadcasters.has(socket.id)) broadcasters.delete(socket.id);
        if (viewers.has(socket.id)) viewers.delete(socket.id);
        io.emit("broadcaster_list", getBroadcasterList());
    });

    // WebRTC Offer
    socket.on("offer", data => {
        socket.to(data.to).emit("offer", {
            sdp: data.sdp,
            from: socket.id,
            username: socket.username,
            profilePic: socket.profilePic
        });
    });

    // WebRTC Answer
    socket.on("answer", data => {
        socket.to(data.to).emit("answer", { sdp: data.sdp, from: socket.id });
    });

    // ICE Candidates
    socket.on("candidate", data => {
        socket.to(data.to).emit("candidate", { candidate: data.candidate, from: socket.id });
    });

    socket.on("disconnect", () => {
        if (broadcasters.has(socket.id)) broadcasters.delete(socket.id);
        if (viewers.has(socket.id)) viewers.delete(socket.id);
        io.emit("broadcaster_list", getBroadcasterList());
        console.log("User disconnected:", socket.id);
    });
});

// Helper: get all broadcasters
function getBroadcasterList() {
    const list = [];
    broadcasters.forEach((value, key) => {
        list.push({ id: key, name: value.username, pic: value.profilePic });
    });
    return list;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on port", PORT));