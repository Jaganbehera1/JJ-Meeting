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
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        frameRate: { ideal: 24 }
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
            
            // Initialize Firebase and WebRTC
            await this.initializeFirebase();
            this.setupFirebaseListeners();
            
            console.log(`Joined room ${this.roomId} as ${this.userName}`);
            
        } catch (error) {
            console.error('Error joining room:', error);
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

        // Find current teacher and existing participants
        this.findCurrentTeacher();
        this.findExistingParticipants();
    }

    async findExistingParticipants() {
        try {
            const participantsSnapshot = await this.participantsRef.once('value');
            const participants = participantsSnapshot.val();
            
            if (participants) {
                for (const [participantId, participantData] of Object.entries(participants)) {
                    if (participantId !== this.userId) {
                        // Handle existing participants
                        setTimeout(() => {
                            this.handleParticipantJoined({
                                key: participantId,
                                val: () => participantData
                            });
                        }, 1000);
                    }
                }
            }
        } catch (error) {
            console.error('Error finding existing participants:', error);
        }
    }

    async findCurrentTeacher() {
        const participantsSnapshot = await this.participantsRef.once('value');
        const participants = participantsSnapshot.val();
        
        if (participants) {
            for (const [participantId, participantData] of Object.entries(participants)) {
                if (participantData.role === 'teacher' && participantId !== this.userId) {
                    this.currentTeacherId = participantId;
                    console.log(`Found teacher: ${participantData.name} (${participantId})`);
                    
                    if (this.userRole === 'student') {
                        this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                    }
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
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = `${participantData.name}'s Screen`;
            }
        }

        // Determine connection type based on roles
        const shouldConnect = 
            (this.userRole === 'teacher' && participantData.role === 'student') ||
            (this.userRole === 'student' && participantData.role === 'teacher');

        if (shouldConnect) {
            // Always let teacher initiate connection to avoid race conditions
            const isInitiator = this.userRole === 'teacher';
            
            console.log(`Creating connection: ${this.userName} -> ${participantData.name}, initiator: ${isInitiator}`);
            
            await this.createPeerConnection(participantId, isInitiator);
            
            // Add to grid if teacher viewing student
            if (this.userRole === 'teacher' && participantData.role === 'student') {
                this.addParticipantToGrid(participantId, participantData);
            }
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
                console.log(`Adding ${track.kind} track to peer ${peerId}`);
                peerConnection.addTrack(track, currentStream);
            });
        }

        // Handle incoming stream - FIXED: Properly handle multiple streams
        peerConnection.ontrack = (event) => {
            console.log('✅ Received remote stream from:', peerId, event.streams);
            if (event.streams && event.streams.length > 0) {
                const remoteStream = event.streams[0];
                console.log(`Remote stream has ${remoteStream.getTracks().length} tracks`);
                this.handleRemoteStream(peerId, remoteStream);
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${peerId}`);
                this.sendSignal(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}: ${peerConnection.connectionState}`);
            
            if (peerConnection.connectionState === 'connected') {
                console.log(`✅ Successfully connected to ${peerId}`);
                // Process any queued ICE candidates
                this.processQueuedIceCandidates(peerId, peerConnection);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection with ${peerId} failed`);
                setTimeout(() => {
                    this.restartConnection(peerId);
                }, 2000);
            }
        };

        // Handle ICE gathering state
        peerConnection.onicegatheringstatechange = () => {
            console.log(`ICE gathering state for ${peerId}: ${peerConnection.iceGatheringState}`);
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                console.log(`Creating initial offer for ${peerId}`);
                
                // Use a small delay to ensure everything is ready
                await new Promise(resolve => setTimeout(resolve, 1000));
                
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
                const isInitiator = this.userRole === 'teacher';
                await this.createPeerConnection(peerId, isInitiator);
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
        }, 30000);

        const { type, offer, answer, candidate } = signalData;

        try {
            let peerConnection = this.peers[fromUserId];
            
            if (!peerConnection && type === 'offer') {
                // Create a new peer connection for incoming offers
                const participantRef = database.ref(`rooms/${this.roomId}/participants/${fromUserId}`);
                const snapshot = await participantRef.once('value');
                const participantData = snapshot.val();
                
                if (participantData) {
                    const shouldConnect = 
                        (this.userRole === 'teacher' && participantData.role === 'student') ||
                        (this.userRole === 'student' && participantData.role === 'teacher');
                    
                    if (shouldConnect) {
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
                            
                            console.log(`Sent answer to ${fromUserId}`);
                        }
                        break;
                        
                    case 'answer':
                        console.log(`Received answer from ${fromUserId}, current state: ${peerConnection.signalingState}`);
                        
                        if (peerConnection.signalingState === 'have-local-offer') {
                            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                            console.log(`Remote description set for ${fromUserId}`);
                        }
                        break;
                        
                    case 'ice-candidate':
                        if (candidate && candidate.candidate) {
                            try {
                                if (peerConnection.remoteDescription) {
                                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                                    console.log(`Added ICE candidate from ${fromUserId}`);
                                } else {
                                    console.log(`Queuing ICE candidate from ${fromUserId}`);
                                    const queue = this.iceCandidateQueue.get(fromUserId) || [];
                                    queue.push(candidate);
                                    this.iceCandidateQueue.set(fromUserId, queue);
                                }
                            } catch (error) {
                                console.error('Error adding ICE candidate:', error);
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
            this.iceCandidateQueue.delete(peerId);
        }
    }

    sendSignal(toUserId, signal) {
        signal.from = this.userId;
        signal.timestamp = Date.now();
        
        const signalRef = database.ref(`rooms/${this.roomId}/signals`).push();
        signalRef.set(signal);
        
        setTimeout(() => {
            signalRef.remove().catch(error => {
                console.log('Signal already removed:', error);
            });
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`🎥 Handling remote stream from ${peerId}`);
        
        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                if (this.userRole === 'student' && participantData.role === 'teacher') {
                    // Student receiving teacher's stream
                    console.log(`🎓 Student ${this.userName} displaying teacher ${participantData.name} video`);
                    this.displayTeacherVideo(stream, participantData);
                } else if (this.userRole === 'teacher' && participantData.role === 'student') {
                    // Teacher receiving student's stream
                    console.log(`👨‍🏫 Teacher displaying student ${participantData.name} video`);
                    this.displayStudentVideo(peerId, stream, participantData);
                }
            }
        }).catch(error => {
            console.error('Error checking participant data:', error);
        });
    }

    displayTeacherVideo(stream, teacherData) {
        this.teacherVideo.srcObject = stream;
        this.teacherTitle.textContent = `${teacherData.name}'s Screen`;
        if (teacherData.screenSharing) {
            this.teacherTitle.textContent = `${teacherData.name} - Screen Sharing`;
        }
        
        // Handle video play
        this.teacherVideo.onloadedmetadata = () => {
            this.teacherVideo.play().catch(e => {
                console.log('Teacher video play error:', e);
            });
        };
    }

    displayStudentVideo(peerId, stream, studentData) {
        let participantCard = document.getElementById(`participant-${peerId}`);
        
        if (!participantCard) {
            // Create participant card if it doesn't exist
            participantCard = document.createElement('div');
            participantCard.className = 'participant-card';
            participantCard.id = `participant-${peerId}`;
            
            participantCard.innerHTML = `
                <video class="participant-video" autoplay playsinline></video>
                <div class="participant-info">
                    <span class="participant-name">${studentData.name}</span>
                    <div class="participant-status">
                        <span class="status-icon ${studentData.videoEnabled ? '' : 'status-muted'}">📹</span>
                        <span class="status-icon ${studentData.audioEnabled ? '' : 'status-muted'}">🎤</span>
                        ${studentData.handRaised ? '<span class="status-icon hand-raised">✋</span>' : ''}
                    </div>
                </div>
            `;
            
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.onloadedmetadata = () => {
                    videoElement.play().catch(e => console.log('Student video play error:', e));
                };
            }
            
            this.participantsGrid.appendChild(participantCard);
            this.updateParticipantsCount();
        } else {
            // Update existing participant card
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
            }
        }
    }

    // Replace all video tracks in ALL peer connections with screen share
    async replaceAllVideoTracks(newStream) {
        const videoTrack = newStream.getVideoTracks()[0];
        if (!videoTrack) return;

        console.log(`Replacing video tracks for ${Object.keys(this.peers).length} peers`);

        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const senders = peerConnection.getSenders();
                const videoSender = senders.find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (videoSender) {
                    await videoSender.replaceTrack(videoTrack);
                    console.log(`Replaced video track for peer ${peerId}`);
                } else {
                    // Add track if no video sender exists
                    peerConnection.addTrack(videoTrack, newStream);
                    console.log(`Added video track for peer ${peerId}`);
                }
            } catch (error) {
                console.error(`Error replacing track for peer ${peerId}:`, error);
            }
        }
    }

    // Switch all video tracks back to camera for ALL peers
    async switchBackToCamera() {
        if (!this.localStream) return;

        const cameraVideoTrack = this.localStream.getVideoTracks()[0];
        if (!cameraVideoTrack) return;

        console.log(`Switching back to camera for ${Object.keys(this.peers).length} peers`);

        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const senders = peerConnection.getSenders();
                const videoSender = senders.find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (videoSender) {
                    await videoSender.replaceTrack(cameraVideoTrack);
                    console.log(`Switched to camera for peer ${peerId}`);
                }
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

    // Media Controls
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

                // Replace tracks for ALL connected peers
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
        }
    }

    async stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }

        // Switch back to camera for ALL connected peers
        await this.switchBackToCamera();
        this.isScreenSharing = false;

        await database.ref(`rooms/${this.roomId}/screenShare`).set({
            active: false,
            teacherId: null,
            teacherName: null
        });
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
                await database.ref(`rooms/${this.roomId}/screenShare`).set({ 
                    active: false,
                    teacherId: null,
                    teacherName: null
                });
            }

            location.reload();
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.virtualClassroom = new VirtualClassroom();
});