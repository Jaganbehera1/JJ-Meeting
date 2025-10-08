class VirtualClassroom {
    constructor() {
        this.localStream = null;
        this.screenStream = null;
        this.isVideoOn = true;
        this.isAudioOn = true;
        this.isScreenSharing = false;
        this.isHandRaised = false;
        
        this.userId = this.generateUserId();
        this.userName = '';
        this.userRole = 'student';
        this.roomId = '';
        
        // WebRTC
        this.peers = {};
        this.pendingSignals = new Set();
        this.iceCandidateQueue = new Map();
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        // Track screen sharing state
        this.screenSharingTeacherId = null;
        this.currentTeacherId = null;
        
        this.initializeApp();
    }

    generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 16);
    }

    initializeApp() {
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        // Video elements
        this.teacherVideo = document.getElementById('teacherVideo');
        this.participantsGrid = document.getElementById('participantsGrid');
        
        // Section elements
        this.teacherSection = document.getElementById('teacherSection');
        this.participantsSection = document.getElementById('participantsSection');
        
        // UI elements
        this.roomInfo = document.getElementById('roomInfo');
        this.userInfo = document.getElementById('userInfo');
        this.participantsCount = document.getElementById('participantsCount');
        this.teacherTitle = document.getElementById('teacherTitle');
        
        // Control buttons
        this.videoToggle = document.getElementById('videoToggle');
        this.audioToggle = document.getElementById('audioToggle');
        this.screenShareBtn = document.getElementById('screenShareBtn');
        this.raiseHandBtn = document.getElementById('raiseHandBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        
        // Modal elements
        this.joinModal = document.getElementById('joinModal');
        this.userNameInput = document.getElementById('userName');
        this.userRoleSelect = document.getElementById('userRole');
        this.roomIdInput = document.getElementById('roomId');
        this.joinClassBtn = document.getElementById('joinClassBtn');
    }

    setupEventListeners() {
        // Control buttons
        this.videoToggle.addEventListener('click', () => this.toggleVideo());
        this.audioToggle.addEventListener('click', () => this.toggleAudio());
        this.screenShareBtn.addEventListener('click', () => this.toggleScreenShare());
        this.raiseHandBtn.addEventListener('click', () => this.toggleRaiseHand());
        this.leaveBtn.addEventListener('click', () => this.leaveRoom());
        const toggleBtn = document.getElementById('toggleTeacherSize');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleTeacherMaximize());
        }
        
        // Modal buttons
        this.joinClassBtn.addEventListener('click', () => this.joinRoom());
        this.userNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    toggleTeacherMaximize() {
        // Only students can toggle maximizing teacher view
        if (this.userRole !== 'student') return;
        const isMax = this.teacherSection.classList.toggle('maximized');
        const btn = document.getElementById('toggleTeacherSize');
        if (btn) btn.title = isMax ? 'Minimize' : 'Maximize';
    }

    async initializeLocalStream(constraints = null) {
        try {
            if (!constraints) {
                constraints = {
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 30 }
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                };
            }

            // Stop existing stream if any
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            return this.localStream;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            if (error.name === 'NotReadableError') {
                alert('Camera or microphone is already in use by another application. Please close other applications using your camera/microphone and try again.');
            } else if (error.name === 'NotAllowedError') {
                alert('Camera and microphone permissions are required. Please allow access and try again.');
            } else {
                alert('Error accessing camera and microphone: ' + error.message);
            }
            throw error;
        }
    }

    async joinRoom() {
        this.userName = this.userNameInput.value.trim();
        this.userRole = this.userRoleSelect.value;
        this.roomId = this.roomIdInput.value.trim();

        if (!this.userName) {
            alert('Please enter your name');
            return;
        }

        if (!this.roomId) {
            alert('Please enter a room ID');
            return;
        }

        try {
            await this.initializeLocalStream();
            
            // Update UI based on role
            this.joinModal.classList.remove('active');
            this.roomInfo.textContent = `Room: ${this.roomId}`;
            this.userInfo.textContent = `${this.userName} (${this.userRole})`;
            
            // Show/hide sections based on role
            this.updateUIBasedOnRole();
            
            // Ensure teacher's local video is set in teacher section
            if (this.userRole === 'teacher' && this.localStream) {
                this.teacherVideo.srcObject = this.localStream;
                this.teacherTitle.textContent = `${this.userName}'s Screen`;
            }
            
            // Unlock autoplay so remote audio can play after first interaction
            this.installAudioUnlockOnce();
            
            // Initialize Firebase and WebRTC
            await this.initializeFirebase();
            this.setupFirebaseListeners();
            
            console.log(`Joined room ${this.roomId} as ${this.userName}`);
            
        } catch (error) {
            console.error('Error joining room:', error);
        }
    }

    updateUIBasedOnRole() {
        // Show both sections for all users
        this.teacherSection.style.display = 'flex';
        this.participantsSection.style.display = 'flex';
        
        // If user is teacher, set their local video in teacher section
        if (this.userRole === 'teacher' && this.localStream) {
            this.teacherVideo.srcObject = this.localStream;
            this.teacherTitle.textContent = `${this.userName}'s Screen`;
        }
    }

    installAudioUnlockOnce() {
        if (this._audioUnlockInstalled) return;
        this._audioUnlockInstalled = true;
        const tryUnlock = () => {
            const mediaEls = document.querySelectorAll('video, audio');
            mediaEls.forEach(el => {
                try {
                    el.muted = false;
                    const p = el.play();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                } catch (_) {}
            });
            document.removeEventListener('click', tryUnlock);
            document.removeEventListener('touchstart', tryUnlock);
            document.removeEventListener('keydown', tryUnlock);
        };
        document.addEventListener('click', tryUnlock, { once: true });
        document.addEventListener('touchstart', tryUnlock, { once: true });
        document.addEventListener('keydown', tryUnlock, { once: true });
    }

    async initializeFirebase() {
        const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
        
        // Set user data
        await userRef.set({
            name: this.userName,
            role: this.userRole,
            videoEnabled: this.isVideoOn,
            audioEnabled: this.isAudioOn,
            screenSharing: this.isScreenSharing,
            handRaised: this.isHandRaised,
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            lastActive: firebase.database.ServerValue.TIMESTAMP
        });

        // Set up onDisconnect for user removal
        userRef.onDisconnect().remove();

        // Set up onDisconnect for screen sharing if teacher
        if (this.userRole === 'teacher') {
            const screenShareRef = database.ref(`rooms/${this.roomId}/screenShare`);
            screenShareRef.onDisconnect().set({
                active: false
            });
        }
    }

    setupFirebaseListeners() {
        // Listen for participants
        this.participantsRef = database.ref(`rooms/${this.roomId}/participants`);
        this.participantsRef.on('child_added', (snapshot) => {
            this.handleParticipantJoined(snapshot);
        });

        this.participantsRef.on('child_changed', (snapshot) => {
            this.handleParticipantUpdated(snapshot);
        });

        this.participantsRef.on('child_removed', (snapshot) => {
            this.handleParticipantLeft(snapshot);
        });

        // Listen for WebRTC signals targeted to this user
        this.signalsRef = database.ref(`rooms/${this.roomId}/signals/${this.userId}`);
        this.signalsRef.on('child_added', (snapshot) => {
            this.handleSignal(snapshot);
        });

        // Listen for screen sharing
        this.screenShareRef = database.ref(`rooms/${this.roomId}/screenShare`);
        this.screenShareRef.on('value', (snapshot) => {
            this.handleScreenShareUpdate(snapshot);
        });

        // Find current teacher
        this.findCurrentTeacher();
    }

    async findCurrentTeacher() {
        const participantsSnapshot = await this.participantsRef.once('value');
        const participants = participantsSnapshot.val();
        
        if (participants) {
            for (const [participantId, participantData] of Object.entries(participants)) {
                if (participantData.role === 'teacher' && participantId !== this.userId) {
                    this.currentTeacherId = participantId;
                    console.log(`Found teacher: ${participantData.name} (${participantId})`);
                    break;
                }
            }
        }
    }

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        console.log(`Participant joined: ${participantData.name}, role: ${participantData.role}`);

        // Update teacher reference if this is a teacher
        if (participantData.role === 'teacher') {
            this.currentTeacherId = participantId;
        }

        // Determine connection type based on roles
        if (this.userRole === 'teacher' && participantData.role === 'student') {
            await this.createPeerConnection(participantId, true);
            this.addParticipantToGrid(participantId, participantData);
        } else if (this.userRole === 'student' && participantData.role === 'teacher') {
            await this.createPeerConnection(participantId, false);
        } else if (this.userRole === 'student' && participantData.role === 'student') {
            // Student-to-student connection: deterministic initiator to avoid glare
            const isInitiator = this.userId < participantId;
            await this.createPeerConnection(participantId, isInitiator);
            this.addParticipantToGrid(participantId, participantData);
        } else if (this.userRole === 'teacher' && participantData.role === 'teacher') {
            // Another teacher joined - handle accordingly
            console.log('Another teacher joined the room');
        }

        this.updateParticipantsCount();
    }

    handleParticipantUpdated(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        // Update participant in grid if teacher
        if (this.userRole === 'teacher') {
            this.updateParticipantInGrid(participantId, participantData);
        }

        // Handle screen sharing updates
        if (participantData.role === 'teacher' && this.userRole === 'student') {
            if (participantData.screenSharing) {
                this.teacherTitle.textContent = `${participantData.name} - Screen Sharing`;
            } else {
                this.teacherTitle.textContent = `${participantData.name}'s Screen`;
            }
        }
    }

    handleParticipantLeft(snapshot) {
        const participantId = snapshot.key;
        const participantData = snapshot.val();
        
        // Close peer connection
        this.closePeerConnection(participantId);
        
        // Remove from UI if teacher
        if (this.userRole === 'teacher') {
            this.removeParticipantFromGrid(participantId);
        }
        
        // If the teacher leaves, clear teacher video and find new teacher
        if (participantData.role === 'teacher') {
            if (this.userRole === 'student') {
                this.teacherVideo.srcObject = null;
                this.teacherTitle.textContent = "Teacher's Screen";
            }
            this.currentTeacherId = null;
            this.findCurrentTeacher();
        }
        
        this.updateParticipantsCount();
    }

    waitForLocalStream(peerId) {
      const interval = setInterval(() => {
        if (this.localStream) {
          this.localStream.getTracks().forEach(track => {
            if (this.peers[peerId]) {
              this.peers[peerId].addTrack(track, this.localStream);
            }
          });
          clearInterval(interval);
        }
      }, 500);
    }

    async createPeerConnection(peerId, isInitiator) {
        console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);
        
        // Close existing connection if any
        if (this.peers[peerId]) {
            this.closePeerConnection(peerId);
        }

        const peerConnection = new RTCPeerConnection(this.rtcConfig);
        this.peers[peerId] = peerConnection;

        // Initialize ICE candidate queue for this peer
        this.iceCandidateQueue.set(peerId, []);

        // Add current stream tracks
        const currentStream = this.isScreenSharing && this.screenStream ? this.screenStream : this.localStream;
        if (!currentStream) {
          console.warn('No local stream available yet — will attach later.');
          this.waitForLocalStream(peerId);
        }

        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, currentStream);
            });
        }

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (!remoteStream) return;
          this.handleRemoteStream(peerId, remoteStream);
          // Force refresh
          const videoEl = document.querySelector(`#participant-${peerId} video, #teacherVideo`);
          if (videoEl) {
            videoEl.srcObject = remoteStream;
            videoEl.play().catch(e => console.warn('Autoplay blocked:', e));
          }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidate = event.candidate;
                if (candidate.candidate && candidate.sdpMid !== null && candidate.sdpMLineIndex !== null) {
                    console.log(`Sending ICE candidate to ${peerId}`);
                    this.sendSignal(peerId, {
                        type: 'ice-candidate',
                        candidate: {
                            candidate: candidate.candidate,
                            sdpMid: candidate.sdpMid,
                            sdpMLineIndex: candidate.sdpMLineIndex
                        }
                    });
                }
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}: ${peerConnection.connectionState}`);
            
            if (peerConnection.connectionState === 'connected') {
                console.log(`✅ Successfully connected to ${peerId}`);
                // Clear ICE candidate queue on successful connection
                this.iceCandidateQueue.delete(peerId);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection with ${peerId} failed`);
                // Attempt to restart connection after a delay
                setTimeout(() => {
                    this.restartConnection(peerId);
                }, 2000);
            }
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                console.log(`Creating initial offer for ${peerId}`);
                // Small delay to ensure everything is ready
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                this.sendSignal(peerId, {
                    type: 'offer',
                    offer: offer
                });
            } catch (error) {
                console.error('Error creating initial offer:', error);
            }
        }

        return peerConnection;
    }

    async restartConnection(peerId) {
        console.log(`Restarting connection with ${peerId}`);
        this.closePeerConnection(peerId);
        
        // Re-fetch participant data
        const participantRef = database.ref(`rooms/${this.roomId}/participants/${peerId}`);
        const snapshot = await participantRef.once('value');
        const participantData = snapshot.val();
        
        if (participantData) {
            // Recreate connection with same initiator logic
            const isTeacherToStudent = this.userRole === 'teacher' && participantData.role === 'student';
            const isStudentToTeacher = this.userRole === 'student' && participantData.role === 'teacher';
            
            if (isTeacherToStudent || isStudentToTeacher) {
                await this.createPeerConnection(peerId, true);
            }
        }
    }

    async handleSignal(snapshot) {
        const signalData = snapshot.val();
        const signalId = snapshot.key;
        const fromUserId = signalData.from;
        
        // Remove signal after processing
        snapshot.ref.remove();

        if (fromUserId === this.userId) return;

        // Check if we've already processed this signal
        const signalKey = `${fromUserId}_${signalData.type}_${signalData.timestamp}`;
        if (this.pendingSignals.has(signalKey)) {
            console.log('Skipping duplicate signal:', signalKey);
            return;
        }

        this.pendingSignals.add(signalKey);
        
        // Clean up old signals
        setTimeout(() => {
            this.pendingSignals.delete(signalKey);
        }, 10000);

        const { type, offer, answer, candidate } = signalData;

        try {
            let peerConnection = this.peers[fromUserId];
            
            if (!peerConnection) {
                // Create a new peer connection for valid role combinations
                const participantRef = database.ref(`rooms/${this.roomId}/participants/${fromUserId}`);
                const snapshot = await participantRef.once('value');
                const participantData = snapshot.val();
                
                if (participantData) {
                    const isTeacherToStudent = this.userRole === 'teacher' && participantData.role === 'student';
                    const isStudentToTeacher = this.userRole === 'student' && participantData.role === 'teacher';
                    if (isTeacherToStudent || isStudentToTeacher) {
                      const initiator = this.userRole === 'teacher';
                      peerConnection = await this.createPeerConnection(fromUserId, initiator);
                    }
                }
            }

            if (peerConnection) {
                switch (type) {
                    case 'offer':
                        console.log(`Received offer from ${fromUserId}, current state: ${peerConnection.signalingState}`);

                        // If we currently have a local offer (glare), rollback first
                        if (peerConnection.signalingState === 'have-local-offer') {
                            try {
                                console.log('Glare detected — rolling back local offer to accept remote offer');
                                // Rollback local description so we can accept the incoming offer
                                await peerConnection.setLocalDescription({ type: 'rollback' });
                            } catch (rbErr) {
                                console.warn('Rollback failed (may not be supported in some browsers):', rbErr);
                            }
                        }
                    
                        // Now set remote description and answer
                        try {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                            const answerResponse = await peerConnection.createAnswer();
                            await peerConnection.setLocalDescription(answerResponse);
                        
                            this.sendSignal(fromUserId, {
                                type: 'answer',
                                answer: answerResponse
                            });
                        
                            // Process any queued ICE candidates
                            this.processQueuedIceCandidates(fromUserId, peerConnection);
                        } catch (err) {
                            console.error('Error handling incoming offer after glare handling:', err);
                        }
                        break;
                        
                    case 'answer':
                        console.log(`Received answer from ${fromUserId}, current state: ${peerConnection.signalingState}`);
                        
                        if (peerConnection.signalingState === 'have-local-offer') {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                            this.processQueuedIceCandidates(fromUserId, peerConnection);
                        }
                        break;
                        
                    case 'ice-candidate':
                        if (candidate && candidate.candidate && candidate.sdpMid !== null && candidate.sdpMLineIndex !== null) {
                            if (peerConnection.remoteDescription) {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                            } else {
                                console.log(`Queuing ICE candidate from ${fromUserId}`);
                                const queue = this.iceCandidateQueue.get(fromUserId) || [];
                                queue.push(candidate);
                                this.iceCandidateQueue.set(fromUserId, queue);
                            }
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('Error handling signal:', error);
            this.pendingSignals.delete(signalKey);
        }
    }

    async processQueuedIceCandidates(peerId, peerConnection) {
        const queue = this.iceCandidateQueue.get(peerId);
        if (queue && queue.length > 0) {
            console.log(`Processing ${queue.length} queued ICE candidates for ${peerId}`);
            for (const candidate of queue) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (error) {
                    console.error('Error adding queued ICE candidate:', error);
                }
            }
            this.iceCandidateQueue.set(peerId, []);
        }
    }

    sendSignal(toUserId, signal) {
        signal.from = this.userId;
        signal.timestamp = Date.now();
        
        const signalRef = database.ref(`rooms/${this.roomId}/signals/${toUserId}`).push();
        signalRef.set(signal);
        
        setTimeout(() => {
            signalRef.remove().catch(error => {
                console.log('Signal already removed:', error);
            });
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`Handling remote stream from ${peerId}`);
        
        // Don't handle our own stream
        if (peerId === this.userId) {
            return;
        }
        
        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                if (this.userRole === 'student' && participantData.role === 'teacher') {
                    // Student receiving teacher's stream - ONLY show in teacher video section
                    this.teacherVideo.srcObject = stream;
                    this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantData.name} - Screen Sharing`;
                    }
                } else if (this.userRole === 'teacher' && participantData.role === 'student') {
                    // Teacher receiving student's stream - show in participants grid ONLY
                    this.showParticipantVideo(peerId, stream);
                } else if (this.userRole === 'student' && participantData.role === 'student') {
                    // Student receiving another student's stream - show in participants grid
                    this.showParticipantVideo(peerId, stream);
                }
                
                // CRITICAL: Ensure teacher's video section is never overwritten by remote streams
                if (this.userRole === 'teacher' && this.localStream) {
                    // Always restore teacher's local video in teacher section
                    this.teacherVideo.srcObject = this.localStream;
                    this.teacherTitle.textContent = `${this.userName}'s Screen`;
                }
            }
        }).catch(error => {
            console.error('Error checking participant data:', error);
        });
    }

    showParticipantVideo(peerId, stream) {
        let participantCard = document.getElementById(`participant-${peerId}`);
        
        if (!participantCard) {
            // Create participant card if it doesn't exist
            participantCard = document.createElement('div');
            participantCard.className = 'participant-card';
            participantCard.id = `participant-${peerId}`;
            
            // Get participant data for name
            database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
                const participantData = snapshot.val();
                if (participantData) {
                    participantCard.innerHTML = `
                        <video class="participant-video" autoplay playsinline></video>
                        <div class="participant-info">
                            <span class="participant-name">${participantData.name}</span>
                            <div class="participant-status">
                                <span class="status-icon ${participantData.videoEnabled ? '' : 'status-muted'}">📹</span>
                                <span class="status-icon ${participantData.audioEnabled ? '' : 'status-muted'}">🎤</span>
                                ${participantData.handRaised ? '<span class="status-icon hand-raised">✋</span>' : ''}
                            </div>
                        </div>
                    `;
                    
                    const videoElement = participantCard.querySelector('.participant-video');
                    if (videoElement) {
                        videoElement.srcObject = stream;
                        videoElement.onloadedmetadata = () => {
                            videoElement.play().catch(e => console.log('Play error:', e));
                        };
                    }
                    
                    this.participantsGrid.appendChild(participantCard);
                    this.updateParticipantsCount();
                }
            });
        } else {
            // Update existing participant card
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
            }
        }
    }

    // Replace all video tracks in existing peer connections with screen share
    async replaceAllVideoTracks(newStream) {
        const videoTrack = newStream.getVideoTracks()[0];
        if (!videoTrack) return;

        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (sender) {
                    await sender.replaceTrack(videoTrack);
                } else {
                    peerConnection.addTrack(videoTrack, newStream);
                }
            } catch (error) {
                console.error(`Error replacing track for peer ${peerId}:`, error);
            }
        }
    }

    // Switch all video tracks back to camera
    async switchBackToCamera() {
        console.log("Switching back to camera...");
    
        // Ensure local camera stream exists
        if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
            console.log("Reinitializing camera after screen share stop...");
            this.localStream = await this.initializeLocalStream();
        }
    
        const cameraVideoTrack = this.localStream.getVideoTracks()[0];
        if (!cameraVideoTrack) {
            console.warn("No camera video track found!");
            return;
        }
    
        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                console.log(`Replacing video track for peer ${peerId}`);
                await sender.replaceTrack(cameraVideoTrack);
            
                // ✅ Force a keyframe to refresh remote display
                if (sender.track && sender.track.requestFrame) {
                    sender.track.requestFrame();
                } else if (sender.sendEncodings && sender.sendEncodings.length) {
                    // Some browsers (Chrome) can trigger keyframe this way
                    try {
                        await sender.setParameters(sender.getParameters());
                    } catch (err) {
                        console.warn("Keyframe trigger not supported:", err);
                    }
                }
            
                // 🚀 Optional: force re-offer only if remote doesn’t refresh
                setTimeout(async () => {
                    if (peerConnection.connectionState === 'connected') {
                        const offer = await peerConnection.createOffer();
                        await peerConnection.setLocalDescription(offer);
                        this.sendSignal(peerId, { type: 'offer', offer });
                    }
                }, 500);
            }
        }
    
        // Update teacher's local video in teacher section
        if (this.userRole === 'teacher' && this.localStream) {
            this.teacherVideo.srcObject = this.localStream;
            this.teacherTitle.textContent = `${this.userName}'s Screen`;
        }
    
        console.log("Camera track replaced for all peers.");
    }

    // UI Management
    addParticipantToGrid(participantId, participantData) {
        if (document.getElementById(`participant-${participantId}`)) return;

        const participantCard = document.createElement('div');
        participantCard.className = 'participant-card';
        participantCard.id = `participant-${participantId}`;

        participantCard.innerHTML = `
            <video class="participant-video" autoplay playsinline></video>
            <div class="participant-info">
                <span class="participant-name">${participantData.name}</span>
                <div class="participant-status">
                    <span class="status-icon ${participantData.videoEnabled ? '' : 'status-muted'}">📹</span>
                    <span class="status-icon ${participantData.audioEnabled ? '' : 'status-muted'}">🎤</span>
                    ${participantData.handRaised ? '<span class="status-icon hand-raised">✋</span>' : ''}
                </div>
            </div>
        `;

        this.participantsGrid.appendChild(participantCard);
    }

    updateParticipantInGrid(participantId, participantData) {
        const participantCard = document.getElementById(`participant-${participantId}`);
        if (participantCard) {
            const statusIcons = participantCard.querySelectorAll('.status-icon');
            const videoIcon = statusIcons[0];
            const audioIcon = statusIcons[1];
            
            if (videoIcon) {
                videoIcon.classList.toggle('status-muted', !participantData.videoEnabled);
            }
            if (audioIcon) {
                audioIcon.classList.toggle('status-muted', !participantData.audioEnabled);
            }
            
            // Handle raise hand
            let handIcon = participantCard.querySelector('.hand-raised');
            if (participantData.handRaised && !handIcon) {
                const newHandIcon = document.createElement('span');
                newHandIcon.className = 'status-icon hand-raised';
                newHandIcon.textContent = '✋';
                participantCard.querySelector('.participant-status').appendChild(newHandIcon);
            } else if (!participantData.handRaised && handIcon) {
                handIcon.remove();
            }
        }
    }

    removeParticipantFromGrid(participantId) {
        const participantCard = document.getElementById(`participant-${participantId}`);
        if (participantCard) {
            participantCard.remove();
        }
    }

    updateParticipantsCount() {
        const count = document.querySelectorAll('.participant-card').length;
        this.participantsCount.textContent = count;
    }

    closePeerConnection(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
            this.iceCandidateQueue.delete(peerId);
            console.log(`Closed connection with ${peerId}`);
        }
    }

    // Media Controls (keep all media control methods the same as before)
    async toggleVideo() {
        if (!this.localStream) return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            this.isVideoOn = !this.isVideoOn;
            videoTrack.enabled = this.isVideoOn;
            
            this.updateVideoButton();
            this.updateUserStatus();
        }
    }

    async toggleAudio() {
        if (!this.localStream) return;

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            this.isAudioOn = !this.isAudioOn;
            audioTrack.enabled = this.isAudioOn;
            
            this.updateAudioButton();
            this.updateUserStatus();
        }
    }

    async toggleScreenShare() {
        if (this.userRole !== 'teacher') {
            alert('Only teachers can share their screen.');
            return;
        }

        try {
            if (!this.isScreenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                    audio: true
                });

                await this.replaceAllVideoTracks(this.screenStream);
                this.isScreenSharing = true;

                await database.ref(`rooms/${this.roomId}/screenShare`).set({
                    active: true,
                    teacherId: this.userId,
                    teacherName: this.userName,
                    startedAt: firebase.database.ServerValue.TIMESTAMP
                });

                const videoTrack = this.screenStream.getVideoTracks()[0];
                videoTrack.onended = () => {
                    this.stopScreenShare();
                };

            } else {
                await this.stopScreenShare();
            }

            this.updateScreenShareButton();
            this.updateUserStatus();

        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name === 'NotAllowedError') {
                alert('Screen sharing was denied. Please allow screen sharing to continue.');
            } else if (error.name === 'AbortError') {
                console.log('Screen sharing was cancelled by user');
            } else {
                alert('Failed to start screen sharing. Please try again.');
            }
            
            // Reset state if screen sharing failed
            this.isScreenSharing = false;
            this.updateScreenShareButton();
        }
    }

     async stopScreenShare() {
         console.log("Stopping screen share...");
 
         // Stop all screen share tracks
         if (this.screenStream) {
             this.screenStream.getTracks().forEach(track => track.stop());
             this.screenStream = null;
         }
 
         // Mark state first so students clear frozen frame immediately
         await database.ref(`rooms/${this.roomId}/screenShare`).set({
             active: false,
             teacherId: null,
             teacherName: null,
             endedAt: firebase.database.ServerValue.TIMESTAMP
         });
 
         // Clear teacher video for students (will be restored by incoming camera ontrack)
         if (this.userRole === 'teacher') {
             if (this.teacherVideo) {
                 try { this.teacherVideo.pause(); } catch (_) {}
                 this.teacherVideo.srcObject = null;
                 this.teacherVideo.load();
             }
         }
 
         // Switch back to camera and update tracks to peers
         await this.switchBackToCamera();
         this.isScreenSharing = false;
         this.updateScreenShareButton();
 
         // Restore teacher's local preview element
         if (this.userRole === 'teacher' && this.localStream) {
             this.teacherVideo.srcObject = this.localStream;
             this.teacherTitle.textContent = `${this.userName}'s Screen`;
             try { this.teacherVideo.play().catch(() => {}); } catch (_) {}
             // Proactively re-offer to all peers to ensure cameras are re-negotiated
             for (const peerId of Object.keys(this.peers)) {
                 const pc = this.peers[peerId];
                 if (pc && pc.connectionState === 'connected') {
                     try {
                         const offer = await pc.createOffer({ iceRestart: true });
                         await pc.setLocalDescription(offer);
                         this.sendSignal(peerId, { type: 'offer', offer });
                     } catch (_) {}
                 }
             }
         }
 
         console.log("Screen share stopped and camera restored.");
     }


    async toggleRaiseHand() {
        this.isHandRaised = !this.isHandRaised;
        this.updateRaiseHandButton();
        this.updateUserStatus();
    }

    handleScreenShareUpdate(snapshot) {
        const screenData = snapshot.val();
        if (screenData && screenData.active && screenData.teacherId !== this.userId) {
            this.screenSharingTeacherId = screenData.teacherId;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = `${screenData.teacherName} - Screen Sharing`;
            }
        } else if (!screenData || !screenData.active) {
            // Screen share ended – ensure students see the teacher's camera again
            this.screenSharingTeacherId = null;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = "Teacher's Screen";
                const teacherId = this.currentTeacherId || (screenData ? screenData.teacherId : null);
                const pc = teacherId ? this.peers[teacherId] : null;
                if (pc) {
                    // Prefer full remote stream from ontrack if already attached
                    if (this.teacherVideo && this.teacherVideo.srcObject instanceof MediaStream && this.teacherVideo.srcObject.getVideoTracks().length > 0) {
                        try { this.teacherVideo.play().catch(() => {}); } catch (_) {}
                    } else {
                        const receiver = pc.getReceivers().find(r => r.track && r.track.kind === 'video');
                        if (receiver && receiver.track) {
                            const stream = new MediaStream([receiver.track]);
                            this.teacherVideo.srcObject = stream;
                            try { this.teacherVideo.play().catch(() => {}); } catch (_) {}
                        }
                    }
                }
            } else if (this.userRole === 'teacher') {
                // Teacher should see their own local video, not remote streams
                if (this.localStream) {
                    this.teacherVideo.srcObject = this.localStream;
                    this.teacherTitle.textContent = `${this.userName}'s Screen`;
                    try { this.teacherVideo.play().catch(() => {}); } catch (_) {}
                }
            }
        }
    }

    updateVideoButton() {
        const icon = this.isVideoOn ? '📹' : '❌';
        const text = this.isVideoOn ? 'Stop Video' : 'Start Video';
        this.videoToggle.querySelector('.control-icon').textContent = icon;
        this.videoToggle.querySelector('.control-text').textContent = text;
        this.videoToggle.classList.toggle('control-active', this.isVideoOn);
    }

    updateAudioButton() {
        const icon = this.isAudioOn ? '🎤' : '🔇';
        const text = this.isAudioOn ? 'Mute' : 'Unmute';
        this.audioToggle.querySelector('.control-icon').textContent = icon;
        this.audioToggle.querySelector('.control-text').textContent = text;
        this.audioToggle.classList.toggle('control-active', this.isAudioOn);
    }

    updateScreenShareButton() {
        const icon = this.isScreenSharing ? '🛑' : '🖥️';
        const text = this.isScreenSharing ? 'Stop Share' : 'Share Screen';
        this.screenShareBtn.querySelector('.control-icon').textContent = icon;
        this.screenShareBtn.querySelector('.control-text').textContent = text;
        this.screenShareBtn.classList.toggle('control-active', this.isScreenSharing);
    }

    updateRaiseHandButton() {
        const text = this.isHandRaised ? 'Lower Hand' : 'Raise Hand';
        this.raiseHandBtn.querySelector('.control-text').textContent = text;
        this.raiseHandBtn.classList.toggle('control-active', this.isHandRaised);
    }

    async updateUserStatus() {
        const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
        await userRef.update({
            videoEnabled: this.isVideoOn,
            audioEnabled: this.isAudioOn,
            screenSharing: this.isScreenSharing,
            handRaised: this.isHandRaised,
            lastActive: firebase.database.ServerValue.TIMESTAMP
        });
    }

    async leaveRoom() {
        if (confirm('Are you sure you want to leave the classroom?')) {
            Object.keys(this.peers).forEach(peerId => {
                this.closePeerConnection(peerId);
            });

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
            }

            if (this.participantsRef) this.participantsRef.off();
            if (this.signalsRef) this.signalsRef.off();
            if (this.screenShareRef) this.screenShareRef.off();

            const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
            await userRef.remove();

            if (this.userRole === 'teacher' && this.isScreenSharing) {
                await database.ref(`rooms/${this.roomId}/screenShare`).set({ active: false });
            }

            location.reload();
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.virtualClassroom = new VirtualClassroom();
});