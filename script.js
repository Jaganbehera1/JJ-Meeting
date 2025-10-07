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
        this.screenShareBtn.addEventListener('click', () => {
            console.log(`Toggling screen share: ${!this.isScreenSharing ? 'START' : 'STOP'}`);
            this.toggleScreenShare();
        });
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
            setTimeout(() => {
            this.monitorConnections();
            }, 5000);
            
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

    // Add this method to handle student-to-student audio
    handleStudentAudio(peerId, stream) {
        // Only handle audio streams between students
        if (this.userRole !== 'student') return;

        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData && typeof participantData === 'object') {
                const participantRole = participantData.role || 'student';
                if (participantRole === 'student') {
                    // Only create audio element if there are audio tracks
                    const audioTracks = stream.getAudioTracks();
                    if (audioTracks.length > 0) {
                        // Create hidden audio element for other students' audio
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
            }
        });
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

        // Find current teacher and connect to existing participants
        this.findCurrentTeacher().then(() => {
            this.connectToExistingParticipants().then(() => {
                // Force students to connect to teachers
                if (this.userRole === 'student') {
                    setTimeout(() => {
                        this.forceStudentToTeacherConnections();
                    }, 2000);
                }
            });
        });
    }

    // Add this method to monitor connection status
    checkConnectionState() {
        console.log('=== CONNECTION STATE ===');
        console.log('User Role:', this.userRole);
        console.log('Current Teacher ID:', this.currentTeacherId);
        console.log('Peers:', Object.keys(this.peers));
        console.log('Local Stream:', this.localStream ? 'Available' : 'None');
        console.log('Teacher Video srcObject:', this.teacherVideo.srcObject);

        Object.entries(this.peers).forEach(([peerId, pc]) => {
            console.log(`Peer ${peerId}:`, {
                connectionState: pc.connectionState,
                signalingState: pc.signalingState,
                iceConnectionState: pc.iceConnectionState
            });
        });
    }

    // Add this debug method
    debugAllConnections() {
        console.log('=== CONNECTION DEBUG ===');
        console.log('User:', this.userName, 'Role:', this.userRole);
        console.log('Current Teacher ID:', this.currentTeacherId);
        console.log('All Peers:', Object.keys(this.peers));

        // Check if students are connected to teacher
        if (this.userRole === 'student') {
            if (this.currentTeacherId && this.peers[this.currentTeacherId]) {
                console.log('✅ Student IS connected to teacher');
            } else {
                console.log('❌ Student is NOT connected to teacher');
            }
        }

        // Check teacher connections to students
        if (this.userRole === 'teacher') {
            const studentConnections = Object.keys(this.peers).filter(peerId => {
                const peerData = this.getParticipantData(peerId);
                return peerData && (peerData.role === 'student' || !peerData.role);
            });
            console.log(`Teacher connected to ${studentConnections.length} students`);
        }

        Object.entries(this.peers).forEach(([peerId, pc]) => {
            const peerData = this.getParticipantData(peerId);
            const peerName = peerData?.name || 'Unknown';
            const peerRole = peerData?.role || 'student';

            console.log(`Peer ${peerName} (${peerRole}):`, {
                connectionState: pc.connectionState,
                signalingState: pc.signalingState,
                iceConnectionState: pc.iceConnectionState
            });
        });
    }

    // Helper method to get participant data
    getParticipantData(participantId) {
        // This would need to be implemented to get participant data from Firebase
        // For now, we'll return null and rely on existing data
        return null;
    }
    async findCurrentTeacher() {
        const participantsSnapshot = await this.participantsRef.once('value');
        const participants = participantsSnapshot.val();

        if (participants) {
            for (const [participantId, participantData] of Object.entries(participants)) {
                const participantRole = participantData.role || 'student';
                if (participantRole === 'teacher' && participantId !== this.userId) {
                    this.currentTeacherId = participantId;
                    const participantName = participantData.name || 'Unknown Teacher';
                    console.log(`Found teacher: ${participantName} (${participantId})`);
                    break;
                }
            }
        }

        // If no teacher found and current user is teacher, set self as teacher
        if (!this.currentTeacherId && this.userRole === 'teacher') {
            this.currentTeacherId = this.userId;
            console.log('No other teacher found, current user is the teacher');
        }
    }
        // Add this method to your class
    async connectToExistingParticipants() {
        const participantsSnapshot = await this.participantsRef.once('value');
        const participants = participantsSnapshot.val();

        if (!participants) return;

        console.log(`Found ${Object.keys(participants).length} existing participants`);

        for (const [participantId, participantData] of Object.entries(participants)) {
            if (participantId === this.userId) continue;

            // Skip if already connected
            if (this.peers[participantId]) {
                console.log(`Already connected to ${participantId}, skipping`);
                continue;
            }

            // Get name and role with fallbacks
            const participantName = participantData.name || 'Unknown';
            const participantRole = participantData.role || 'student';

            console.log(`Processing existing participant: ${participantName} (${participantRole})`);

            // Connect to teacher if student
            if (this.userRole === 'student' && participantRole === 'teacher') {
                console.log(`Student connecting to existing teacher: ${participantName}`);
                await this.createPeerConnection(participantId, true);
            }
            // Connect to students if student (for audio)
            else if (this.userRole === 'student' && participantRole === 'student') {
                console.log(`Student connecting to existing student: ${participantName}`);
                await this.createPeerConnection(participantId, true);
            }
            // Teacher connects to students
            else if (this.userRole === 'teacher' && participantRole === 'student') {
                console.log(`Teacher connecting to existing student: ${participantName}`);
                await this.createPeerConnection(participantId, true);
                this.addParticipantToGrid(participantId, {...participantData, name: participantName, role: participantRole});
            }
        }

        this.updateParticipantsCount();
    }
    

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        console.log('Participant data received:', participantData);

        // More flexible validation - check if we have basic data
        if (!participantData || typeof participantData !== 'object') {
            console.warn('Invalid participant data received:', participantData);
            return;
        }

        // Get name and role with fallbacks
        const participantName = participantData.name || 'Unknown';
        const participantRole = participantData.role || 'student';

        console.log(`Participant joined: ${participantName}, role: ${participantRole}`);

        // Check if we already have a connection to this peer
        if (this.peers[participantId]) {
            console.log(`Already connected to ${participantId}, skipping duplicate connection`);
            return;
        }

        // Update teacher reference if this is a teacher
        if (participantRole === 'teacher') {
            this.currentTeacherId = participantId;

            // If student sees teacher joined, immediately connect
            if (this.userRole === 'student') {
                console.log(`Student connecting to teacher: ${participantId}`);
                await this.createPeerConnection(participantId, true);
            }
        }

        // Determine connection type based on roles
        if (this.userRole === 'teacher' && participantRole === 'student') {
            // Teacher connecting to student
            console.log(`Teacher connecting to student: ${participantId}`);
            await this.createPeerConnection(participantId, true);
            this.addParticipantToGrid(participantId, {...participantData, name: participantName, role: participantRole});
        } else if (this.userRole === 'student' && participantRole === 'teacher') {
            // Student connecting to teacher
            console.log(`Student connecting to teacher: ${participantId}`);
            await this.createPeerConnection(participantId, true);
        } else if (this.userRole === 'student' && participantRole === 'student') {
            // Students connecting to other students for audio
            console.log(`Student connecting to other student: ${participantId}`);
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
            this.findCurrentTeacher();
            
            // Clear screen share if this teacher was sharing
            if (this.screenSharingTeacherId === participantId) {
                this.screenSharingTeacherId = null;
            }
        }
        
        this.updateParticipantsCount();
    }

    async createPeerConnection(peerId, isInitiator) {
        console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);

        // Close existing connection if any
        if (this.peers[peerId]) {
            console.log(`Closing existing connection with ${peerId}`);
            this.closePeerConnection(peerId);
        }

        // Improved RTC configuration
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });

        this.peers[peerId] = peerConnection;

        // Initialize ICE candidate queue for this peer
        this.iceCandidateQueue.set(peerId, []);

        // Add current stream tracks
        const currentStream = this.isScreenSharing && this.screenStream ? this.screenStream : this.localStream;
        if (currentStream) {
            console.log(`Adding ${currentStream.getTracks().length} tracks to peer ${peerId}`);
            currentStream.getTracks().forEach(track => {
                if (track.readyState === 'live') {
                    console.log(`Adding ${track.kind} track to ${peerId}`);
                    try {
                        peerConnection.addTrack(track, currentStream);
                    } catch (error) {
                        console.error(`Error adding ${track.kind} track to ${peerId}:`, error);
                    }
                }
            });
        } else {
            console.warn('No local stream available when creating peer connection');
        }

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            console.log('Received remote stream from:', peerId, event.streams);
            const [remoteStream] = event.streams;
            if (remoteStream) {
                this.handleRemoteStream(peerId, remoteStream);
                
                // For student-to-student audio
                if (this.userRole === 'student') {
                    this.handleStudentAudio(peerId, remoteStream);
                }
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Generated ICE candidate for ${peerId}:`, event.candidate);
                this.sendSignal(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            } else {
                console.log(`All ICE candidates gathered for ${peerId}`);
            }
        };

        // Handle ICE connection state
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${peerId}: ${peerConnection.iceConnectionState}`);
            
            if (peerConnection.iceConnectionState === 'connected') {
                console.log(`✅ ICE connected to ${peerId}`);
            } else if (peerConnection.iceConnectionState === 'failed') {
                console.log(`❌ ICE failed with ${peerId}`);
                this.restartConnection(peerId);
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
                this.restartConnection(peerId);
            } else if (peerConnection.connectionState === 'closed') {
                console.log(`Connection closed with ${peerId}`);
                if (this.peers[peerId] === peerConnection) {
                    delete this.peers[peerId];
                    this.iceCandidateQueue.delete(peerId);
                }
            }
        };

        // Create initial offer if initiator
        if (isInitiator) {
            try {
                console.log(`Creating initial offer for ${peerId}`);
                
                // Add delay to ensure everything is ready
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
                
                console.log(`Offer created and sent to ${peerId}`);
            } catch (error) {
                console.error('Error creating initial offer:', error);
            }
        }

        return peerConnection;
    }
    
    async restartConnection(peerId) {
        console.log(`Restarting connection with ${peerId}`);
        
        // Close existing connection
        this.closePeerConnection(peerId);
        
        // Wait a bit before reconnecting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Re-fetch participant data
        try {
            const participantRef = database.ref(`rooms/${this.roomId}/participants/${peerId}`);
            const snapshot = await participantRef.once('value');
            const participantData = snapshot.val();
            
            if (participantData) {
                // Recreate connection with same initiator logic
                const isTeacherToStudent = this.userRole === 'teacher' && participantData.role === 'student';
                const isStudentToTeacher = this.userRole === 'student' && participantData.role === 'teacher';
                const isStudentToStudent = this.userRole === 'student' && participantData.role === 'student';
                
                if (isTeacherToStudent || isStudentToTeacher || isStudentToStudent) {
                    console.log(`Reconnecting to ${participantData.name} (${peerId})`);
                    await this.createPeerConnection(peerId, true);
                }
            }
        } catch (error) {
            console.error(`Error restarting connection with ${peerId}:`, error);
        }
    }
    // Add this method to ensure students connect to teachers
    async ensureTeacherConnection() {
        if (this.userRole !== 'student') return;

        if (!this.currentTeacherId) {
            console.log('No current teacher found, searching...');
            await this.findCurrentTeacher();
        }

        if (this.currentTeacherId && !this.peers[this.currentTeacherId]) {
            console.log(`Student ensuring connection to teacher: ${this.currentTeacherId}`);
            await this.createPeerConnection(this.currentTeacherId, true);
        }
    }
    // Add this method to ensure students connect to teachers
    async forceStudentToTeacherConnections() {
        if (this.userRole !== 'student') return;
        
        console.log('Forcing student connections to teacher...');
        
        // Find all teachers in the room
        const participantsSnapshot = await this.participantsRef.once('value');
        const participants = participantsSnapshot.val();
        
        if (participants) {
            for (const [participantId, participantData] of Object.entries(participants)) {
                if (participantId === this.userId) continue;
                
                const participantRole = participantData.role || 'student';
                const participantName = participantData.name || 'Unknown';
                
                if (participantRole === 'teacher' && !this.peers[participantId]) {
                    console.log(`Student forcing connection to teacher: ${participantName}`);
                    await this.createPeerConnection(participantId, true);
                }
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
                console.log(`Creating new peer connection for signal from ${fromUserId}`);
                
                // Get participant data
                const participantRef = database.ref(`rooms/${this.roomId}/participants/${fromUserId}`);
                const participantSnapshot = await participantRef.once('value');
                const participantData = participantSnapshot.val();
                
                if (participantData) {
                    const participantRole = participantData.role || 'student';
                    
                    // Determine if we should connect based on roles
                    const shouldConnect = 
                        (this.userRole === 'teacher' && participantRole === 'student') ||
                        (this.userRole === 'student' && participantRole === 'teacher') ||
                        (this.userRole === 'student' && participantRole === 'student');
                    
                    if (shouldConnect) {
                        peerConnection = await this.createPeerConnection(fromUserId, false);
                    }
                }
            }

            if (peerConnection && peerConnection.signalingState !== 'closed') {
                switch (type) {
                    case 'offer':
                        console.log(`Received offer from ${fromUserId}`);
                        
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);
                        
                        this.sendSignal(fromUserId, {
                            type: 'answer',
                            answer: answer
                        });
                        
                        // Process queued ICE candidates
                        this.processQueuedIceCandidates(fromUserId, peerConnection);
                        break;
                        
                    case 'answer':
                        console.log(`Received answer from ${fromUserId}`);
                        
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                        this.processQueuedIceCandidates(fromUserId, peerConnection);
                        break;
                        
                    case 'ice-candidate':
                        if (candidate) {
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                                console.log(`Added ICE candidate from ${fromUserId}`);
                            } catch (error) {
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
        
        setTimeout(() => {
            signalRef.remove().catch(error => {
                console.log('Signal already removed:', error);
            });
        }, 30000);
    }

    handleRemoteStream(peerId, stream) {
        console.log(`Handling remote stream from ${peerId}`, stream);

        if (!stream) {
            console.error('No stream provided for peer:', peerId);
            return;
        }

        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData && typeof participantData === 'object') {
                const participantName = participantData.name || 'Unknown';
                const participantRole = participantData.role || 'student';

                if (this.userRole === 'student' && participantRole === 'teacher') {
                    // Student receiving teacher's stream
                    console.log('Student: Setting teacher video stream');
                    this.teacherVideo.srcObject = stream;
                    this.teacherVideo.style.display = 'block';

                    // Add event listeners for the video element
                    this.teacherVideo.onloadedmetadata = () => {
                        console.log('Teacher video metadata loaded');
                        this.teacherVideo.play().catch(e => {
                            console.log('Teacher video play error:', e);
                        });
                    };

                    this.teacherVideo.oncanplay = () => {
                        console.log('Teacher video can play');
                    };

                    this.teacherTitle.textContent = `${participantName}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantName} - Screen Sharing`;
                    }

                } else if (this.userRole === 'teacher' && participantRole === 'student') {
                    // Teacher receiving student's stream
                    console.log('Teacher: Showing student video in grid');
                    this.showParticipantVideo(peerId, stream, {...participantData, name: participantName, role: participantRole});
                } else if (this.userRole === 'student' && participantRole === 'student') {
                    // Student receiving other student's audio
                    console.log('Student: Handling other student stream');
                    this.handleStudentAudio(peerId, stream);
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
        if (!videoTrack) {
            console.error('No video track in the new stream');
            return;
        }

        console.log(`Replacing video tracks with new stream for ${Object.keys(this.peers).length} peers`);

        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );

                if (sender) {
                    console.log(`Replacing track for peer ${peerId}`);
                    await sender.replaceTrack(videoTrack);
                } else {
                    console.log(`Adding track for peer ${peerId}`);
                    peerConnection.addTrack(videoTrack, newStream);
                }
            } catch (error) {
                console.error(`Error replacing track for peer ${peerId}:`, error);
            }
        }
    }

    // Switch all video tracks back to camera
    async switchBackToCamera() {
        if (!this.localStream) {
            console.warn('No local stream available when switching back to camera');
            return;
        }
    
        const cameraVideoTrack = this.localStream.getVideoTracks()[0];
        if (!cameraVideoTrack) {
            console.warn('No camera video track available');
            return;
        }
    
        console.log('Switching back to camera for all peers');
    
        for (const [peerId, peerConnection] of Object.entries(this.peers)) {
            try {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                
                if (sender) {
                    console.log(`Replacing video track for peer ${peerId}`);
                    await sender.replaceTrack(cameraVideoTrack);
                } else {
                    console.log(`Adding video track for peer ${peerId}`);
                    peerConnection.addTrack(cameraVideoTrack, this.localStream);
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
            try {
                this.peers[peerId].close();
            } catch (error) {
                console.log(`Error closing connection with ${peerId}:`, error);
            }
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
                // Start screen sharing
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: 'always' },
                    audio: true
                });

                // Check if we got a video track
                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (!videoTrack) {
                    throw new Error('No video track in screen share stream');
                }

                await this.replaceAllVideoTracks(this.screenStream);
                this.isScreenSharing = true;

                // Update Firebase
                await database.ref(`rooms/${this.roomId}/screenShare`).set({
                    active: true,
                    teacherId: this.userId,
                    teacherName: this.userName,
                    startedAt: firebase.database.ServerValue.TIMESTAMP
                });

                // Handle when user stops screen share via browser controls
                videoTrack.onended = () => {
                    console.log('Stopping screen share, current state:', {
                    isScreenSharing: this.isScreenSharing,
                    hasScreenStream: !!this.screenStream,
                    peerCount: Object.keys(this.peers).length
                });
                    console.log('Screen share ended by browser controls');
                    this.stopScreenShare();
                    this.updateScreenShareButton();
                };

            } else {
                // Stop screen sharing
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
            console.log('Stopping screen share...');

            // Stop screen stream tracks
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped screen track:', track.kind);
                });
                this.screenStream = null;
            }
        
            // Switch all video tracks back to camera
            await this.switchBackToCamera();
            this.isScreenSharing = false;
        
            // Update Firebase screen share status
            await database.ref(`rooms/${this.roomId}/screenShare`).set({
                active: false,
                stoppedAt: firebase.database.ServerValue.TIMESTAMP
            });
        
            // Force UI update for all participants
            this.updateUserStatus();

            console.log('Screen share stopped successfully');
        }

    async toggleRaiseHand() {
        this.isHandRaised = !this.isHandRaised;
        this.updateRaiseHandButton();
        this.updateUserStatus();
    }

    handleScreenShareUpdate(snapshot) {
        const screenData = snapshot.val();
        console.log('Screen share update:', screenData);

        if (screenData && screenData.active && screenData.teacherId !== this.userId) {
            this.screenSharingTeacherId = screenData.teacherId;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = `${screenData.teacherName} - Screen Sharing`;
                console.log('Screen sharing started by teacher:', screenData.teacherName);
            }
        } else if (!screenData || !screenData.active) {
            this.screenSharingTeacherId = null;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = "Teacher's Screen";
                console.log('Screen sharing stopped');

                // Clear any frozen video frame by reloading the video element
                if (this.teacherVideo.srcObject) {
                    // This helps clear the last frame
                    this.teacherVideo.srcObject = null;
                    // The stream will be re-established automatically via WebRTC
                }
            }
        }
    }
    // Add this method to your class
    refreshTeacherVideo() {
        if (this.userRole === 'student' && this.teacherVideo) {
            // Temporarily clear and let WebRTC re-establish the stream
            const currentSrc = this.teacherVideo.srcObject;
            if (currentSrc) {
                this.teacherVideo.srcObject = null;
                // The ontrack event will set the new stream when it arrives
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