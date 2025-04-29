import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';

const ROOM_ID = 'chat-room'; // Must match server
const MAX_REMOTE_PEERS_DISPLAYED = 8; // For a 3x3 grid (1 local + 8 remote)

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
  const [isMuted, setIsMuted] = useState(true); // Muted by default

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

  // --- Mute/Unmute Logic ---
  const toggleMute = () => {
    if (!localStream) return;

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted; // Enable if it was muted, disable if it was unmuted
    });
    setIsMuted(!isMuted);
  };

  // Effect for Socket.IO connection and initial setup
  useEffect(() => {
    // Connect directly to the server; Socket.IO will use default path
    const newSocket = io();
    setSocket(newSocket);

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        // Set initial mute state for the obtained stream
        stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
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
      // No need to manually stop tracks here, new cleanup logic handles it

      // Close all peer connections and stop local stream on cleanup
      Object.values(peerConnections.current).forEach(pc => pc.close());
      peerConnections.current = {};
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      setLocalStream(null); // Clear local stream state
    };
    // isMuted is added to deps to correctly set initial state, but won't cause reconnects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]); // isMuted dependency is only needed for initial setup

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
    <div className="min-h-screen bg-gray-900">
      <h1 className="text-xl font-bold text-white p-2 text-center">WebRTC Chat Room (Room: {ROOM_ID})</h1>
      
      {/* Controls Area - positioned absolutely or differently if needed */}
      <div className="absolute top-2 left-2 z-20">
        <button 
          onClick={toggleMute} 
          className={`px-3 py-1 rounded font-semibold text-white text-sm ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-3 w-screen h-screen">
        {/* Local Video */}
        <div className="relative border border-gray-700 w-[calc(100vw/3)] h-[calc(100vh/3)]">
          <h2 className="absolute top-1 left-1 bg-black bg-opacity-60 text-white text-xs px-1 rounded z-10">You {isMuted ? '(Muted)' : ''}</h2>
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted // Keep video muted locally to prevent echo
            className="w-full h-full object-cover bg-black"
          ></video>
        </div>
        
        {/* Render remote videos */}
        {Object.entries(remoteStreams).map(([socketId, stream]) => (
          <div key={socketId} className="relative border border-gray-700 w-[calc(100vw/3)] h-[calc(100vh/3)]">
             <h2 className="absolute top-1 left-1 bg-black bg-opacity-60 text-white text-xs px-1 rounded z-10">Peer {socketId.substring(0, 4)}</h2>
            <video
              ref={ref => {
                if (ref && ref.srcObject !== stream) {
                  ref.srcObject = stream;
                }
              }}
              autoPlay
              playsInline
              className="w-full h-full object-cover bg-black"
            ></video>
          </div>
        ))}
        
        {/* Placeholder for empty slots */}
        {[...Array(Math.max(0, MAX_REMOTE_PEERS_DISPLAYED - Object.keys(remoteStreams).length))].map((_, i) => (
           <div key={`placeholder-${i}`} className="bg-gray-800 flex items-center justify-center border border-gray-700 w-[calc(100vw/3)] h-[calc(100vh/3)]">
             <span className="text-gray-500 text-sm">Waiting...</span>
           </div>
        ))}
      </div>
    </div>
  );
};

export default ChatPage; 