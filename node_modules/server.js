const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permitir conexiones desde cualquier origen (cambia esto en producción)
        methods: ["GET", "POST"]
    }
});

// Almacenar salas y conexiones
const rooms = {};

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Unirse a una sala
    socket.on('joinRoom', (roomCode) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = { users: [] };
        }

        if (rooms[roomCode].users.length >= 2) { // Límite de 2 jugadores por sala
            socket.emit('roomFull');
            return;
        }

        socket.join(roomCode);
        rooms[roomCode].users.push(socket.id);
        console.log(`Usuario ${socket.id} se unió a la sala ${roomCode}`);

        // Notificar a otros usuarios en la sala
        socket.to(roomCode).emit('userJoined', socket.id);

        // Si hay dos usuarios en la sala, iniciar el intercambio de señales
        if (rooms[roomCode].users.length === 2) {
            io.to(roomCode).emit('startConnection');
        }
    });

    // Enviar oferta SDP
    socket.on('offer', (roomCode, offer) => {
        socket.to(roomCode).emit('offer', offer);
    });

    // Enviar respuesta SDP
    socket.on('answer', (roomCode, answer) => {
        socket.to(roomCode).emit('answer', answer);
    });

    // Enviar candidatos ICE
    socket.on('iceCandidate', (roomCode, candidate) => {
        socket.to(roomCode).emit('iceCandidate', candidate);
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        for (const roomCode in rooms) {
            if (rooms[roomCode].users.includes(socket.id)) {
                rooms[roomCode].users = rooms[roomCode].users.filter(user => user !== socket.id);
                socket.to(roomCode).emit('userLeft', socket.id);
                if (rooms[roomCode].users.length === 0) {
                    delete rooms[roomCode]; // Eliminar la sala si está vacía
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de señalización en http://localhost:${PORT}`);
});