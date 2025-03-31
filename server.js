const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from any origin
        methods: ["GET", "POST"]
    }
});

// Store rooms, connections, and scores
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);


    socket.on('createRoom', (roomCode) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                users: [socket.id],
                host: socket.id,
                status: 'waiting'
            };
            socket.join(roomCode);
            console.log(`Sala ${roomCode} creada por ${socket.id}`);
            socket.emit('roomCreated', roomCode);
        } else {
            socket.emit('roomExists');
        }
    });

    // Join a room
    socket.on('joinRoom', (roomCode) => {
        if (!rooms[roomCode]) {
            socket.emit('roomNotFound');
            return;
        }

        if (rooms[roomCode].users.length >= 2) { // Limit of 2 players per room
            socket.emit('roomFull');
            return;
        }
        rooms[roomCode].users.push(socket.id);
        socket.join(roomCode);
        console.log(`User ${socket.id} joined room ${roomCode}`);

        // Notify other users in the room
        socket.to(roomCode).emit('userJoined', socket.id);

        // If there are two users in the room, start connection
        if (rooms[roomCode].users.length === 2) {
            rooms[roomCode].status='playing';
            io.to(roomCode).emit('starGame', roomCode);
            console.log(`Romm ${roomCode} is full, starting game`)
            // Send initial scores to both players
            io.to(roomCode).emit('initialScores', rooms[roomCode].scores);
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].users = rooms[roomCode].users.filter(id => id !== socket.id);
            socket.leave(roomCode);
            console.log(`Usuario ${socket.id} dejó sala ${roomCode}`);

            // Si la sala queda vacía, eliminarla
            if (rooms[roomCode].users.length === 0) {
                delete rooms[roomCode];
                console.log(`Sala ${roomCode} eliminada por estar vacía`);
            }
        }
    });

    // Handle score updates
    socket.on('updateScore', (data) => {
        const { roomId, score } = data;
        
        if (rooms[roomId] && rooms[roomId].users.includes(socket.id)) {
            // Update the player's score
            rooms[roomId].scores[socket.id] = score;
            
            // Broadcast the updated score to the other player
            socket.to(roomId).emit('opponentScoreUpdate', {
                roomId: roomId,
                score: score,
                playerId: socket.id
            });
            
            console.log(`Score updated in room ${roomId} for player ${socket.id}: ${score}`);
        }
    });

    // Send SDP offer
    socket.on('offer', (roomCode, offer) => {
        socket.to(roomCode).emit('offer', offer);
    });

    // Send SDP answer
    socket.on('answer', (roomCode, answer) => {
        socket.to(roomCode).emit('answer', answer);
    });

    // Send ICE candidates
    socket.on('iceCandidate', (roomCode, candidate) => {
        socket.to(roomCode).emit('iceCandidate', candidate);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const roomCode in rooms) {
            if (rooms[roomCode].users.includes(socket.id)) {
                rooms[roomCode].users = rooms[roomCode].users.filter(user => user !== socket.id);
                
                socket.to(roomCode).emit('userLeft', socket.id);
                if (rooms[roomCode].users.length === 0) {
                    delete rooms[roomCode]; // Delete the room if empty
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signaling server running at http://localhost:${PORT}`);
});