// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAgZCtcnltf6um5felvWP3r_L1rJt3dEgQ",
    authDomain: "online-classes-83846.firebaseapp.com",
    databaseURL: "https://online-classes-83846-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "online-classes-83846",
    storageBucket: "online-classes-83846.firebasestorage.app",
    messagingSenderId: "187976015161",
    appId: "1:187976015161:web:9b44253a575b011e835ce8",
    measurementId: "G-8600VC5E8Q"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

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
        this.showNotification('Virtual Classroom initialized', 'success');
    }

    initializeElements() {
        // Video elements
        this.teacherVideo = document.getElementById('teacherVideo');
        this.teacherPlaceholder = document.getElementById('teacherPlaceholder');
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
        
        // Notification container
        this.notificationContainer = document.getElementById('notificationContainer');
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

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.updateUserStatus();
            }
        });

        // Handle beforeunload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    async initializeLocalStream() {
        try {
            const constraints = {
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

            // Stop existing stream if any
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.showNotification('Camera and microphone access granted', 'success');
            
            return this.localStream;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            
            let errorMessage = 'Error accessing camera and microphone: ';
            if (error.name === 'NotReadableError') {
                errorMessage = 'Camera or microphone is already in use by another application.';
            } else if (error.name === 'NotAllowedError') {
                errorMessage = 'Camera and microphone permissions are required. Please allow access and try again.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No camera or microphone found. Please check your devices.';
            } else {
                errorMessage += error.message;
            }
            
            this.showNotification(errorMessage, 'error');
            throw error;
        }
    }

    async joinRoom() {
        this.userName = this.userNameInput.value.trim();
        this.userRole = this.userRoleSelect.value;
        this.roomId = this.roomIdInput.value.trim().toUpperCase();

        if (!this.userName) {
            this.showNotification('Please enter your name', 'warning');
            return;
        }

        if (!this.roomId) {
            this.showNotification('Please enter a room ID', 'warning');
            return;
        }

        try {
            this.showNotification('Initializing media devices...', 'success');
            await this.initializeLocalStream();
            
            // Update UI based on role
            this.joinModal.classList.remove('active');
            this.roomInfo.textContent = `Room: ${this.roomId}`;
            this.userInfo.textContent = `${this.userName} (${this.userRole})`;
            
            // Show/hide sections based on role
            this.updateUIBasedOnRole();
            
            // Initialize Firebase and WebRTC
            await this.initializeFirebase();
            this.setupFirebaseListeners();
            
            this.showNotification(`Joined room ${this.roomId} as ${this.userName}`, 'success');
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.showNotification('Failed to join classroom. Please try again.', 'error');
        }
    }

    updateUIBasedOnRole() {
        if (this.userRole === 'teacher') {
            // Teacher sees only students grid
            this.teacherSection.style.display = 'none';
            this.participantsSection.style.display = 'flex';
            this.screenShareBtn.disabled = false;
        } else {
            // Student sees only teacher's video
            this.teacherSection.style.display = 'flex';
            this.participantsSection.style.display = 'none';
            this.screenShareBtn.disabled = true;
        }
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
                active: false,
                teacherId: null,
                teacherName: null
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

        // Listen for WebRTC signals
        this.signalsRef = database.ref(`rooms/${this.roomId}/signals`);
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
        try {
            const participantsSnapshot = await this.participantsRef.once('value');
            const participants = participantsSnapshot.val();
            
            if (participants) {
                for (const [participantId, participantData] of Object.entries(participants)) {
                    if (participantData.role === 'teacher' && participantId !== this.userId) {
                        this.currentTeacherId = participantId;
                        console.log(`Found teacher: ${participantData.name} (${participantId})`);
                        
                        if (this.userRole === 'student') {
                            this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                            await this.createPeerConnection(participantId, true);
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding teacher:', error);
        }
    }

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        console.log(`Participant joined: ${participantData.name}, role: ${participantData.role}`);
        this.showNotification(`${participantData.name} joined the classroom`);

        // Update teacher reference if this is a teacher
        if (participantData.role === 'teacher') {
            this.currentTeacherId = participantId;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                await this.createPeerConnection(participantId, true);
            }
        }

        // Determine connection type based on roles
        if (this.userRole === 'teacher' && participantData.role === 'student') {
            // Teacher connecting to student
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
        
        // Close peer connection
        this.closePeerConnection(participantId);
        
        // Remove from UI if teacher
        if (this.userRole === 'teacher') {
            this.removeParticipantFromGrid(participantId);
        }
        
        // If the teacher leaves, clear teacher video and find new teacher
        if (participantData.role === 'teacher') {
            if (this.userRole === 'student') {
                this.teacherVideo.style.display = 'none';
                this.teacherPlaceholder.style.display = 'flex';
                this.teacherTitle.textContent = "Teacher's Screen";
            }
            this.currentTeacherId = null;
            this.findCurrentTeacher();
        }
        
        this.showNotification(`${participantData.name} left the classroom`);
        this.updateParticipantsCount();
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
        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, currentStream);
            });
        }

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            console.log('Received remote stream from:', peerId, event.streams);
            if (event.streams && event.streams.length > 0) {
                this.handleRemoteStream(peerId, event.streams[0]);
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
                this.showNotification(`Connected to ${this.getParticipantName(peerId)}`);
                // Clear ICE candidate queue on successful connection
                this.iceCandidateQueue.delete(peerId);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection with ${peerId} failed`);
                this.showNotification(`Connection failed with ${this.getParticipantName(peerId)}`, 'error');
                // Attempt to restart connection after a delay
                setTimeout(() => {
                    this.restartConnection(peerId);
                }, 2000);
            } else if (peerConnection.connectionState === 'disconnected') {
                console.log(`🔌 Connection with ${peerId} disconnected`);
                this.showNotification(`Disconnected from ${this.getParticipantName(peerId)}`, 'warning');
            }
        };

        // Handle ICE connection state
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${peerId}: ${peerConnection.iceConnectionState}`);
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                console.log(`Creating initial offer for ${peerId}`);
                
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                
                await peerConnection.setLocalDescription(offer);
                
                this.sendSignal(peerId, {
                    type: 'offer',
                    offer: offer
                });
            } catch (error) {
                console.error('Error creating initial offer:', error);
                this.showNotification('Error creating connection offer', 'error');
            }
        }

        return peerConnection;
    }

    async restartConnection(peerId) {
        if (!this.peers[peerId] || this.peers[peerId].connectionState === 'connected') {
            return;
        }

        console.log(`Restarting connection with ${peerId}`);
        this.closePeerConnection(peerId);
        
        // Re-fetch participant data
        try {
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
        } catch (error) {
            console.error('Error restarting connection:', error);
        }
    }

    async handleSignal(snapshot) {
        const signalData = snapshot.val();
        const signalId = snapshot.key;
        const fromUserId = signalData.from;
        
        // Remove signal after processing
        snapshot.ref.remove().catch(error => {
            console.log('Signal already removed:', error);
        });

        if (fromUserId === this.userId) return;

        // Check if we've already processed this signal
        const signalKey = `${fromUserId}_${signalData.type}_${signalData.timestamp}`;
        if (this.pendingSignals.has(signalKey)) {
            console.log('Skipping duplicate signal:', signalKey);
            return;
        }

        this.pendingSignals.add(signalKey);
        
        // Clean up old signals after 30 seconds
        setTimeout(() => {
            this.pendingSignals.delete(signalKey);
        }, 30000);

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
                        peerConnection = await this.createPeerConnection(fromUserId, false);
                    }
                }
            }

            if (peerConnection) {
                switch (type) {
                    case 'offer':
                        console.log(`Received offer from ${fromUserId}, current state: ${peerConnection.signalingState}`);
                        
                        if (peerConnection.signalingState === 'stable') {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                            const answerResponse = await peerConnection.createAnswer();
                            await peerConnection.setLocalDescription(answerResponse);
                            
                            this.sendSignal(fromUserId, {
                                type: 'answer',
                                answer: answerResponse
                            });
                            
                            // Process any queued ICE candidates
                            this.processQueuedIceCandidates(fromUserId, peerConnection);
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
        
        const signalRef = database.ref(`rooms/${this.roomId}/signals`).push();
        signalRef.set(signal);
        
        // Clean up old signals after 30 seconds
        setTimeout(() => {
            signalRef.remove().catch(error => {
                console.log('Signal already removed:', error);
            });
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`Handling remote stream from ${peerId}`);
        
        // Get participant data to determine role and update UI
        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                if (this.userRole === 'student' && participantData.role === 'teacher') {
                    // Student receiving teacher's stream
                    this.teacherVideo.srcObject = stream;
                    this.teacherVideo.style.display = 'block';
                    this.teacherPlaceholder.style.display = 'none';
                    this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantData.name} - Screen Sharing`;
                    }
                    
                    // Handle video play
                    this.teacherVideo.onloadedmetadata = () => {
                        this.teacherVideo.play().catch(e => {
                            console.log('Teacher video play error:', e);
                        });
                    };
                } else if (this.userRole === 'teacher' && participantData.role === 'student') {
                    // Teacher receiving student's stream
                    this.showParticipantVideo(peerId, stream, participantData);
                }
            }
        }).catch(error => {
            console.error('Error checking participant data:', error);
        });
    }

    showParticipantVideo(peerId, stream, participantData) {
        let participantCard = document.getElementById(`participant-${peerId}`);
        
        if (!participantCard) {
            // Create participant card if it doesn't exist
            participantCard = document.createElement('div');
            participantCard.className = 'participant-card';
            participantCard.id = `participant-${peerId}`;
            
            participantCard.innerHTML = `
                <video class="participant-video" autoplay playsinline muted></video>
                <div class="participant-placeholder">
                    <div class="placeholder-content">
                        <div class="placeholder-icon">👤</div>
                        <p>${participantData.name}</p>
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
            
            const videoElement = participantCard.querySelector('.participant-video');
            const placeholder = participantCard.querySelector('.participant-placeholder');
            
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.onloadedmetadata = () => {
                    videoElement.play().catch(e => console.log('Participant video play error:', e));
                    videoElement.style.display = 'block';
                    placeholder.style.display = 'none';
                };
            }
            
            this.participantsGrid.appendChild(participantCard);
            this.updateParticipantsCount();
        } else {
            // Update existing participant card
            const videoElement = participantCard.querySelector('.participant-video');
            const placeholder = participantCard.querySelector('.participant-placeholder');
            
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.onloadedmetadata = () => {
                    videoElement.play().catch(e => console.log('Participant video play error:', e));
                    videoElement.style.display = 'block';
                    placeholder.style.display = 'none';
                };
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
                console.log(`Replaced video track for peer ${peerId}`);
            } catch (error) {
                console.error(`Error replacing track for peer ${peerId}:`, error);
            }
        }
    }

    // Switch all video tracks back to camera
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
                console.log(`Switched to camera for peer ${peerId}`);
            } catch (error) {
                console.error(`Error switching to camera for peer ${peerId}:`, error);
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
            <video class="participant-video" autoplay playsinline muted></video>
            <div class="participant-placeholder">
                <div class="placeholder-content">
                    <div class="placeholder-icon">👤</div>
                    <p>${participantData.name}</p>
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

    getParticipantName(participantId) {
        const participantCard = document.getElementById(`participant-${participantId}`);
        if (participantCard) {
            const nameElement = participantCard.querySelector('.participant-name');
            return nameElement ? nameElement.textContent : 'Unknown';
        }
        return 'Unknown';
    }

    closePeerConnection(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
            this.iceCandidateQueue.delete(peerId);
            console.log(`Closed connection with ${peerId}`);
        }
    }

    // Media Controls
    async toggleVideo() {
        if (!this.localStream) return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            this.isVideoOn = !this.isVideoOn;
            videoTrack.enabled = this.isVideoOn;
            
            this.updateVideoButton();
            this.updateUserStatus();
            this.showNotification(`Video ${this.isVideoOn ? 'enabled' : 'disabled'}`);
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
            this.showNotification(`Audio ${this.isAudioOn ? 'enabled' : 'disabled'}`);
        }
    }

    async toggleScreenShare() {
        if (this.userRole !== 'teacher') {
            this.showNotification('Only teachers can share their screen.', 'warning');
            return;
        }

        try {
            if (!this.isScreenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                        displaySurface: 'window'
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
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

                this.showNotification('Screen sharing started');

            } else {
                await this.stopScreenShare();
            }

            this.updateScreenShareButton();
            this.updateUserStatus();

        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name !== 'NotAllowedError') {
                this.showNotification('Error sharing screen', 'error');
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
            active: false,
            teacherId: null,
            teacherName: null
        });

        this.showNotification('Screen sharing stopped');
    }

    async toggleRaiseHand() {
        this.isHandRaised = !this.isHandRaised;
        this.updateRaiseHandButton();
        this.updateUserStatus();
        
        this.showNotification(`Hand ${this.isHandRaised ? 'raised' : 'lowered'}`);
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
        try {
            const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
            await userRef.update({
                videoEnabled: this.isVideoOn,
                audioEnabled: this.isAudioOn,
                screenSharing: this.isScreenSharing,
                handRaised: this.isHandRaised,
                lastActive: firebase.database.ServerValue.TIMESTAMP
            });
        } catch (error) {
            console.error('Error updating user status:', error);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        this.notificationContainer.appendChild(notification);
        
        // Remove notification after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    cleanup() {
        // Clean up all peer connections
        Object.keys(this.peers).forEach(peerId => {
            this.closePeerConnection(peerId);
        });
        
        // Clean up media streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Clear queues
        this.iceCandidateQueue.clear();
        this.pendingSignals.clear();
    }

    async leaveRoom() {
        if (confirm('Are you sure you want to leave the classroom?')) {
            this.showNotification('Leaving classroom...');
            
            // Clean up resources
            this.cleanup();
            
            // Remove Firebase listeners
            if (this.participantsRef) this.participantsRef.off();
            if (this.signalsRef) this.signalsRef.off();
            if (this.screenShareRef) this.screenShareRef.off();

            // Remove user from database
            try {
                const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
                await userRef.remove();

                if (this.userRole === 'teacher' && this.isScreenSharing) {
                    await database.ref(`rooms/${this.roomId}/screenShare`).set({ 
                        active: false,
                        teacherId: null,
                        teacherName: null
                    });
                }
            } catch (error) {
                console.error('Error cleaning up Firebase:', error);
            }

            // Reload the page after a short delay
            setTimeout(() => {
                location.reload();
            }, 1000);
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.virtualClassroom = new VirtualClassroom();
});