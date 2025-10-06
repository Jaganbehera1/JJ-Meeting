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
        this.pendingSignals = new Set(); // Track processed signals to avoid duplicates
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        // Track screen sharing state
        this.screenSharingTeacherId = null;
        
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
    }

    async handleParticipantJoined(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        console.log(`Participant joined: ${participantData.name}`);

        // Create peer connection
        await this.createPeerConnection(participantId, true);
        
        // Add to participants grid if teacher
        if (this.userRole === 'teacher') {
            this.addParticipantToGrid(participantId, participantData);
            this.updateParticipantsCount();
        }
    }

    handleParticipantUpdated(snapshot) {
        const participantData = snapshot.val();
        const participantId = snapshot.key;

        if (participantId === this.userId) return;

        // Update participant in grid if teacher
        if (this.userRole === 'teacher') {
            this.updateParticipantInGrid(participantId, participantData);
        }
    }

    handleParticipantLeft(snapshot) {
        const participantId = snapshot.key;
        
        // Close peer connection
        this.closePeerConnection(participantId);
        
        // Remove from UI if teacher
        if (this.userRole === 'teacher') {
            this.removeParticipantFromGrid(participantId);
            this.updateParticipantsCount();
        }
        
        // If the screen sharing teacher leaves, clear teacher video
        if (participantId === this.screenSharingTeacherId) {
            this.teacherVideo.srcObject = null;
            this.teacherTitle.textContent = "Teacher's Screen";
            this.screenSharingTeacherId = null;
        }
    }

    async createPeerConnection(peerId, isInitiator) {
        console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);
        
        // Close existing connection if any
        if (this.peers[peerId]) {
            this.closePeerConnection(peerId);
        }

        const peerConnection = new RTCPeerConnection(this.rtcConfig);
        this.peers[peerId] = peerConnection;

        // Add current stream tracks (could be camera or screen share)
        const currentStream = this.isScreenSharing && this.screenStream ? this.screenStream : this.localStream;
        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, currentStream);
            });
        }

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            console.log('Received remote stream from:', peerId);
            const [remoteStream] = event.streams;
            this.handleRemoteStream(peerId, remoteStream);
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidate = event.candidate;
                if (candidate.candidate && candidate.sdpMid !== null && candidate.sdpMLineIndex !== null) {
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
                console.log(`Successfully connected to ${peerId}`);
            } else if (peerConnection.connectionState === 'failed' || 
                       peerConnection.connectionState === 'disconnected') {
                console.log(`Connection with ${peerId} failed`);
            }
        };

        // Create offer if initiator
        if (isInitiator) {
            try {
                // Wait a bit before creating offer to ensure peer is ready
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                this.sendSignal(peerId, {
                    type: 'offer',
                    offer: offer
                });
            } catch (error) {
                console.error('Error creating offer:', error);
            }
        }

        return peerConnection;
    }

    async handleSignal(snapshot) {
        const signalData = snapshot.val();
        const signalId = snapshot.key;
        const fromUserId = signalData.from;
        
        // Remove signal after processing
        snapshot.ref.remove();

        if (fromUserId === this.userId) return;

        // Check if we've already processed this signal to avoid duplicates
        const signalKey = `${fromUserId}_${signalData.type}_${signalData.timestamp}`;
        if (this.pendingSignals.has(signalKey)) {
            console.log('Skipping duplicate signal:', signalKey);
            return;
        }

        this.pendingSignals.add(signalKey);
        
        // Clean up old signals from the set
        setTimeout(() => {
            this.pendingSignals.delete(signalKey);
        }, 10000);

        const { type, offer, answer, candidate } = signalData;

        try {
            let peerConnection = this.peers[fromUserId];
            
            if (!peerConnection && type === 'offer') {
                peerConnection = await this.createPeerConnection(fromUserId, false);
            }

            if (peerConnection) {
                switch (type) {
                    case 'offer':
                        // Check if we're in a state to handle offers
                        if (peerConnection.signalingState !== 'stable') {
                            console.log('Cannot handle offer, signaling state is:', peerConnection.signalingState);
                            return;
                        }
                        
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                        const answerResponse = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answerResponse);
                        
                        this.sendSignal(fromUserId, {
                            type: 'answer',
                            answer: answerResponse
                        });
                        break;
                        
                    case 'answer':
                        // Check if we're expecting an answer
                        if (peerConnection.signalingState !== 'have-local-offer') {
                            console.log('Not expecting answer, signaling state is:', peerConnection.signalingState);
                            return;
                        }
                        
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                        break;
                        
                    case 'ice-candidate':
                        if (candidate && candidate.candidate && candidate.sdpMid !== null && candidate.sdpMLineIndex !== null) {
                            // Only add ICE candidates if we have a remote description
                            if (peerConnection.remoteDescription) {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                            } else {
                                console.log('No remote description set, queuing ICE candidate');
                                // You could queue ICE candidates here if needed
                            }
                        }
                        break;
                }
            }
        } catch (error) {
            console.error('Error handling signal:', error);
            // Remove from pending signals on error
            this.pendingSignals.delete(signalKey);
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
        console.log(`Handling remote stream from ${peerId}`);
        
        // Check participant data to determine how to handle the stream
        database.ref(`rooms/${this.roomId}/participants/${peerId}`).once('value').then(snapshot => {
            const participantData = snapshot.val();
            if (participantData) {
                if (this.userRole === 'student' && participantData.role === 'teacher') {
                    // Student receiving teacher's stream
                    this.teacherVideo.srcObject = stream;
                    this.teacherTitle.textContent = `${participantData.name}'s Screen`;
                    if (participantData.screenSharing) {
                        this.teacherTitle.textContent = `${participantData.name} - Screen Sharing`;
                    }
                } else if (this.userRole === 'teacher' && participantData.role === 'student') {
                    // Teacher receiving student's stream - show in grid
                    this.showParticipantVideo(peerId, stream);
                }
            }
        }).catch(error => {
            console.error('Error checking participant data:', error);
        });
    }

    showParticipantVideo(peerId, stream) {
        const participantCard = document.getElementById(`participant-${peerId}`);
        if (participantCard) {
            const videoElement = participantCard.querySelector('.participant-video');
            if (videoElement) {
                videoElement.srcObject = stream;
                videoElement.onloadedmetadata = () => {
                    videoElement.play().catch(e => console.log('Play error:', e));
                };
            }
        }
    }

    // Replace all video tracks in existing peer connections with screen share
    async replaceAllVideoTracks(newStream) {
        const videoTrack = newStream.getVideoTracks()[0];
        if (!videoTrack) return;

        const promises = Object.entries(this.peers).map(async ([peerId, peerConnection]) => {
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
        });

        await Promise.all(promises);
    }

    // Switch all video tracks back to camera
    async switchBackToCamera() {
        if (!this.localStream) return;

        const cameraVideoTrack = this.localStream.getVideoTracks()[0];
        if (!cameraVideoTrack) return;

        const promises = Object.entries(this.peers).map(async ([peerId, peerConnection]) => {
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
        });

        await Promise.all(promises);
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
                // Start screen sharing
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { 
                        cursor: 'always',
                        displaySurface: 'window'
                    },
                    audio: true
                });

                // Replace video tracks in all existing peer connections
                await this.replaceAllVideoTracks(this.screenStream);

                this.isScreenSharing = true;

                // Update Firebase
                await database.ref(`rooms/${this.roomId}/screenShare`).set({
                    active: true,
                    teacherId: this.userId,
                    teacherName: this.userName,
                    startedAt: firebase.database.ServerValue.TIMESTAMP
                });

                // Handle when user stops sharing via browser UI
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

        // Switch back to camera in all peer connections
        await this.switchBackToCamera();

        this.isScreenSharing = false;

        // Update Firebase
        await database.ref(`rooms/${this.roomId}/screenShare`).set({
            active: false
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
            // Another teacher is sharing screen
            this.screenSharingTeacherId = screenData.teacherId;
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = `${screenData.teacherName} - Screen Sharing`;
            }
        } else if (!screenData || !screenData.active) {
            // No active screen sharing
            if (this.userRole === 'student') {
                this.teacherTitle.textContent = "Teacher's Screen";
            }
        }
    }

    // UI Updates
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
        const icon = this.isHandRaised ? '✋' : '✋';
        const text = this.isHandRaised ? 'Lower Hand' : 'Raise Hand';
        
        this.raiseHandBtn.querySelector('.control-icon').textContent = icon;
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
            // Close all peer connections
            Object.keys(this.peers).forEach(peerId => {
                this.closePeerConnection(peerId);
            });

            // Stop media streams
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
            }

            // Clean up Firebase references
            if (this.participantsRef) this.participantsRef.off();
            if (this.signalsRef) this.signalsRef.off();
            if (this.screenShareRef) this.screenShareRef.off();

            // Remove user from Firebase
            const userRef = database.ref(`rooms/${this.roomId}/participants/${this.userId}`);
            await userRef.remove();

            if (this.userRole === 'teacher' && this.isScreenSharing) {
                await database.ref(`rooms/${this.roomId}/screenShare`).set({
                    active: false
                });
            }

            // Reload the page to reset everything
            location.reload();
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.virtualClassroom = new VirtualClassroom();
});