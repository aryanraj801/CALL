import { useState, useRef, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  profilePic?: string;
  bio?: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSharingScreen: boolean;
  isRemoteControlled: boolean;
  controlPermissionLevel: 'none' | 'view' | 'interact' | 'full';
}

export interface ConnectionStats {
  videoLatency: number;
  audioLatency: number;
  packetLoss: number;
  jitter: number;
}

export interface UserPresenceProfile {
  profilePic?: string;
  bio?: string;
}

type AliasProfile = {
  name: string;
  avatar: string;
  profilePic: string;
  bio: string;
};

export function useWebRTC(roomName: string, defaultName: string, profile: UserPresenceProfile = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myAlias, setMyAlias] = useState<AliasProfile>({ name: defaultName, avatar: '👤', profilePic: profile.profilePic || '', bio: profile.bio || '' });
  const [isAliasEnabled, setIsAliasEnabled] = useState(false);

  // Remote Control (Phase 4)
  const [controlledBy, setControlledBy] = useState<string | null>(null);
  const [isRemoteControlRequested, setIsRemoteControlRequested] = useState(false);
  const [pendingControlRequestFrom, setPendingControlRequestFrom] = useState<string | null>(null);
  const [pendingControlRequestType, setPendingControlRequestType] = useState<'mouse' | 'keyboard' | 'both'>('both');
  const [controlLogs, setControlLogs] = useState<string[]>([]);

  // Remote Control — active session tracking
  // isControllingTarget: true when THIS client is injecting inputs into a remote host
  // grantedControlTargetId: socket ID of the host we're controlling
  // grantedAccessType: what was approved ('mouse' | 'keyboard' | 'both')
  // remoteControlledBy: for the HOST — the socket ID currently controlling us
  // isHostOverrideActive: true for a brief moment after host reclaims control (UI feedback)
  const [isControllingTarget, setIsControllingTarget] = useState(false);
  const [grantedControlTargetId, setGrantedControlTargetId] = useState<string | null>(null);
  const [grantedAccessType, setGrantedAccessType] = useState<'mouse' | 'keyboard' | 'both'>('both');
  const [remoteControlledBy, setRemoteControlledBy] = useState<string | null>(null);
  const [isHostOverrideActive, setIsHostOverrideActive] = useState(false);

  // Refs for capture/inject cleanup — stored outside React state to avoid re-render overhead
  const captureListenersRef = useRef<{ type: string; fn: EventListener }[]>([]);
  const overrideListenersRef = useRef<{ type: string; fn: EventListener }[]>([]);
  const controlledByRef = useRef<string | null>(null);          // host's ref to requester
  const grantedTargetRef = useRef<string | null>(null);         // requester's ref to host
  const grantedAccessTypeRef = useRef<'mouse' | 'keyboard' | 'both'>('both');

  // BUG FIX #1 & #3: Use a single socketRef (no duplicate useState socket).
  // Use a myAliasRef to always read the latest alias from inside the persistent
  // socket effect without adding myAlias to the dependency array.
  const socketRef = useRef<Socket | null>(null);
  const myAliasRef = useRef(myAlias);
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});

  const [stats, setStats] = useState<ConnectionStats>({
    videoLatency: 45,
    audioLatency: 22,
    packetLoss: 0,
    jitter: 4,
  });

  // Keep the alias ref in sync with state (no extra render cost)
  useEffect(() => {
    myAliasRef.current = myAlias;
  }, [myAlias]);

  useEffect(() => {
    setMyAlias(prev => {
      const next = { ...prev, profilePic: profile.profilePic || '', bio: profile.bio || '' };
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: next });
      }
      return next;
    });
  }, [profile.profilePic, profile.bio]);

  useEffect(() => {
    if (isAliasEnabled) return;
    setMyAlias(prev => {
      const next = { ...prev, name: defaultName, profilePic: profile.profilePic || '', bio: profile.bio || '' };
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: next });
      }
      return next;
    });
  }, [defaultName, isAliasEnabled, profile.profilePic, profile.bio]);

  // Synchronize local screen sharing status with signaling server in real time
  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('toggle_screenshare', { isSharing: !!screenStream });
    }
  }, [screenStream]);

  // BUG FIX #4: Emit update_alias over the existing socket instead of
  // causing a reconnect. Toggling alias never touches the dep array now.
  const toggleAlias = useCallback(() => {
    setIsAliasEnabled(prev => {
      const next = !prev;
      let newAlias: AliasProfile;
      if (next) {
        const randId = Math.floor(1000 + Math.random() * 9000);
        newAlias = {
          name: `GhostParticipant_${randId}`,
          avatar: ['🦊', '🦉', '🐱', '🐼', '🐸', '🐨'][Math.floor(Math.random() * 6)],
          profilePic: profile.profilePic || '',
          bio: profile.bio || '',
        };
      } else {
        newAlias = { name: defaultName, avatar: '👤', profilePic: profile.profilePic || '', bio: profile.bio || '' };
      }
      setMyAlias(newAlias);
      // Emit alias update over existing live socket — no reconnect needed
      if (socketRef.current?.connected) {
        socketRef.current.emit('update_alias', { userAlias: newAlias });
      }
      return next;
    });
  }, [defaultName, profile.profilePic, profile.bio]);

  const syncMediaState = (stream: MediaStream | null) => {
    setAudioEnabled(stream?.getAudioTracks()[0]?.enabled ?? false);
    setVideoEnabled(stream?.getVideoTracks()[0]?.enabled ?? false);
  };

  const initMedia = async (callType: 'voice' | 'video' = 'video') => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      setAudioEnabled(false);
      setVideoEnabled(false);
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true,
      });
      setLocalStream(stream);
      syncMediaState(stream);
      return stream;
    } catch (err) {
      console.error('Failed to get user media devices:', err);
      if (callType === 'voice') {
          // If only voice was requested but failed, we cannot provide a canvas fallback for audio
          return null;
      }
      // Mock stream for testing in non-camera environments
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1e1b4b';
        ctx.fillRect(0, 0, 640, 480);
      }
      const stream = (canvas as HTMLCanvasElement).captureStream(30);
      setLocalStream(stream);
      syncMediaState(stream);
      return stream;
    }
  };

  // BUG FIX #5: Do NOT recreate the MediaStream object on toggle — this breaks
  // the AudioContext source binding in useAudioPipeline. Simply toggle .enabled.
  const toggleVideo = async () => {
    if (!localStream) {
      await initMedia('video');
      return;
    }
    const stream = localStream;
    let track = stream.getVideoTracks()[0];

    // Hardware issue: If the track is completely stopped and released by the browser to turn the camera off
    // we need a new track. However, replacing tracks breaks DSP, but DSP is audio!
    // It's perfectly safe to fetch a new video track and replace it.
    if (!track || track.readyState === 'ended') {
       try {
           const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
           const newTrack = newStream.getVideoTracks()[0];
           stream.addTrack(newTrack);

           // Replace the track in all active RTCPeerConnections
           Object.values(peerConnectionsRef.current).forEach(pc => {
             const sender = pc.getSenders().find(s => s.track?.kind === 'video');
             if (sender) {
               sender.replaceTrack(newTrack);
             }
           });

           setVideoEnabled(true);
       } catch (err) {
           console.error('Failed to get video track', err);
       }
       return;
    }

    if (track.enabled) {
      // Hardware issue: user wants camera physically off (light off)
      track.stop();
      stream.removeTrack(track);

      // We must explicitly replace the track in senders with null to stop transmission properly
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
           sender.replaceTrack(null);
        }
      });

      setVideoEnabled(false);
    } else {
      track.enabled = true;
      setVideoEnabled(true);
    }
  };

  const toggleAudio = async () => {
    if (!localStream) {
      await initMedia('voice');
      return;
    }
    const stream = localStream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      // We only toggle .enabled for audio to avoid breaking DSP Context bindings
      track.enabled = !track.enabled;
      setAudioEnabled(track.enabled);
    }
  };

  const toggleScreenShare = async () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null);
        };
      } catch (err) {
        console.error('Display capture failed:', err);
      }
    }
  };

  // ── INPUT CAPTURE (Requester side) ─────────────────────────────────────────
  // Attach document-level listeners that intercept the requester's physical
  // mouse/keyboard events and relay them to the host over the socket.
  const startInputCapture = useCallback((targetId: string, accessType: 'mouse' | 'keyboard' | 'both') => {
    stopInputCapture(); // ensure no duplicate listeners

    grantedTargetRef.current = targetId;
    grantedAccessTypeRef.current = accessType;

    const emit = (inputType: string, payload: Record<string, unknown>) => {
      socketRef.current?.emit('remote_input', {
        targetId,
        inputType,
        payload,
        accessType,
      });
    };

    const listeners: { type: string; fn: EventListener }[] = [];

    if (accessType === 'mouse' || accessType === 'both') {
      const onMouseMove = (e: Event) => {
        const me = e as MouseEvent;
        emit('mousemove', {
          x: me.clientX, y: me.clientY,
          screenX: me.screenX, screenY: me.screenY,
          movementX: me.movementX, movementY: me.movementY,
        });
      };
      const onMouseDown = (e: Event) => {
        const me = e as MouseEvent;
        emit('mousedown', { x: me.clientX, y: me.clientY, button: me.button });
      };
      const onMouseUp = (e: Event) => {
        const me = e as MouseEvent;
        emit('mouseup', { x: me.clientX, y: me.clientY, button: me.button });
      };
      const onClick = (e: Event) => {
        const me = e as MouseEvent;
        emit('click', { x: me.clientX, y: me.clientY, button: me.button });
      };
      document.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('click', onClick);
      listeners.push(
        { type: 'mousemove', fn: onMouseMove as EventListener },
        { type: 'mousedown', fn: onMouseDown as EventListener },
        { type: 'mouseup',   fn: onMouseUp   as EventListener },
        { type: 'click',     fn: onClick      as EventListener },
      );
    }

    if (accessType === 'keyboard' || accessType === 'both') {
      const onKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent;
        emit('keydown', { key: ke.key, code: ke.code, ctrlKey: ke.ctrlKey, shiftKey: ke.shiftKey, altKey: ke.altKey });
      };
      const onKeyUp = (e: Event) => {
        const ke = e as KeyboardEvent;
        emit('keyup', { key: ke.key, code: ke.code, ctrlKey: ke.ctrlKey, shiftKey: ke.shiftKey, altKey: ke.altKey });
      };
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      listeners.push(
        { type: 'keydown', fn: onKeyDown as EventListener },
        { type: 'keyup',   fn: onKeyUp   as EventListener },
      );
    }

    captureListenersRef.current = listeners;
    setIsControllingTarget(true);
    setGrantedControlTargetId(targetId);
    setGrantedAccessType(accessType);
    setControlLogs(prev => [...prev, `[Chaperone] ✅ Input capture ACTIVE — injecting ${accessType} inputs into remote session`]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down all capture listeners (called on stop, override, or revoke)
  const stopInputCapture = useCallback(() => {
    captureListenersRef.current.forEach(({ type, fn }) => document.removeEventListener(type, fn));
    captureListenersRef.current = [];
    grantedTargetRef.current = null;
    setIsControllingTarget(false);
    setGrantedControlTargetId(null);
  }, []);

  // ── INPUT INJECTION (Host side) ──────────────────────────────────────────────
  // Synthesize DOM events from the requester's relayed payload.
  // Uses the currently focused element or document.body as injection target.
  const injectRemoteInput = useCallback((inputType: string, payload: Record<string, unknown>) => {
    const target = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement
      : document.elementFromPoint(payload.x as number, payload.y as number) || document.body;

    if (inputType === 'mousemove' || inputType === 'mousedown' || inputType === 'mouseup' || inputType === 'click') {
      const evt = new MouseEvent(inputType, {
        bubbles: true, cancelable: true,
        clientX: payload.x as number, clientY: payload.y as number,
        screenX: payload.screenX as number || 0,
        screenY: payload.screenY as number || 0,
        button: payload.button as number || 0,
        buttons: inputType === 'mousedown' ? 1 : 0,
      });
      // Mark as synthetic so override listeners can distinguish physical input
      Object.defineProperty(evt, '__synthetic', { value: true });
      target.dispatchEvent(evt);
    }
    if (inputType === 'keydown' || inputType === 'keyup') {
      const evt = new KeyboardEvent(inputType, {
        bubbles: true, cancelable: true,
        key: payload.key as string,
        code: payload.code as string,
        ctrlKey: !!payload.ctrlKey, shiftKey: !!payload.shiftKey, altKey: !!payload.altKey,
      });
      Object.defineProperty(evt, '__synthetic', { value: true });
      (document.activeElement || document.body).dispatchEvent(evt);
    }
  }, []);

  // ── HOST OVERRIDE DETECTION (Host side) ──────────────────────────────────────
  // Attach capture-phase listeners that fire BEFORE any injected synthetic events.
  // If the event is NOT synthetic, the host has physically touched their device —
  // immediately emit control_override to the server.
  const startOverrideDetection = useCallback((requesterId: string) => {
    stopOverrideDetection();
    controlledByRef.current = requesterId;

    const detect = (e: Event) => {
      // Skip events we ourselves dispatched synthetically
      if ((e as { __synthetic?: boolean }).__synthetic) return;
      // Host physically touched mouse or keyboard — override immediately
      console.log('[Chaperone] Host physical input detected — overriding remote control');
      socketRef.current?.emit('control_override', { requesterId });
      stopOverrideDetection();
      setControlledBy(null);
      setRemoteControlledBy(null);
      controlledByRef.current = null;
      setControlLogs(prev => [...prev, '[Chaperone] 🖐 Host physical input detected — remote control revoked']);
    };

    const types = ['mousedown', 'keydown'];
    types.forEach(type => {
      // capture: true ensures this fires before any bubbled synthetic event handlers
      document.addEventListener(type, detect, { capture: true });
    });
    overrideListenersRef.current = types.map(type => ({ type, fn: detect as EventListener }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopOverrideDetection = useCallback(() => {
    overrideListenersRef.current.forEach(({ type, fn }) => {
      document.removeEventListener(type, fn, { capture: true } as EventListenerOptions);
    });
    overrideListenersRef.current = [];
  }, []);

  // ── REMOTE CONTROL API HANDSHAKES (Chaperone protocol) ───────────────────────
  const requestRemoteControl = (targetId: string, accessType: 'mouse' | 'keyboard' | 'both' = 'both') => {
    setIsRemoteControlRequested(true);
    socketRef.current?.emit('control_request', { targetId, requesterName: myAliasRef.current.name, accessType });
    setControlLogs(prev => [...prev, `[System] Sent remote control request (${accessType}) to client ${targetId}`]);
  };

  const respondToControlRequest = (requesterId: string, approved: boolean, level: 'none' | 'view' | 'interact' | 'full' = 'none') => {
    socketRef.current?.emit('control_response', { requesterId, approved, level });
    setPendingControlRequestFrom(null);
    if (approved) {
      setControlledBy(requesterId);
      setRemoteControlledBy(requesterId);
      controlledByRef.current = requesterId;
      // Activate host override detection with capture-phase listeners
      startOverrideDetection(requesterId);
      setControlLogs(prev => [...prev, `[Chaperone] ✅ Approved remote session control (Level: ${level}) — override detection armed`]);
    } else {
      setControlLogs(prev => [...prev, `[Chaperone] Denied remote control request`]);
    }
  };

  const triggerEmergencyKill = () => {
    socketRef.current?.emit('control_revoke');
    stopInputCapture();
    stopOverrideDetection();
    setControlledBy(null);
    setRemoteControlledBy(null);
    setIsControllingTarget(false);
    controlledByRef.current = null;
    setControlLogs(prev => [...prev, `[EMERGENCY] Revoked all active remote session privileges instantly`]);
  };

  // BUG FIX #1 (Core Fix): Remove `myAlias` from the dependency array entirely.
  // The socket connection must persist across alias changes — we use myAliasRef
  // to read the current alias at the moment of connection without needing it
  // as a reactive dependency.
  useEffect(() => {
    const token = sessionStorage.getItem('nexalink_token');
    if (!token) return;

    const socket = io('http://localhost:8000', {
      autoConnect: true,
      transports: ['websocket'],
      auth: {
        token,
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      if (roomName) {
        socket.emit('join_room', { roomName, userAlias: { ...myAliasRef.current, isSharingScreen: !!screenStream } });
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('participants_changed', (updatedList: Participant[]) => {
      setParticipants(updatedList.filter(p => p.id !== socket.id));
    });

    socket.on('control_requested', ({ requesterId, requesterName, accessType }) => {
      setPendingControlRequestFrom(requesterId);
      setPendingControlRequestType(accessType || 'both');
      setControlLogs(prev => [...prev, `[Chaperone] Incoming remote control query (${accessType || 'both'}) from ${requesterName}`]);
    });

    socket.on('control_approved', ({ level }) => {
      setIsRemoteControlRequested(false);
      const targetId = grantedTargetRef.current;
      const accessType = grantedAccessTypeRef.current;
      if (targetId) {
        startInputCapture(targetId, accessType);
      }
      setControlLogs(prev => [...prev, `[System] ✅ Control approved (Level: ${level}) — input capture started`]);
    });

    socket.on('control_denied', () => {
      setIsRemoteControlRequested(false);
      grantedTargetRef.current = null;
      setControlLogs(prev => [...prev, `[Warning] Remote control request was rejected by host`]);
    });

    socket.on('remote_input', ({ inputType, payload }: { senderId: string; inputType: string; payload: Record<string, unknown> }) => {
      injectRemoteInput(inputType, payload);
    });

    socket.on('control_overridden', ({ hostId }: { hostId: string }) => {
      stopInputCapture();
      setIsRemoteControlRequested(false);
      setIsHostOverrideActive(true);
      setControlLogs(prev => [...prev, `[Chaperone] 🖐 Host <${hostId}> physically took back control — input capture stopped`]);
      setTimeout(() => setIsHostOverrideActive(false), 3000);
    });

    socket.on('control_revoked', () => {
      stopInputCapture();
      stopOverrideDetection();
      setControlledBy(null);
      setRemoteControlledBy(null);
      setIsControllingTarget(false);
      controlledByRef.current = null;
      setControlLogs(prev => [...prev, `[Revoked] Host triggered emergency kill-switch`]);
    });

    const interval = setInterval(() => {
      setStats({
        videoLatency: Math.floor(35 + Math.random() * 20),
        audioLatency: Math.floor(15 + Math.random() * 10),
        packetLoss: Math.random() > 0.95 ? 1 : 0,
        jitter: Math.floor(2 + Math.random() * 4),
      });
    }, 4000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
      stopInputCapture();
      stopOverrideDetection();
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
      peerConnectionsRef.current = {};
    };
  }, [startInputCapture, stopInputCapture, stopOverrideDetection, injectRemoteInput]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    if (roomName) {
      socket.emit('join_room', { roomName, userAlias: { ...myAliasRef.current, isSharingScreen: !!screenStream } });
    } else {
      socket.emit('leave_room');
      setParticipants([]);
    }
  }, [roomName, screenStream]);

  // BUG FIX #2: Expose socketRef.current directly instead of a duplicate useState.
  // Consumers get a stable reference through the ref rather than a stale state copy.
  return {
    socket: socketRef.current,
    isConnected,
    localStream,
    screenStream,
    audioEnabled,
    videoEnabled,
    participants,
    myAlias,
    isAliasEnabled,
    stats,
    controlledBy,
    isRemoteControlRequested,
    pendingControlRequestFrom,
    pendingControlRequestType,
    controlLogs,
    // Active control session
    isControllingTarget,
    grantedControlTargetId,
    grantedAccessType,
    remoteControlledBy,
    isHostOverrideActive,
    // Actions
    initMedia,
    toggleVideo,
    toggleAudio,
    toggleScreenShare,
    toggleAlias,
    requestRemoteControl,
    respondToControlRequest,
    triggerEmergencyKill,
    stopInputCapture,
  };
}
