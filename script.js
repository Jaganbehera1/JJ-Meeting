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
            console.log('Local stream initialized with tracks:', this.localStream.getTracks().length);
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

        console.log('Saving user data to Firebase:', userData);
        
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
        // Clean up old signals first
        this.cleanupOldSignals();
        
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

        // Connect to existing participants
        setTimeout(() => {
            this.connectToExistingParticipants();
        }, 2000);
    }

    async cleanupOldSignals() {
        try {
            const signalsRef = database.ref(`rooms/${this.roomId}/signals`);
            await signalsRef.remove();
            console.log('Cleaned up old signals');
        } catch (error) {
            console.log('No signals to clean up or error:', error);
        }
    }

    async connectToExistingParticipants() {
        try {
            const participantsSnapshot = await this.participantsRef.once('value');
            const participants = participantsSnapshot.val();

            if (!participants) {
                console.log('No existing participants found');
                return;
            }

            console.log(`Found ${Object.keys(participants).length} existing participants`);

            for (const [participantId, participantData] of Object.entries(participants)) {
                if (participantId === this.userId) continue;

                // Skip if already connected
                if (this.peers[participantId]) {
                    console.log(`Already connected to ${participantId}, skipping`);
                    continue;
                }

                const participantName = participantData.name || 'Unknown';
                const participantRole = participantData.role || 'student';

                console.log(`Processing existing participant: ${participantName} (${participantRole})`);

                // Student connects to teacher
                if (this.userRole === 'student' && participantRole === 'teacher') {
                    console.log(`Student connecting to teacher: ${participantName}`);
                    await this.createPeerConnection(participantId, true);
                    this.currentTeacherId = participantId;
                }
                // Teacher connects to students
                else if (this.userRole === 'teacher' && participantRole === 'student') {
                    console.log(`Teacher connecting to student: ${participantName}`);
                    await this.createPeerConnection(participantId, true);
                    this.addParticipantToGrid(participantId, participantData);
                }
                // Students connect to other students for audio
                else if (this.userRole === 'student' && participantRole === 'student') {
                    console.log(`Student connecting to student: ${participantName}`);
                    await this.createPeerConnection(participantId, true);
                }
            }

            this.updateParticipantsCount();
        } catch (error) {
            console.error('Error connecting to existing participants:', error);
        }
    }

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        const participantName = participantData.name || 'Unknown';
        const participantRole = participantData.role || 'student';

        console.log(`Participant joined: ${participantName}, role: ${participantRole}`);

        // Skip if already connected
        if (this.peers[participantId]) {
            console.log(`Already connected to ${participantId}, skipping`);
            return;
        }

        // Student connects to teacher
        if (this.userRole === 'student' && participantRole === 'teacher') {
            console.log(`Student connecting to new teacher: ${participantName}`);
            await this.createPeerConnection(participantId, true);
            this.currentTeacherId = participantId;
        }
        // Teacher connects to students
        else if (this.userRole === 'teacher' && participantRole === 'student') {
            console.log(`Teacher connecting to new student: ${participantName}`);
            await this.createPeerConnection(participantId, true);
            this.addParticipantToGrid(participantId, participantData);
        }
        // Students connect to other students for audio
        else if (this.userRole === 'student' && participantRole === 'student') {
            console.log(`Student connecting to new student: ${participantName}`);
            await this.createPeerConnection(participantId, true);
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
        
        console.log(`Participant left: ${participantData?.name} (${participantId})`);
        
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
                if (track.readyState === 'live') {
                    peerConnection.addTrack(track, currentStream);
                }
            });
        }

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            console.log('Received remote stream from:', peerId);
            const [remoteStream] = event.streams;
            if (remoteStream) {
                this.handleRemoteStream(peerId, remoteStream);
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
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
                this.iceCandidateQueue.delete(peerId);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection failed with ${peerId}`);
                setTimeout(() => {
                    this.restartConnection(peerId);
                }, 2000);
            }
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
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
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
            const participantRef = database.ref(`rooms/${this.roomId}/participants/${peerId}`);
            const snapshot = await participantRef.once('value');
            const participantData = snapshot.val();
            
            if (participantData) {
                const participantRole = participantData.role || 'student';
                const shouldReconnect = 
                    (this.userRole === 'teacher' && participantRole === 'student') ||
                    (this.userRole === 'student' && participantRole === 'teacher') ||
                    (this.userRole === 'student' && participantRole === 'student');
                
                if (shouldReconnect) {
                    await this.createPeerConnection(peerId, true);
                }
            }
        } catch (error) {
            console.error(`Error restarting connection with ${peerId}:`, error);
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
            return;
        }

        this.pendingSignals.add(signalKey);
        
        setTimeout(() => {
            this.pendingSignals.delete(signalKey);
        }, 10000);

        const { type, offer, answer, candidate } = signalData;

        try {
            let peerConnection = this.peers[fromUserId];
            
            if (!peerConnection) {
                const participantRef = database.ref(`rooms/${this.roomId}/participants/${fromUserId}`);
                const snapshot = await participantRef.once('value');
                const participantData = snapshot.val();
                
                if (participantData) {
                    const participantRole = participantData.role || 'student';
                    const shouldConnect = 
                        (this.userRole === 'teacher' && participantRole === 'student') ||
                        (this.userRole === 'student' && participantRole === 'teacher') ||
                        (this.userRole === 'student' && participantRole === 'student');
                    
                    if (shouldConnect) {
                        peerConnection = await this.createPeerConnection(fromUserId, false);
                    }
                }
            }

            if (peerConnection) {
                switch (type) {
                    case 'offer':
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                        const answerResponse = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answerResponse);
                        
                        this.sendSignal(fromUserId, {
                            type: 'answer',
                            answer: answerResponse
                        });
                        
                        this.processQueuedIceCandidates(fromUserId, peerConnection);
                        break;
                        
                    case 'answer':
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                        this.processQueuedIceCandidates(fromUserId, peerConnection);
                        break;
                        
                    case 'ice-candidate':
                        if (candidate) {
                            if (peerConnection.remoteDescription) {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                            } else {
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
        
        setTimeout(() => {
            signalRef.remove().catch(() => {});
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`Handling remote stream from ${peerId}`);

        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                const participantName = participantData.name || 'Unknown';
                const participantRole = participantData.role || 'student';

                if (this.userRole === 'student' && participantRole === 'teacher') {
                    // Student receiving teacher's stream
                    this.teacherVideo.srcObject = stream;
                    this.teacherVideo.style.display = 'block';
                    
                    this.teacherVideo.onloadedmetadata = () => {
                        this.teacherVideo.play().catch(e => console.log('Play error:', e));
                    };
                    
                    this.teacherTitle.textContent = `${participantName}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantName} - Screen Sharing`;
                    }
                    
                } else if (this.userRole === 'teacher' && participantRole === 'student') {
                    // Teacher receiving student's stream
                    this.showParticipantVideo(peerId, stream, participantData);
                } else if (this.userRole === 'student' && participantRole === 'student') {
                    // Student receiving other student's audio
                    this.handleStudentAudio(peerId, stream, participantData);
                }
            }
        }).catch(error => {
            console.error('Error checking participant data:', error);
        });
    }

    handleStudentAudio(peerId, stream, participantData) {
        if (this.userRole !== 'student') return;

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            let audioElement = document.getElementById(`student-audio-${peerId}`);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = `student-audio-${peerId}`;
                audioElement.autoplay = true;
                audioElement.style.display = 'none';
                document.body.appendChild(audioElement);
            }

            audioElement.srcObject = stream;
            const participantName = participantData.name || 'Student';
            console.log(`Added audio stream from student: ${participantName}`);
        }
    }

    showParticipantVideo(peerId, stream, participantData) {
        let participantCard = document.getElementById(`participant-${peerId}`);
        
        if (!participantCard) {
            participantCard = document.createElement('div');
            participantCard.className = 'participant-card';
            participantCard.id = `participant-${peerId}`;
            
            const participantName = participantData.name || 'Student';
            
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
                videoElement.onloadedmetadata = () => {
                    videoElement.play().catch(e => console.log('Play error:', e));
                };
            }
            
            this.participantsGrid.appendChild(participantCard);
            this.updateParticipantsCount();
        } else {
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
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
            console.error('Error sharing screen:', error);
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
                console.error(`Error replacing track for peer ${peerId}:`, error);
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
                console.error(`Error switching to camera for peer ${peerId}:`, error);
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