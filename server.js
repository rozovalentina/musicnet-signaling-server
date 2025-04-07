const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:8000/musicnet/","https://musicnet.surge.sh/", "*"], // Allow connections from any origin
        methods: ["GET", "POST"],
        credentials: true, 
        allowedHeaders: ["Content-Type"],
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
                status: 'waiting',
                scores: {}
            };
            socket.join(roomCode);
            console.log(`Sala ${roomCode} creada por ${socket.id}`);
            socket.emit('roomCreated', roomCode);
        } else {
            socket.emit('roomExists');
        }
    });

// Modifica el handler de joinRoom
socket.on('joinRoom', (roomCode) => {
    if (!rooms[roomCode]) {
        console.log(`Room ${roomCode} not found`);
        socket.emit('roomError', 'Room not found');
        return;
    }

    if (rooms[roomCode].users.length >= 2) {
        console.log(`Room ${roomCode} is full`);
        socket.emit('roomFull', 'Room is full');
        return;
    }

    // Inicializar scores si no existe
    if (!rooms[roomCode].scores) {
        rooms[roomCode].scores = {};
    }
    
    // Añadir usuario con score inicial 0
    rooms[roomCode].users.push(socket.id);
    rooms[roomCode].scores[socket.id] = 0;
    
    socket.join(roomCode);
    console.log(`User ${socket.id} joined room ${roomCode}`);

    // Notificar al otro jugador
    socket.to(roomCode).emit('userJoined', socket.id);

    // Cuando hay 2 jugadores, iniciar el juego
    if (rooms[roomCode].users.length === 2) {
        rooms[roomCode].status = 'playing';
        console.log(`Starting game in room ${roomCode}`);
        
        // Emitir a ambos jugadores con su rol
        io.to(roomCode).emit('startGame', {
            roomCode: roomCode,
            players: rooms[roomCode].users.map(id => ({
                id,
                isHost: id === rooms[roomCode].host
            }))
        });
    }
});

// Handler mejorado para updateScore
socket.on('updateScore', (data) => {
    try {
        const { roomCode, score } = data;
        
        if (!rooms[roomCode] || !rooms[roomCode].users.includes(socket.id)) {
            console.error(`Invalid updateScore request from ${socket.id}`);
            return;
        }

        // Asegurar que scores existe
        if (!rooms[roomCode].scores) {
            rooms[roomCode].scores = {};
        }
        
        // Actualizar score
        rooms[roomCode].scores[socket.id] = score;
        console.log(`Score updated in ${roomCode} for ${socket.id}: ${score}`);
        
        // Notificar al otro jugador
        socket.to(roomCode).emit('opponentScoreUpdate', {
            playerId: socket.id,
            score: score
        });
    } catch (error) {
        console.error('Error in updateScore:', error);
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


// Handler mejorado para ofertas
socket.on('offer', (roomCode, offer) => {
    console.log(`Offer recibido para sala `, roomCode.roomCode, `de ${socket.id}:`, offer);
    if (!rooms[roomCode.roomCode] || !rooms[roomCode.roomCode].users.includes(socket.id)) {
        console.error(`Sala inválida o usuario no autorizado en la oferta`);
        return;
    }
    
    // Transmitir la oferta al otro cliente
    socket.to(roomCode.roomCode).emit('offer', offer);
    console.log(`Offer transmitido a otros clientes en`, roomCode);
});

// Handler mejorado para respuestas
socket.on('answer', (roomCode, answer) => {
    console.log(`Answer recibido para sala `, roomCode.roomCode, `de ${socket.id}:`, answer);
    if (!rooms[roomCode.roomCode] || !rooms[roomCode.roomCode].users.includes(socket.id)) {
        console.error(`Sala inválida o usuario no autorizado en respuesta`);
        return;
    }
    
    // Transmitir la respuesta al otro cliente
    socket.to(roomCode.roomCode).emit('answer', answer);
    console.log(`Answer transmitido a otros clientes en ${roomCode.roomCode}`);
});

// Handler para ICE candidates
socket.on('iceCandidate', (roomCode, candidate) => {
    console.log(`ICE Candidate recibido para`, roomCode.roomCode, `de ${socket.id}:`, candidate);
    if (!rooms[roomCode.roomCode] || !rooms[roomCode.roomCode].users.includes(socket.id)) {
        console.error(`Sala inválida o usuario no autorizado en ice candidate`);
        return;
    }
    
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