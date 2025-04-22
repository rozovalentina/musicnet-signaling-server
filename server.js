const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({
    origin: ["http://localhost:8000", "https://musicnet.surge.sh", "http://127.0.0.1:8000"],
    methods: ["GET", "POST"],
    credentials: true
}));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:8000", "https://musicnet.surge.sh", "http://127.0.0.1:8000"],
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["socket.io-version"]
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minute
        skipMiddlewares: true
    }
});

// Room management 
const rooms = {};

// Helper functions
const isValidRoomCode = (roomCode) => {
    return typeof roomCode === 'string' && roomCode.length === 6;
};
const cleanUpRoom = () => {
    const now = Date.now();
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        if ((room.users.length === 0 && now - room.lastUpdated > 300000) || (room.status === 'waiting' && now - room.createdAt > 1800000)) {
            delete rooms[roomCode];
            console.log(`Room ${roomCode} cleaned up`);
        }
    }
};

const getOtherUserInRoom = (room, socketId) => {
    return room.users.find(user => user !== socketId);
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    const heartbeatInterval = setInterval(() => {
        if (!socket.connected) {
            clearInterval(heartbeatInterval);
            return;
        }
        socket.emit('ping');
    }, 30000); // Send ping every 30 seconds
    socket.on('pong', () => {
        console.log('Pong received from', socket.id);
    });

    // Create a new room
    socket.on('createRoom', (roomCode, callback) => {
        try {
            if (!isValidRoomCode(roomCode)) {
                throw new Error('Invalid room code format');
            }

            if (rooms[roomCode]) {
                throw new Error('roomExists');
            }

            rooms[roomCode] = {
                users: [socket.id],
                host: socket.id,
                status: 'waiting',
                scores: { [socket.id]: 0 },
                settings: null,
                createdAt: Date.now(),
                lastUpdated: Date.now() // Track last updated time
            };

            socket.join(roomCode);
            console.log(`Room ${roomCode} created by ${socket.id}`);

            if (typeof callback === 'function') {
                callback({ success: true, roomCode, isHost: true });
            }
            //socket.emit('roomCreated', { 
            //  roomCode,
            //isHost: true
            //});
        } catch (error) {
            console.error('Error in createRoom:', error.message);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Join an existing room
    socket.on('joinRoom', (roomCode, callback) => {
        try {
            if (!isValidRoomCode(roomCode)) {
                throw new Error('Invalid room code format');
            }

            const room = rooms[roomCode];

            if (!room) {
                throw new Error('Room not found');
            }

            if (room.users.length >= 2) {
                throw new Error('Room is full');
            }

            // Add user to room
            room.users.push(socket.id);
            room.scores[socket.id] = 0;
            room.lastUpdated = Date.now(); // Update last updated time
            socket.join(roomCode);

            console.log(`User ${socket.id} joined room ${roomCode}`);

            /* socket.emit('joinSuccess',{
                 roomCode,
                 isHost: false,
                 otherUser: room.users[0]
             })*/
            // Notify the host that a player joined
            socket.to(roomCode).emit('playerJoined', { playerId: socket.id, roomCode });

            // When 2 players are present, start configuring the game
            if (room.users.length === 2) {
                room.status = 'configuring';
                console.log(`Configure game in room ${roomCode}`);

                io.to(roomCode).emit('roomReady', { roomCode, players: room.users, hostId: room.host });
                callback({ success: true, roomCode, isHost: false, hostId: room.host, roomReady: true });
            }
        } catch (error) {
            console.error('Error in joinRoom:', error.message);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('updateSettings', (data, callback) => {
        const { roomCode, settings } = data;
        try {
            if (!rooms[roomCode] || socket.id !== rooms[roomCode].host) {
                throw new Error('Only host can update settings');
            }
            if (!settings.noteReference || !settings.modalScaleName || !settings.gameModality) {
                throw new Error('Invalid game settings');
            }
            // Store settings in room
            rooms[roomCode].settings = settings;
            rooms[roomCode].lastUpdated = Date.now(); // Update last updated time
            console.log(`Settings updated for room ${roomCode}`);
            // Notify all players in the room
            io.to(roomCode).emit('settingsUpdated', settings);
            callback({ success: true });
        } catch (error) {
            console.error('Error in updateSettings:', error.message);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('startConfiguration', (roomCode, gameSettings, callback) => {
        try {
            // Check if callback exists (optional)
            const respond = (response) => {
                if (typeof callback === 'function') callback(response);
            };

            if (!isValidRoomCode(roomCode)) {
                throw new Error('Invalid room code format');
            }

            const room = rooms[roomCode];
            if (!room) {
                throw new Error('Room not found');
            }

            // Verify the requester is the host
            if (room.host !== socket.id) {
                throw new Error('Only host can start the game');
            }

            // Validate game settings if needed
            // if (!isValidGameSettings(gameSettings)) {
            //     throw new Error('Invalid game settings');
            // }

            // Update room status and settings
            room.status = 'playing';
            room.settings = gameSettings;
            room.lastUpdated = Date.now();

            console.log(`Game started in room ${roomCode} by ${socket.id}`);

            // Broadcast to all players in the room
            io.to(roomCode).emit('gameStarted', {
                roomCode,
                settings: gameSettings
            });

            respond({ success: true });
        } catch (error) {
            console.error('Error in startGame:', error.message);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('startGame', (roomCode, settings) => {
        console.log(`Host ${socket.id} starting game in room ${roomCode}`);
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            console.log(`Emitting gameStarting to room ${roomCode}`);
            io.to(roomCode).emit('gameStarting', {
                roomCode: roomCode,
                settings: settings
            });
        }
    });

    socket.on('hostStartingGame', (roomCode, settings) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            // Notificar a todos en la sala que el juego comienza
            io.to(roomCode).emit('gameStarting', {
                roomCode: roomCode,
                settings: settings,
                hostId: socket.id
            });
        }
    });

    socket.on('playerReady', (roomCode) => {
        socket.to(rooms[roomCode].host).emit('playerReady', {
            playerId: socket.id,
            roomCode: roomCode
        });
    });

    socket.on('updateScore', (data) => {
        try {
            console.log('Received updateScore event:', data);
    
            // Extraer roomCode y score de diferentes formatos
            let roomCode, score;
            
            // Caso 1: Datos vienen como objeto con roomCode y score
            if (typeof data === 'object' && data.roomCode && data.score !== undefined) {
                roomCode = data.roomCode;
                score = data.score;
            } 
            // Caso 2: Datos vienen como objeto con score pero sin roomCode
            else if (typeof data === 'object' && data.score !== undefined) {
                score = data.score;
                // Buscar roomCode en las rooms del socket (excluyendo su propia room)
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
            // Caso 3: Formato antiguo (roomCode como primer parámetro, score como segundo)
            else if (typeof data === 'string' && arguments[1] !== undefined) {
                roomCode = data;
                score = arguments[1];
            }
            // Caso 4: Datos son directamente el score (sin roomCode)
            else {
                score = data;
                // Intentar obtener roomCode de las rooms del socket
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
    
            console.log(`Processing score update for room: ${roomCode}`, score);
    
            // Validar que tenemos roomCode y score
            if (!roomCode) {
                throw new Error('Room code not provided and could not be determined from socket rooms');
            }
            
            if (score === undefined || score === null) {
                throw new Error('Score not provided');
            }
    
            // Validar formato del roomCode
            if (!isValidRoomCode(roomCode)) {
                throw new Error(`Invalid room code format: ${roomCode}`);
            }
    
            // Verificar si la sala existe
            const room = rooms[roomCode];
            if (!room) {
                throw new Error(`Room ${roomCode} not found`);
            }
    
            // Verificar si el usuario está en la sala
            if (!room.users.includes(socket.id)) {
                throw new Error(`User ${socket.id} not in room ${roomCode}`);
            }
    
            // Validar que el score sea un número
            if (typeof score !== 'number' || isNaN(score)) {
                throw new Error('Invalid score format - must be a number');
            }
    
            // Actualizar el score
            room.scores[socket.id] = score;
            room.lastUpdated = Date.now();
            
            console.log(`Score updated in ${roomCode} for ${socket.id}: ${score}`);
    
            // Notificar al oponente
            const otherUser = room.users.find(id => id !== socket.id);
            if (otherUser) {
                socket.to(roomCode).emit('ScoreUpdate', {
                    playerId: socket.id,
                    score: score,
                    roomCode: roomCode
                });
            }
    
        } catch (error) {
            console.error('Error in updateScore handler:', {
                error: error.message,
                socketId: socket.id,
                data: data,
                rooms: socket.rooms
            });
            
            // Enviar error al cliente solo si el socket está conectado
            if (socket.connected) {
                socket.emit('scoreUpdateError', {
                    error: error.message,
                    details: {
                        roomCode: data.roomCode || (Array.from(socket.rooms).filter(room => room !== socket.id)[0]),
                        score: data.score || (typeof data === 'object' ? data : arguments[1])
                    }
                });
            }
        }
    });

    // WebRTC signaling

    socket.on('rtcSignal', ({ roomCode, signal, targetId }) => {
        if (rooms[roomCode] && rooms[roomCode].users.includes(socket.id)) {
            socket.to(targetId).emit('rtcSignal', {
                senderId: socket.id,
                signal
            });
        }
    });

    socket.on('offer', (data) => {
        try {
            console.log('Received offer event:', data);
    
            // Extraer roomCode y offer de diferentes formatos
            let roomCode, offer;
            
            // Caso 1: Datos vienen como objeto con roomCode y offer
            if (typeof data === 'object' && data.roomCode && data.offer) {
                roomCode = data.roomCode;
                offer = data.offer;
            } 
            // Caso 2: Datos vienen como objeto con offer pero sin roomCode
            else if (typeof data === 'object' && data.offer) {
                offer = data.offer;
                // Buscar roomCode en las rooms del socket (excluyendo su propia room)
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
            // Caso 3: Formato antiguo (roomCode como primer parámetro, offer como segundo)
            else if (typeof data === 'string' && arguments[1]) {
                roomCode = data;
                offer = arguments[1];
            }
            // Caso 4: Datos son directamente el offer (sin roomCode)
            else {
                offer = data;
                // Intentar obtener roomCode de las rooms del socket
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
    
            console.log(`Processing offer for room: ${roomCode}`, offer);
    
            // Validar que tenemos roomCode y offer
            if (!roomCode) {
                throw new Error('Room code not provided and could not be determined from socket rooms');
            }
            
            if (!offer) {
                throw new Error('Offer not provided');
            }
    
            // Validar formato del roomCode
            if (!isValidRoomCode(roomCode)) {
                throw new Error(`Invalid room code format: ${roomCode}`);
            }
    
            // Verificar si la sala existe
            const room = rooms[roomCode];
            if (!room) {
                throw new Error(`Room ${roomCode} not found`);
            }
    
            // Verificar si el usuario está en la sala
            if (!room.users.includes(socket.id)) {
                throw new Error(`User ${socket.id} not in room ${roomCode}`);
            }
    
            // Encontrar el otro usuario en la sala
            const otherUser = room.users.find(id => id !== socket.id);
            if (!otherUser) {
                throw new Error('No other user in room to send offer to');
            }
    
            // Verificar que el offer tenga un formato válido
            if (!offer.type || !offer.sdp) {
                console.warn('Received malformed offer:', offer);
                throw new Error('Invalid offer format');
            }
    
            console.log(`Forwarding offer from ${socket.id} to ${otherUser} in room ${roomCode}`);
            
            // Enviar el offer al otro usuario
            socket.to(otherUser).emit('offer', {
                senderId: socket.id,
                offer: offer,
                roomCode: roomCode
            });
    
            // Actualizar último tiempo de actividad de la sala
            rooms[roomCode].lastUpdated = Date.now();
    
        } catch (error) {
            console.error('Error in offer handler:', {
                error: error.message,
                socketId: socket.id,
                data: data,
                rooms: socket.rooms
            });
            
            // Enviar error al cliente solo si el socket está conectado
            if (socket.connected) {
                socket.emit('offerError', {
                    error: error.message,
                    details: {
                        roomCode: data.roomCode || (Array.from(socket.rooms).filter(room => room !== socket.id)[0]),
                        offer: data.offer || (typeof data === 'object' ? data : arguments[1])
                    }
                });
            }
        }
    });

    socket.on('answer', (data) => {
        try {
            console.log('Received answer event:', data);
    
            // Extraer roomCode y answer de diferentes formatos
            let roomCode, answer;
            
            // Caso 1: Datos vienen como objeto con roomCode y answer
            if (typeof data === 'object' && data.roomCode && data.answer) {
                roomCode = data.roomCode;
                answer = data.answer;
            } 
            // Caso 2: Datos vienen como objeto con answer pero sin roomCode
            else if (typeof data === 'object' && data.answer) {
                answer = data.answer;
                // Buscar roomCode en las rooms del socket (excluyendo su propia room)
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
            // Caso 3: Formato antiguo (roomCode como primer parámetro, answer como segundo)
            else if (typeof data === 'string' && arguments[1]) {
                roomCode = data;
                answer = arguments[1];
            }
            // Caso 4: Datos son directamente el answer (sin roomCode)
            else {
                answer = data;
                // Intentar obtener roomCode de las rooms del socket
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
    
            console.log(`Processing answer for room: ${roomCode}`, answer);
    
            // Validar que tenemos roomCode y answer
            if (!roomCode) {
                throw new Error('Room code not provided and could not be determined from socket rooms');
            }
            
            if (!answer) {
                throw new Error('Answer not provided');
            }
    
            // Validar formato del roomCode
            if (!isValidRoomCode(roomCode)) {
                throw new Error(`Invalid room code format: ${roomCode}`);
            }
    
            // Verificar si la sala existe
            const room = rooms[roomCode];
            if (!room) {
                throw new Error(`Room ${roomCode} not found`);
            }
    
            // Verificar si el usuario está en la sala
            if (!room.users.includes(socket.id)) {
                throw new Error(`User ${socket.id} not in room ${roomCode}`);
            }
    
            // Encontrar el otro usuario en la sala (debería ser el host)
            const otherUser = room.users.find(id => id !== socket.id);
            if (!otherUser) {
                throw new Error('No other user in room to send answer to');
            }
    
            // Verificar que el answer tenga un formato válido
            if (!answer.type || answer.type !== 'answer' || !answer.sdp) {
                console.warn('Received malformed answer:', answer);
                throw new Error('Invalid answer format');
            }
    
            console.log(`Forwarding answer from ${socket.id} to ${otherUser} in room ${roomCode}`);
            
            // Enviar el answer al otro usuario
            socket.to(otherUser).emit('answer', {
                senderId: socket.id,
                answer: answer,
                roomCode: roomCode
            });
    
            // Actualizar último tiempo de actividad de la sala
            rooms[roomCode].lastUpdated = Date.now();
    
        } catch (error) {
            console.error('Error in answer handler:', {
                error: error.message,
                socketId: socket.id,
                data: data,
                rooms: socket.rooms
            });
            
            // Enviar error al cliente solo si el socket está conectado
            if (socket.connected) {
                socket.emit('answerError', {
                    error: error.message,
                    details: {
                        roomCode: data.roomCode || (Array.from(socket.rooms).filter(room => room !== socket.id)[0]),
                        answer: data.answer || (typeof data === 'object' ? data : arguments[1])
                    }
                });
            }
        }
    });

    const verifyConnection = (socket, roomCode) => {
        if (!socket.connected) return false;
        if (!isValidRoomCode(roomCode)) return false;
        if (!rooms[roomCode]) return false;
        if (!rooms[roomCode].users.includes(socket.id)) return false;
        return true;
    };
    socket.on('iceCandidate', (data) => {
        try {
            console.log('Received ICE candidate event:', data);
    
            // Extraer roomCode y candidate de diferentes formatos
            let roomCode, candidate;
            
            // Caso 1: Datos vienen como objeto con roomCode y candidate
            if (typeof data === 'object' && data.roomCode && data.candidate) {
                roomCode = data.roomCode;
                candidate = data.candidate;
            } 
            // Caso 2: Datos vienen solo con candidate (obtenemos roomCode de las rooms del socket)
            else if (typeof data === 'object' && data.candidate) {
                candidate = data.candidate;
                // Buscar roomCode en las rooms del socket (excluyendo su propia room)
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
            // Caso 3: Formato antiguo (roomCode como primer parámetro, candidate como segundo)
            else {
                roomCode = data;
                candidate = arguments[1];
            }
    
            // Si aún no tenemos roomCode, buscar en las rooms del socket
            if (!roomCode) {
                const socketRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                if (socketRooms.length > 0) {
                    roomCode = socketRooms[0];
                }
            }
    
            console.log(`Processing ICE candidate for room: ${roomCode}`, candidate);
    
            // Validar que tenemos roomCode y candidate
            if (!roomCode) {
                throw new Error('Room code not provided and could not be determined from socket rooms');
            }
            
            if (!candidate) {
                throw new Error('ICE candidate not provided');
            }
    
            // Validar formato del roomCode
            if (!isValidRoomCode(roomCode)) {
                throw new Error(`Invalid room code format: ${roomCode}`);
            }
    
            // Verificar si el socket está conectado
            if (!socket.connected) {
                throw new Error('Socket not connected');
            }
    
            // Verificar si la sala existe
            const room = rooms[roomCode];
            if (!room) {
                throw new Error(`Room ${roomCode} not found`);
            }
    
            // Verificar si el usuario está en la sala
            if (!room.users.includes(socket.id)) {
                throw new Error(`User ${socket.id} not in room ${roomCode}`);
            }
    
            // Encontrar el otro usuario en la sala
            const otherUser = room.users.find(id => id !== socket.id);
            if (!otherUser) {
                throw new Error('No other user in room to send candidate to');
            }
    
            // Verificar que el candidate tenga un formato válido
            if (!candidate.candidate || !candidate.sdpMid) {
                console.warn('Received malformed ICE candidate:', candidate);
                throw new Error('Invalid ICE candidate format');
            }
    
            console.log(`Forwarding ICE candidate from ${socket.id} to ${otherUser} in room ${roomCode}`);
            
            // Enviar el candidate al otro usuario
            socket.to(otherUser).emit('iceCandidate', {
                senderId: socket.id,
                candidate: candidate,
                roomCode: roomCode
            });
    
            // Actualizar último tiempo de actividad de la sala
            rooms[roomCode].lastUpdated = Date.now();
    
        } catch (error) {
            console.error('Error in iceCandidate handler:', {
                error: error.message,
                socketId: socket.id,
                data: data,
                rooms: socket.rooms
            });
            
            // Enviar error al cliente solo si el socket está conectado
            if (socket.connected) {
                socket.emit('iceCandidateError', {
                    error: error.message,
                    details: {
                        roomCode: data.roomCode || (Array.from(socket.rooms).filter(room => room !== socket.id)[0]),
                        candidate: data.candidate || (typeof data === 'object' ? data : arguments[1])
                    }
                });
            }
        }
    });
    // Leave room handler
    socket.on('leaveRoom', (roomCode) => {
        try {
            if (!rooms[roomCode]) return;

            // Remove user from room
            rooms[roomCode].users = rooms[roomCode].users.filter(id => id !== socket.id);
            rooms[roomCode].lastUpdated = Date.now(); // Update last updated time

            // If host left, assign new host
            if (socket.id === rooms[roomCode].host && rooms[roomCode].users.length > 0) {
                rooms[roomCode].host = rooms[roomCode].users[0];
                io.to(rooms[roomCode].host).emit('promotedToHost');
            }

            socket.leave(roomCode);
            console.log(`User ${socket.id} left room ${roomCode}`);

            // Notify remaining player
            socket.to(roomCode).emit('playerLeft', {
                playerId: socket.id,
                newHost: rooms[roomCode].host
            });

            // Clean up empty rooms
            if (rooms[roomCode].users.length === 0) {
                delete rooms[roomCode];
            }
        } catch (error) {
            console.error('Error in leaveRoom:', error.message);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        clearInterval(heartbeatInterval);
        // Find and clean up all rooms this user was in
        for (const roomCode in rooms) {
            if (rooms[roomCode].users.includes(socket.id)) {
                // Remove user from room
                rooms[roomCode].users = rooms[roomCode].users.filter(id => id !== socket.id);
                rooms[roomCode].lastUpdated = Date.now(); // Update last updated time
                // Assign new host if the host disconnected 
                if (socket.id === rooms[roomCode].host && rooms[roomCode].users.length > 0) {
                    rooms[roomCode].host = rooms[roomCode].users[0];
                    io.to(rooms[roomCode].host).emit('promotedHost');
                    console.log(`Room ${roomCode} have new host ${socket.id}`);
                }
                // Notify other users
                socket.to(roomCode).emit('playerDisconnected', {
                    playerId: socket.id,
                    newHost: rooms[roomCode].host || null
                });


                // Clean up empty rooms
                if (rooms[roomCode].users.length === 0) {
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} deleted (empty)`);
                }
                break;
            }
        }
    });
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        console.log('Socket state:', {
            connected: socket.connected,
            id: socket.id,
            rooms: socket.rooms
        });
    });
});

// Clean up inactive rooms periodically
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes

    for (const roomCode in rooms) {
        if (now - rooms[roomCode].createdAt > timeout && rooms[roomCode].status === 'waiting') {
            console.log(`Cleaning up inactive room ${roomCode}`);
            delete rooms[roomCode];
        }
    }
}, 60 * 1000); // Check every minute

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

