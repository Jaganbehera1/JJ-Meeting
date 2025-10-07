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
        
        // Track connection attempts to prevent duplicates
        this.connectionAttempts = new Map();
        
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
        
        // Modal buttons
        this.joinClassBtn.addEventListener('click', () => this.joinRoom());
        this.userNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
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
            console.log('✅ Local stream initialized with tracks:', this.localStream.getTracks().length);
            return this.localStream;
        } catch (error) {
            console.error('❌ Error accessing media devices:', error);
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
            
            // Clean up old room data first
            await this.cleanupOldRoomData();
            
            // Initialize Firebase and WebRTC
            await this.initializeFirebase();
            this.setupFirebaseListeners();
            
            console.log(`✅ Joined room ${this.roomId} as ${this.userName}`);
            
        } catch (error) {
            console.error('❌ Error joining room:', error);
        }
    }

    updateUIBasedOnRole() {
        if (this.userRole === 'teacher') {
            // Teacher sees only students grid
            this.teacherSection.style.display = 'none';
            this.participantsSection.style.display = 'flex';
        } else {
            // Student sees only teacher's video
            this.teacherSection.style.display = 'flex';
            this.participantsSection.style.display = 'none';
        }
    }

    async cleanupOldRoomData() {
        try {
            // Only clear stale incoming signals for this user; do NOT remove the entire room
            const mySignalsRef = database.ref(`rooms/${this.roomId}/signals/${this.userId}`);
            await mySignalsRef.remove();
            console.log('🧹 Cleared my stale incoming signals');

            // If teacher joins and room has no participants yet, optionally clear room-level transient data
            if (this.userRole === 'teacher') {
                const participantsSnap = await database.ref(`rooms/${this.roomId}/participants`).once('value');
                if (!participantsSnap.exists()) {
                    // Clean transient signaling/screenShare but keep structure
                    await database.ref(`rooms/${this.roomId}/signals`).remove().catch(() => {});
                    await database.ref(`rooms/${this.roomId}/screenShare`).set({ active: false }).catch(() => {});
                    console.log('🧹 Teacher prepped empty room (cleared signals, reset screenShare)');
                }
            }
        } catch (error) {
            console.log('ℹ️ No old signals to clean up or error:', error);
        }
    }

    async initializeFirebase() {
        const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
        
        // Set complete user data with proper structure
        const userData = {
            name: this.userName,
            role: this.userRole,
            videoEnabled: this.isVideoOn,
            audioEnabled: this.isAudioOn,
            screenSharing: this.isScreenSharing,
            handRaised: this.isHandRaised,
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            lastActive: firebase.database.ServerValue.TIMESTAMP
        };

        console.log('💾 Saving user data to Firebase:', userData);
        
        // Set user data
        await userRef.set(userData);

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
        console.log('🔌 Setting up Firebase listeners...');
        
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

        // Connect to existing participants after a delay
        setTimeout(() => {
            this.connectToExistingParticipants();
        }, 3000);
    }

    async connectToExistingParticipants() {
        try {
            const participantsSnapshot = await this.participantsRef.once('value');
            const participants = participantsSnapshot.val();

            if (!participants) {
                console.log('👥 No existing participants found');
                return;
            }

            console.log(`👥 Found ${Object.keys(participants).length} existing participants`);

            for (const [participantId, participantData] of Object.entries(participants)) {
                if (participantId === this.userId) continue;

                // Skip if already connected or attempting to connect
                if (this.peers[participantId] || this.connectionAttempts.has(participantId)) {
                    console.log(`🔗 Already connected/connecting to ${participantId}, skipping`);
                    continue;
                }

                const participantName = participantData.name;
                const participantRole = participantData.role;

                console.log(`👤 Processing existing participant: ${participantName} (${participantRole})`);

                // Student connects to teacher
                if (this.userRole === 'student' && participantRole === 'teacher') {
                    console.log(`🎓 Student connecting to teacher: ${participantName}`);
                    this.connectionAttempts.set(participantId, true);
                    await this.createPeerConnection(participantId, true);
                    this.currentTeacherId = participantId;
                }
                // Teacher connects to students
                else if (this.userRole === 'teacher' && participantRole === 'student') {
                    console.log(`👨‍🏫 Teacher connecting to student: ${participantName}`);
                    this.connectionAttempts.set(participantId, true);
                    await this.createPeerConnection(participantId, true);
                    this.addParticipantToGrid(participantId, participantData);
                }
            }

            this.updateParticipantsCount();
        } catch (error) {
            console.error('❌ Error connecting to existing participants:', error);
        }
    }

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        const participantName = participantData.name;
        const participantRole = participantData.role;

        console.log(`👋 Participant joined: ${participantName}, role: ${participantRole}`);

        // Skip if already connected or attempting to connect
        if (this.peers[participantId] || this.connectionAttempts.has(participantId)) {
            console.log(`🔗 Already connected/connecting to ${participantId}, skipping`);
            return;
        }

        // Student connects to teacher
        if (this.userRole === 'student' && participantRole === 'teacher') {
            console.log(`🎓 Student connecting to new teacher: ${participantName}`);
            this.connectionAttempts.set(participantId, true);
            await this.createPeerConnection(participantId, true);
            this.currentTeacherId = participantId;
        }
        // Teacher connects to students
        else if (this.userRole === 'teacher' && participantRole === 'student') {
            console.log(`👨‍🏫 Teacher connecting to new student: ${participantName}`);
            this.connectionAttempts.set(participantId, true);
            await this.createPeerConnection(participantId, true);
            this.addParticipantToGrid(participantId, participantData);
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
        
        console.log(`👋 Participant left: ${participantData?.name} (${participantId})`);
        
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
        }
        
        this.updateParticipantsCount();
    }

    async createPeerConnection(peerId, isInitiator) {
        console.log(`🔗 Creating peer connection with ${peerId}, initiator: ${isInitiator}`);

        // Close existing connection if any
        if (this.peers[peerId]) {
            console.log(`🔄 Closing existing connection with ${peerId}`);
            this.closePeerConnection(peerId);
        }

        const peerConnection = new RTCPeerConnection(this.rtcConfig);
        this.peers[peerId] = peerConnection;

        // Initialize ICE candidate queue for this peer
        this.iceCandidateQueue.set(peerId, []);

        // Add current stream tracks
        const currentStream = this.isScreenSharing && this.screenStream ? this.screenStream : this.localStream;
        if (currentStream) {
            console.log(`📹 Adding ${currentStream.getTracks().length} tracks to peer ${peerId}`);
            currentStream.getTracks().forEach(track => {
                if (track.readyState === 'live') {
                    try {
                        peerConnection.addTrack(track, currentStream);
                    } catch (error) {
                        console.log(`ℹ️ Track already added to ${peerId}`);
                    }
                }
            });
        }

        // Track if we've already processed streams for this connection
        let streamsProcessed = false;

        // Handle incoming stream - FIXED: Prevent duplicate stream processing
        peerConnection.ontrack = (event) => {
            if (streamsProcessed) {
                console.log(`⏭️ Stream already processed for ${peerId}, skipping`);
                return;
            }
            streamsProcessed = true;
            
            console.log('📹 Received remote stream from:', peerId);
            const [remoteStream] = event.streams;
            if (remoteStream) {
                this.handleRemoteStream(peerId, remoteStream);
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`🧊 Sending ICE candidate to ${peerId}`);
                this.sendSignal(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`🔗 Connection state with ${peerId}: ${peerConnection.connectionState}`);
            
            if (peerConnection.connectionState === 'connected') {
                console.log(`✅ Successfully connected to ${peerId}`);
                this.iceCandidateQueue.delete(peerId);
                this.connectionAttempts.delete(peerId);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection failed with ${peerId}`);
                this.connectionAttempts.delete(peerId);
                setTimeout(() => {
                    this.restartConnection(peerId);
                }, 5000);
            } else if (peerConnection.connectionState === 'closed') {
                console.log(`🔒 Connection closed with ${peerId}`);
                this.connectionAttempts.delete(peerId);
                if (this.peers[peerId] === peerConnection) {
                    delete this.peers[peerId];
                    this.iceCandidateQueue.delete(peerId);
                }
            }
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                console.log(`📨 Creating initial offer for ${peerId}`);
                
                // Wait a bit to ensure everything is ready
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                this.sendSignal(peerId, {
                    type: 'offer',
                    offer: offer
                });
                
                console.log(`✅ Offer created and sent to ${peerId}`);
            } catch (error) {
                console.error('❌ Error creating initial offer:', error);
                this.connectionAttempts.delete(peerId);
            }
        }

        return peerConnection;
    }

    async restartConnection(peerId) {
        console.log(`🔄 Restarting connection with ${peerId}`);
        
        this.closePeerConnection(peerId);
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        try {
            const participantRef = database.ref(`rooms/${this.roomId}/participants/${peerId}`);
            const snapshot = await participantRef.once('value');
            const participantData = snapshot.val();
            
            if (participantData && !this.connectionAttempts.has(peerId)) {
                const participantRole = participantData.role;
                const shouldReconnect = 
                    (this.userRole === 'teacher' && participantRole === 'student') ||
                    (this.userRole === 'student' && participantRole === 'teacher');
                
                if (shouldReconnect) {
                    console.log(`🔄 Reconnecting to ${participantData.name}`);
                    this.connectionAttempts.set(peerId, true);
                    await this.createPeerConnection(peerId, true);
                }
            }
        } catch (error) {
            console.error(`❌ Error restarting connection with ${peerId}:`, error);
            this.connectionAttempts.delete(peerId);
        }
    }

    async handleSignal(snapshot) {
        const signalData = snapshot.val();
        const fromUserId = signalData.from;
        
        // Remove signal after processing
        snapshot.ref.remove();

        if (fromUserId === this.userId) return;

        const signalKey = `${fromUserId}_${signalData.type}_${signalData.timestamp}`;
        if (this.pendingSignals.has(signalKey)) {
            console.log('⏭️ Skipping duplicate signal:', signalKey);
            return;
        }

        this.pendingSignals.add(signalKey);
        
        setTimeout(() => {
            this.pendingSignals.delete(signalKey);
        }, 10000);

        const { type, offer, answer, candidate } = signalData;

        console.log(`📨 Received ${type} signal from ${fromUserId}`);

        try {
            let peerConnection = this.peers[fromUserId];
            
            if (!peerConnection && !this.connectionAttempts.has(fromUserId)) {
                console.log(`🔗 Creating new peer connection for signal from ${fromUserId}`);
                
                const participantRef = database.ref(`rooms/${this.roomId}/participants/${fromUserId}`);
                const snapshot = await participantRef.once('value');
                const participantData = snapshot.val();
                
                if (participantData) {
                    const participantRole = participantData.role;
                    const shouldConnect = 
                        (this.userRole === 'teacher' && participantRole === 'student') ||
                        (this.userRole === 'student' && participantRole === 'teacher');
                    
                    if (shouldConnect) {
                        this.connectionAttempts.set(fromUserId, true);
                        peerConnection = await this.createPeerConnection(fromUserId, false);
                    }
                }
            }

            if (peerConnection) {
                switch (type) {
                    case 'offer':
                        console.log(`📨 Processing offer from ${fromUserId}, current state: ${peerConnection.signalingState}`);
                        if (peerConnection.signalingState === 'stable' || peerConnection.signalingState === 'have-remote-offer') {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                            const answerResponse = await peerConnection.createAnswer();
                            await peerConnection.setLocalDescription(answerResponse);
                            
                            this.sendSignal(fromUserId, {
                                type: 'answer',
                                answer: answerResponse
                            });
                            
                            console.log(`✅ Sent answer to ${fromUserId}`);
                            this.processQueuedIceCandidates(fromUserId, peerConnection);
                        }
                        break;
                        
                    case 'answer':
                        console.log(`📨 Processing answer from ${fromUserId}, current state: ${peerConnection.signalingState}`);
                        if (peerConnection.signalingState === 'have-local-offer' || peerConnection.signalingState === 'stable') {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                            console.log(`✅ Set remote description from ${fromUserId}`);
                            this.processQueuedIceCandidates(fromUserId, peerConnection);
                        }
                        break;
                        
                    case 'ice-candidate':
                        if (candidate) {
                            if (peerConnection.remoteDescription) {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                                console.log(`🧊 Added ICE candidate from ${fromUserId}`);
                            } else {
                                console.log(`⏳ Queuing ICE candidate from ${fromUserId}`);
                                const queue = this.iceCandidateQueue.get(fromUserId) || [];
                                queue.push(candidate);
                                this.iceCandidateQueue.set(fromUserId, queue);
                            }
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('❌ Error handling signal:', error);
            this.pendingSignals.delete(signalKey);
            this.connectionAttempts.delete(fromUserId);
        }
    }

    async processQueuedIceCandidates(peerId, peerConnection) {
        const queue = this.iceCandidateQueue.get(peerId);
        if (queue && queue.length > 0) {
            console.log(`🧊 Processing ${queue.length} queued ICE candidates for ${peerId}`);
            for (const candidate of queue) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (error) {
                    console.error('❌ Error adding queued ICE candidate:', error);
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
        
        console.log(`📨 Sent ${signal.type} signal to ${toUserId}`);
        
        setTimeout(() => {
            signalRef.remove().catch(() => {});
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`📹 Handling remote stream from ${peerId}`);

        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                const participantName = participantData.name;
                const participantRole = participantData.role;

                if (this.userRole === 'student' && participantRole === 'teacher') {
                    // Student receiving teacher's stream
                    console.log(`🎓 Student: Setting teacher video stream from ${participantName}`);
                    this.teacherVideo.srcObject = stream;
                    this.teacherVideo.style.display = 'block';
                    
                    this.teacherVideo.onloadedmetadata = () => {
                        console.log(`🎓 Teacher video metadata loaded`);
                        this.teacherVideo.play().catch(e => console.log('Play error:', e));
                    };
                    
                    this.teacherVideo.oncanplay = () => {
                        console.log(`🎓 Teacher video can play`);
                    };
                    
                    this.teacherTitle.textContent = `${participantName}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantName} - Screen Sharing`;
                    }
                    
                } else if (this.userRole === 'teacher' && participantRole === 'student') {
                    // Teacher receiving student's stream
                    console.log(`👨‍🏫 Teacher: Showing student video from ${participantName}`);
                    this.showParticipantVideo(peerId, stream, participantData);
                }
            }
        }).catch(error => {
            console.error('❌ Error checking participant data:', error);
        });
    }

    showParticipantVideo(peerId, stream, participantData) {
        let participantCard = document.getElementById(`participant-${peerId}`);
        
        if (!participantCard) {
            participantCard = document.createElement('div');
            participantCard.className = 'participant-card';
            participantCard.id = `participant-${peerId}`;
            
            const participantName = participantData.name;
            
            participantCard.innerHTML = `
                <video class="participant-video" autoplay playsinline></video>
                <div class="participant-info">
                    <span class="participant-name">${participantName}</span>
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
                videoElement.style.display = 'block';
                videoElement.onloadedmetadata = () => {
                    console.log(`📹 Student video metadata loaded for ${participantName}`);
                    videoElement.play().catch(e => console.log('Play error:', e));
                };
                
                videoElement.oncanplay = () => {
                    console.log(`📹 Student video can play for ${participantName}`);
                };
            }
            
            this.participantsGrid.appendChild(participantCard);
            this.updateParticipantsCount();
            console.log(`✅ Added student ${participantName} to grid`);
        } else {
            // Update existing participant card
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.style.display = 'block';
            }
        }
    }

    // UI Management
    addParticipantToGrid(participantId, participantData) {
        if (document.getElementById(`participant-${participantId}`)) return;

        const participantCard = document.createElement('div');
        participantCard.className = 'participant-card';
        participantCard.id = `participant-${participantId}`;

        participantCard.innerHTML = `
            <div class="video-placeholder">
                <div class="placeholder-content">
                    <div class="placeholder-icon">👤</div>
                    <div>Waiting for video...</div>
                </div>
            </div>
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
            this.connectionAttempts.delete(peerId);
            console.log(`🔒 Closed connection with ${peerId}`);
        }
    }

    // Media Controls (remaining methods same as before)
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

                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (!videoTrack) {
                    throw new Error('No video track in screen share stream');
                }

                await this.replaceAllVideoTracks(this.screenStream);
                this.isScreenSharing = true;

                await database.ref(`rooms/${this.roomId}/screenShare`).set({
                    active: true,
                    teacherId: this.userId,
                    teacherName: this.userName,
                    startedAt: firebase.database.ServerValue.TIMESTAMP
                });

                videoTrack.onended = () => {
                    this.stopScreenShare();
                    this.updateScreenShareButton();
                };

            } else {
                await this.stopScreenShare();
            }

            this.updateScreenShareButton();
            this.updateUserStatus();

        } catch (error) {
            console.error('❌ Error sharing screen:', error);
            if (error.name !== 'NotAllowedError') {
                alert('Error sharing screen: ' + error.message);
            }
        }
    }

    async stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }

        await this.switchBackToCamera();
        this.isScreenSharing = false;

        await database.ref(`rooms/${this.roomId}/screenShare`).set({
            active: false
        });

        this.updateUserStatus();
    }

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
                console.error(`❌ Error replacing track for peer ${peerId}:`, error);
            }
        }
    }

    async switchBackToCamera() {
        if (!this.localStream) return;

        const cameraVideoTrack = this.localStream.getVideoTracks()[0];
        if (!cameraVideoTrack) return;

        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (sender) {
                    await sender.replaceTrack(cameraVideoTrack);
                }
            } catch (error) {
                console.error(`❌ Error switching to camera for peer ${peerId}:`, error);
            }
        }
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
            this.screenSharingTeacherId = null;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = "Teacher's Screen";
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