import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';

const ROOM_ID = 'chat-room'; // Must match server
// Optional: Add STUN server configuration for better NAT traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN servers here if needed for complex network scenarios
  ],
};

const ChatPage = () => {
  const localVideoRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const peerConnections = useRef({}); // Store peer connections { socketId: RTCPeerConnection }
  const [remoteStreams, setRemoteStreams] = useState({}); // Store remote streams { socketId: MediaStream }
  const remoteVideoRefs = useRef({}); // Store refs for remote video elements { socketId: RefObject }

  // Helper to get or create refs for remote videos
  const getRemoteVideoRef = (socketId) => {
    if (!remoteVideoRefs.current[socketId]) {
      remoteVideoRefs.current[socketId] = React.createRef();
    }
    return remoteVideoRefs.current[socketId];
  };

  // Function to create a peer connection
  const createPeerConnection = useCallback((socketId) => {
    try {
      const pc = new RTCPeerConnection(iceServers);

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          console.log(`Sending ICE candidate to ${socketId}`);
          socket.emit('send-ice-candidate', {
            to: socketId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        console.log(`Received remote track from ${socketId}`);
        setRemoteStreams(prev => ({
          ...prev,
          [socketId]: event.streams[0],
        }));
      };

      // Add local stream tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          pc.addTrack(track, localStream);
        });
        console.log(`Added local tracks to PC for ${socketId}`);
      } else {
        console.warn('Local stream not available when creating peer connection for', socketId);
      }

      peerConnections.current[socketId] = pc;
      return pc;
    } catch (error) {
      console.error('Failed to create peer connection', error);
      return null;
    }
  }, [socket, localStream]);

  // Effect for Socket.IO connection and initial setup
  useEffect(() => {
    // Connect to the NEXT.JS API ROUTE. Let Socket.IO use its default path.
    const newSocket = io('/api/socket');
    setSocket(newSocket);

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        // Now that we have the stream, join the room
        console.log('Emitting join-room');
        newSocket.emit('join-room', ROOM_ID);
      })
      .catch(error => {
        console.error('Error accessing media devices.', error);
      });

    return () => {
      console.log('Cleaning up: disconnecting socket and stopping stream');
      if (newSocket) newSocket.disconnect();
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      // Close all peer connections on cleanup
      Object.values(peerConnections.current).forEach(pc => pc.close());
      peerConnections.current = {};
    };
    // localStream is intentionally omitted from deps here to avoid re-running on stream change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect for handling Socket.IO events
  useEffect(() => {
    if (!socket || !localStream) return; // Only run if socket and stream are ready

    // --- Socket Event Handlers ---
    socket.on('all-users', (allUserIds) => {
      console.log('Received all-users:', allUserIds);
      allUserIds.forEach(socketId => {
        if (!peerConnections.current[socketId]) {
          const pc = createPeerConnection(socketId);
          if (pc) {
            pc.createOffer()
              .then(offer => pc.setLocalDescription(offer))
              .then(() => {
                console.log(`Sending offer to ${socketId}`);
                socket.emit('send-offer', {
                  to: socketId,
                  signal: pc.localDescription,
                });
              })
              .catch(error => console.error('Error creating offer:', error));
          }
        }
      });
    });

    socket.on('user-joined', (socketId) => {
      console.log('User joined:', socketId);
      // Don't need to create offer here, the new user will send it
      // Just ensure a peer connection exists for them
      if (!peerConnections.current[socketId]) {
        createPeerConnection(socketId);
        console.log(`Created peer connection for joining user ${socketId}`);
      }
    });

    socket.on('get-offer', (payload) => {
      console.log(`Received offer from ${payload.from}`);
      let pc = peerConnections.current[payload.from];
      if (!pc) {
        pc = createPeerConnection(payload.from);
      }
      if(pc) {
        pc.setRemoteDescription(new RTCSessionDescription(payload.signal))
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => {
            console.log(`Sending answer to ${payload.from}`);
            socket.emit('send-answer', {
              to: payload.from,
              signal: pc.localDescription,
            });
          })
          .catch(error => console.error('Error handling offer/answer:', error));
      }
    });

    socket.on('get-answer', (payload) => {
      console.log(`Received answer from ${payload.from}`);
      const pc = peerConnections.current[payload.from];
      if (pc && !pc.currentRemoteDescription) {
        pc.setRemoteDescription(new RTCSessionDescription(payload.signal))
          .catch(error => console.error('Error setting remote description from answer:', error));
      }
    });

    socket.on('get-ice-candidate', (payload) => {
      console.log(`Received ICE candidate from ${payload.from}`);
      const pc = peerConnections.current[payload.from];
      if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
          .catch(error => console.error('Error adding received ICE candidate:', error));
      }
    });

    socket.on('user-left', (socketId) => {
      console.log('User left:', socketId);
      if (peerConnections.current[socketId]) {
        peerConnections.current[socketId].close();
        delete peerConnections.current[socketId];
      }
      setRemoteStreams(prev => {
        const newState = { ...prev };
        delete newState[socketId];
        return newState;
      });
      // Clean up video refs if needed
      delete remoteVideoRefs.current[socketId];
    });

    // --- Cleanup Socket Listeners ---
    return () => {
      socket.off('all-users');
      socket.off('user-joined');
      socket.off('get-offer');
      socket.off('get-answer');
      socket.off('get-ice-candidate');
      socket.off('user-left');
    };

  }, [socket, localStream, createPeerConnection]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">WebRTC Chat Room (Room: {ROOM_ID})</h1>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h2 className="text-lg font-semibold">You</h2>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-auto bg-black rounded shadow"></video>
        </div>
        {/* Render remote videos */}
        {Object.entries(remoteStreams).map(([socketId, stream]) => (
          <div key={socketId}>
            <h2 className="text-lg font-semibold">Peer {socketId.substring(0, 6)}</h2>
            <video
              ref={ref => {
                // Assign stream to video element when ref is available
                if (ref) {
                  ref.srcObject = stream;
                }
                // Store the ref itself if needed, although direct srcObject assignment often suffices
                // remoteVideoRefs.current[socketId] = ref;
              }}
              autoPlay
              playsInline
              className="w-full h-auto bg-black rounded shadow"
            ></video>
          </div>
        ))}
        {/* Placeholder for empty slots if needed */}
        {[...Array(Math.max(0, 3 - Object.keys(remoteStreams).length))].map((_, i) => (
           <div key={`placeholder-${i}`} className="bg-gray-200 p-2 rounded flex items-center justify-center aspect-video">
             <span className="text-gray-500">Waiting for peer...</span>
           </div>
        ))}
      </div>
    </div>
  );
};

export default ChatPage; 