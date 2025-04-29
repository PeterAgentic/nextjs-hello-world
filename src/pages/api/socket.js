import { Server } from 'socket.io';

const ROOM_ID = 'chat-room'; // Simple hardcoded room ID

const SocketHandler = (req, res) => {
  // Check if the socket server is already running
  if (res.socket.server.io) {
    console.log('Socket is already running');
  } else {
    console.log('Socket is initializing');
    // Adapt the server to Next.js HTTP server
    // Use default path ('/socket.io/')
    const io = new Server(res.socket.server, {
      path: '/api/socket_io', // Re-add explicit path
      addTrailingSlash: false, // Still potentially useful
      cors: {
        origin: "*", // Allow connections from any origin (adjust for production)
        methods: ["GET", "POST"]
      }
    });
    // Attach io instance to the server object
    res.socket.server.io = io;

    io.on('connection', (socket) => {
      console.log(`Socket connected: ${socket.id}`);

      // --- Room Joining Logic ---
      socket.on('join-room', (roomId) => {
        if (roomId !== ROOM_ID) {
          // Basic validation or handling for different rooms if needed later
          console.log(`Socket ${socket.id} attempted to join invalid room: ${roomId}`);
          return;
        }

        console.log(`Socket ${socket.id} joining room ${roomId}`);
        socket.join(roomId);

        // Get other users already in the room
        const clients = io.sockets.adapter.rooms.get(roomId);
        const otherUsers = [];
        if (clients) {
          clients.forEach(clientId => {
            if (clientId !== socket.id) {
              otherUsers.push(clientId);
            }
          });
        }
        console.log(`Other users in room ${roomId}:`, otherUsers);

        // Send list of other users to the new user
        socket.emit('all-users', otherUsers);

        // Notify other users that a new user has joined
        socket.to(roomId).emit('user-joined', socket.id);
      });

      // --- WebRTC Signaling Logic ---
      socket.on('send-offer', (payload) => {
        console.log(`Relaying offer from ${socket.id} to ${payload.to}`);
        io.to(payload.to).emit('get-offer', { signal: payload.signal, from: socket.id });
      });

      socket.on('send-answer', (payload) => {
        console.log(`Relaying answer from ${socket.id} to ${payload.to}`);
        io.to(payload.to).emit('get-answer', { signal: payload.signal, from: socket.id });
      });

      socket.on('send-ice-candidate', (payload) => {
        console.log(`Relaying ICE candidate from ${socket.id} to ${payload.to}`);
        io.to(payload.to).emit('get-ice-candidate', { candidate: payload.candidate, from: socket.id });
      });

      // --- Disconnect Logic ---
      socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        // Notify others in the room
        io.to(ROOM_ID).emit('user-left', socket.id);
        // Socket automatically leaves all rooms on disconnect
      });
    });
  }
  res.end();
};

export default SocketHandler; 