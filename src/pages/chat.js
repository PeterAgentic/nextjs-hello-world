import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
// TensorFlow.js and COCO-SSD imports
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl'; // Register WebGL backend
import '@tensorflow/tfjs-backend-cpu';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const ROOM_ID = 'chat-room'; // Must match server
const MAX_REMOTE_PEERS_DISPLAYED = 8; // For a 3x3 grid (1 local + 8 remote)

// Optional: Add STUN server configuration for better NAT traversal
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN servers here if needed for complex network scenarios
  ],
};

// --- TensorFlow.js Configuration ---
const DETECTION_INTERVAL_MS = 500; // How often to run detection (milliseconds)
const CONFIDENCE_THRESHOLD = 0.6; // Minimum confidence score to display a label

const ChatPage = () => {
  const localVideoRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const peerConnections = useRef({}); // Store peer connections { socketId: RTCPeerConnection }
  const [remoteStreams, setRemoteStreams] = useState({}); // Store remote streams { socketId: MediaStream }
  const [isMuted, setIsMuted] = useState(true); // Muted by default

  // --- TFJS State ---
  const [objectDetectionModel, setObjectDetectionModel] = useState(null);
  const [detectedObjectLabel, setDetectedObjectLabel] = useState('Loading model...');
  const detectionIntervalRef = useRef(null); // Ref to store the interval ID

  // --- Load TFJS Model ---
  useEffect(() => {
    const loadModel = async () => {
      try {
        setDetectedObjectLabel('Setting up TFJS backend...');
        await tf.setBackend('webgl');
        await tf.ready(); // Ensure backend is ready
        setDetectedObjectLabel('Loading COCO-SSD model...');
        const model = await cocoSsd.load();
        setObjectDetectionModel(model);
        setDetectedObjectLabel('Model loaded. Starting detection...');
        console.log('COCO-SSD model loaded successfully.');
      } catch (error) {
        console.error('Error loading TensorFlow.js model:', error);
        setDetectedObjectLabel('Error loading model.');
      }
    };
    loadModel();
  }, []);

  // --- Object Detection Loop ---
  const runObjectDetection = useCallback(async () => {
    if (!objectDetectionModel || !localVideoRef.current || localVideoRef.current.readyState < 2) {
      // Model or video not ready
      return;
    }

    try {
      const video = localVideoRef.current;
      const predictions = await objectDetectionModel.detect(video);

      let highestConfidenceLabel = 'No object detected';
      let highestScore = 0;

      if (predictions.length > 0) {
        predictions.forEach(prediction => {
          if (prediction.score > CONFIDENCE_THRESHOLD && prediction.score > highestScore) {
            highestScore = prediction.score;
            highestConfidenceLabel = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
          }
        });
      }
      setDetectedObjectLabel(highestConfidenceLabel);

    } catch (error) {
      // TFJS might throw errors if the video element state is weird
      console.warn('Detection failed (might be temporary): ', error);
    }
  }, [objectDetectionModel]);

  // --- Start/Stop Detection Interval ---
  useEffect(() => {
    if (objectDetectionModel && localStream) {
      // Start detection loop only when model and stream are ready
      detectionIntervalRef.current = setInterval(runObjectDetection, DETECTION_INTERVAL_MS);
      console.log('Started detection interval');
    } else {
      // Clear interval if model or stream becomes unavailable
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
        console.log('Cleared detection interval');
      }
    }

    // Cleanup interval on component unmount or when dependencies change
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        console.log('Cleaned up detection interval on unmount/deps change');
      }
    };
  }, [objectDetectionModel, localStream, runObjectDetection]);

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

      // Clear TFJS detection interval on full cleanup
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        console.log('Cleaned up detection interval on full unmount');
      }
    };
    // isMuted dependency is only needed for initial setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

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
      <h1 className="text-xl font-bold text-white p-2 text-center">Rush Roulette</h1>
      
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
          <div className="absolute top-1 left-1 flex items-center space-x-2 z-10">
            <h2 className="bg-black bg-opacity-60 text-white text-xs px-1 rounded">You {isMuted ? '(Muted)' : ''}</h2>
          </div>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted // Keep video muted locally to prevent echo
            className="w-full h-full object-cover bg-black"
          ></video>
          {/* Detection Label Area */}
          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs text-center p-1 truncate">
            {detectedObjectLabel}
          </div>
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