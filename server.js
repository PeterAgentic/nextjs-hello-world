const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost'; // Standard for Node servers
// Use Render's PORT environment variable; default to 3000 for local dev
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize the Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const ROOM_ID = 'chat-room'; // Keep our room logic

app.prepare().then(() => {
  // Create the HTTP server
  const httpServer = createServer((req, res) => {
    try {
      // Be sure to pass `true` as the second argument to `url.parse`.
      // This tells it to parse the query portion of the URL.
      const parsedUrl = parse(req.url, true);
      // Let Next.js handle the request
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize the Socket.IO server and attach it to the HTTP server
  const io = new Server(httpServer, {
    // No specific path needed, will use default /socket.io/
    cors: {
      origin: "*", // Adjust for production if needed
      methods: ["GET", "POST"]
    }
  });

  // Add the same Socket.IO connection logic as before
  io.on('connection', (socket) => {
    console.log(`>>> Socket connected: ${socket.id}`);

    socket.on('join-room', (roomId) => {
      if (roomId !== ROOM_ID) {
        console.log(`Socket ${socket.id} attempted to join invalid room: ${roomId}`);
        return;
      }
      console.log(`Socket ${socket.id} joining room ${roomId}`);
      socket.join(roomId);
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
      socket.emit('all-users', otherUsers);
      socket.to(roomId).emit('user-joined', socket.id);
    });

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

    socket.on('disconnect', () => {
      console.log(`<<< Socket disconnected: ${socket.id}`);
      io.to(ROOM_ID).emit('user-left', socket.id);
    });
  });

  // Start the HTTP server
  httpServer
    .listen(port, () => {
      console.log(`> Ready on http://localhost:${port}`);
    })
    .on('error', (err) => {
      console.error('HTTP Server error:', err);
      process.exit(1);
    });
}); 