import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, ShieldCheck,
  Users, MessageSquare, Radio,
  Eye, EyeOff, Sliders, Play, Lock, ShieldAlert,
  Zap, Edit2, Send, X, PhoneOff, WifiOff,
  BarChart2, Activity, Hash, LogOut,
  AlertTriangle, Headphones, Copy, PhoneCall,
  LayoutGrid, LayoutPanelLeft, LayoutPanelTop, PictureInPicture2, Columns2, Paperclip,
  Plus, User, BookUser, ImagePlus, Save, Pin, PinOff, Maximize2, Scan, MousePointer, Keyboard
} from 'lucide-react';
import { useWebRTC } from './hooks/useWebRTC.ts';
import { useAudioPipeline } from './hooks/useAudioPipeline.ts';
import { useNotifications } from './hooks/useNotifications.ts';
import Whiteboard from './components/Whiteboard.tsx';
import ChaperoneOverlay from './components/ChaperoneOverlay.tsx';

const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8001';

/* ─────────────────────────────────────────
   Types
───────────────────────────────────────── */
interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  self: boolean;
}

type Tab = 'chat' | 'audio' | 'whiteboard' | 'control' | 'participants' | 'profile' | 'contacts';

interface UserProfile {
  username: string;
  bio: string;
  profilePic: string;
}

interface Contact {
  id: string;
  username: string;
  bio: string;
  profilePic: string;
}

interface IncomingCallData {
  callerName:     string;
  callerUsername: string;
  callerId:       string;
  room:           string;
  callType:       'voice' | 'video';
  callId?:        number;
}

interface OutgoingCall {
  targetUsername: string;
  room: string;
  callType: 'voice' | 'video';
  callId?: number;
  status: 'ringing' | 'accepted' | 'declined' | 'failed';
  errorReason?: string;
}


/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
const nowTime = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const uid = () => Math.random().toString(36).slice(2, 10);

/* ─────────────────────────────────────────
   Toast
───────────────────────────────────────── */
function Toast({ msg, type, onDone }: { msg: string; type: 'success' | 'error' | 'info'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, []);
  const colors = {
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    error:   'border-rose-500/40 bg-rose-500/10 text-rose-300',
    info:    'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  };
  return (
    <div
      className={`fixed top-5 right-5 z-[9999] px-4 py-3 rounded-2xl border text-sm font-semibold shadow-2xl backdrop-blur-xl flex items-center gap-3 nx-alert ${colors[type]}`}
      style={{ maxWidth: 340 }}
    >
      {type === 'success' && <ShieldCheck className="w-4 h-4 flex-shrink-0" />}
      {type === 'error'   && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      {type === 'info'    && <Activity className="w-4 h-4 flex-shrink-0" />}
      <span>{msg}</span>
      <button onClick={onDone} className="ml-auto opacity-60 hover:opacity-100 transition">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   Main App
───────────────────────────────────────── */
/* ─────────────────────────────────────────
   Hash Routing Initializer
   ───────────────────────────────────────── */
const getInitialNavigation = (): { view: 'landing' | 'lobby' | 'connecting' | 'room'; subview: 'connect' | 'chat_lobby' } => {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_token') : null;
  const savedView = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_current_view') : null;
  const savedSubView = typeof window !== 'undefined' ? sessionStorage.getItem('nexalink_lobby_subview') : null;

  if (!token) {
    return { view: 'landing', subview: 'connect' };
  }

  if (hash === '#lobby/chat') {
    return { view: 'lobby', subview: 'chat_lobby' };
  } else if (hash === '#lobby/connect' || hash === '#lobby') {
    return { view: 'lobby', subview: 'connect' };
  } else if (hash === '#connecting') {
    return { view: 'connecting', subview: 'connect' };
  } else if (hash === '#room') {
    return { view: 'room', subview: 'connect' };
  } else {
    let view = (savedView as any) || 'lobby';
    if (view === 'room' || view === 'connecting') {
      view = 'lobby';
    }
    if (view === 'landing') {
      view = 'lobby';
    }
    return {
      view,
      subview: (savedSubView === 'chat_lobby' ? 'chat_lobby' : 'connect') as any
    };
  }
};

export default function App() {
  /* Notifications */
  const { requestPermission, unsubscribe: unsubscribeNotif, notify } = useNotifications();

  /* Auth state */
  const [authToken, setAuthToken] = useState<string | null>(() => sessionStorage.getItem('nexalink_token'));
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  /* Room state */
  const [inRoom, setInRoom] = useState(false);
  const [roomName, setRoomName] = useState('NexaRoom-Alpha');
  const [userName, setUserName] = useState('Alice');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [directPeer, setDirectPeer] = useState('');
  const [profile, setProfile] = useState<UserProfile>(() => {
    const username = sessionStorage.getItem('nexalink_username') || 'Alice';
    return { username, bio: '', profilePic: '' };
  });
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = sessionStorage.getItem('nexalink_contacts');
    return saved ? JSON.parse(saved) : [];
  });
  const [newContact, setNewContact] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'contacts' | 'calls'>('contacts');
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [activeDirectCallId, setActiveDirectCallId] = useState<number | null>(null);

  /* UI state */
  const [currentView, setCurrentView] = useState<'landing' | 'lobby' | 'connecting' | 'room'>(() => {
    const initial = getInitialNavigation();
    return initial.view;
  });
  const [activeTab, setActiveTab] = useState<Tab>('audio');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [pinnedTile, setPinnedTile] = useState<string | null>(null);
  const [hiddenTiles, setHiddenTiles] = useState<string[]>([]);
  const [requestControlTarget, setRequestControlTarget] = useState<{ id: string; name: string } | null>(null);
  // Stream layout mode — drives how the video tiles are arranged
  // 'auto'       → smart grid (default, adapts to participant count)
  // 'pip-remote' → remote party fills stage, self in small corner PiP
  // 'pip-local'  → local fills stage, remote in small corner PiP
  // 'equal'      → both tiles equal side-by-side
  // 'horizontal' → horizontal strip (self left, remotes right in column)
  const [streamLayout, setStreamLayout] = useState<'auto' | 'pip-remote' | 'pip-local' | 'equal' | 'horizontal'>('auto');

  /* Sidebar Resizing States & Logic */
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizingRef = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX - 24;
      if (newWidth > 200 && newWidth < 800) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  /* Chat */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChat, setUnreadChat] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const callStageRef = useRef<HTMLDivElement | null>(null);

  /* TTS */
  const [ttsText, setTtsText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('XTTS-v2 Host Male');
  const [ttsQueue, setTtsQueue] = useState<string[]>([]);



  /* Overhaul and Redesign States */
  const [callType, setCallType] = useState<'voice' | 'video'>('video');
  // const [isPreflightConnecting, setIsPreflightConnecting] = useState(false);
  const [locallyMutedPeers, setLocallyMutedPeers] = useState<string[]>([]);
  const [locallyHiddenPeers, setLocallyHiddenPeers] = useState<string[]>([]);
  const [lobbySubView, setLobbySubView] = useState<'connect' | 'chat_lobby' | 'settings'>(() => {
    const saved = sessionStorage.getItem('nexalink_lobby_subview');
    return (saved as any) || 'connect';
  });
  const [activeChatContact, setActiveChatContact] = useState<Contact | null>(null);
  const [lobbyChats, setLobbyChats] = useState<{ [contactId: string]: ChatMessage[] }>({});
  const [lobbyChatInput, setLobbyChatInput] = useState('');
  const [showInboxDropdown, setShowInboxDropdown] = useState(false);
  const [unreadChatCounts, setUnreadChatCounts] = useState<{ [username: string]: number }>({});
  const [pendingFiles, setPendingFiles] = useState<any[]>([]);
  const filePeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const fileDataChannelRef = useRef<RTCDataChannel | null>(null);
  const selectedFileRef = useRef<File | null>(null);
  const fileIceCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const [fileTransferProgress, setFileTransferProgress] = useState<{
    transferId: number;
    fileName: string;
    fileSize: number;
    progress: number;
    speed: string;
    status: 'connecting' | 'transferring' | 'completed' | 'failed' | 'idle';
    role: 'sender' | 'receiver';
  } | null>(null);
  const [inboxNotifications, setInboxNotifications] = useState<{ id: string; type: 'chat' | 'call'; sender: string; title: string; desc: string; time: string; read: boolean; room?: string; fileTransferId?: number }[]>(() => {
    const saved = sessionStorage.getItem('nexalink_notifications');
    return saved ? JSON.parse(saved) : [
      { id: 'n1', type: 'call', sender: 'System', title: 'Welcome to NexaLink!', desc: 'Private secure tunnel logic loaded successfully.', time: nowTime(), read: false }
    ];
  });

  /* Media & Device State Selectors */
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_mic') || 'default');
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_cam') || 'default');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(() => sessionStorage.getItem('nexalink_selected_speaker') || 'default');
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  // Incoming call modal state
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
  const callDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification permission banner — show if not yet granted/denied
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = sessionStorage.getItem('nexalink_theme');
    return (saved as 'light' | 'dark') || 'dark';
  });

  const [chatSettings, setChatSettings] = useState<{ pressEnterToSend: boolean; soundEnabled: boolean; typingIndicators: boolean }>(() => {
    const saved = sessionStorage.getItem('nexalink_chat_settings');
    return saved ? JSON.parse(saved) : { pressEnterToSend: true, soundEnabled: true, typingIndicators: true };
  });

  const [notifSettings, setNotifSettings] = useState<{ desktopEnabled: boolean; showToastAlerts: boolean; pushWakingEnabled: boolean }>(() => {
    const saved = sessionStorage.getItem('nexalink_notif_settings');
    return saved ? JSON.parse(saved) : { desktopEnabled: true, showToastAlerts: true, pushWakingEnabled: true };
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
      sessionStorage.setItem('nexalink_theme', 'light');
    } else {
      document.documentElement.classList.remove('light-mode');
      sessionStorage.setItem('nexalink_theme', 'dark');
    }
  }, [theme]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_chat_settings', JSON.stringify(chatSettings));
  }, [chatSettings]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_notif_settings', JSON.stringify(notifSettings));
  }, [notifSettings]);

  // Global 401 Unauthorized API interceptor
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
      const isAuthRequest = url.includes('/api/auth/token') || url.includes('/api/auth/register');
      
      if (response.status === 401 && !isAuthRequest) {
        console.warn('[Session] Caught 401 Unauthorized from API. Logging out.');
        
        // Clear all session states
        sessionStorage.removeItem('nexalink_token');
        sessionStorage.removeItem('nexalink_username');
        sessionStorage.removeItem('nexalink_current_view');
        sessionStorage.removeItem('nexalink_lobby_subview');
        sessionStorage.removeItem('nexalink_contacts');
        sessionStorage.removeItem('nexalink_notifications');
        
        // Reset component fields
        setAuthToken(null);
        setUserName('Alice');
        setProfile(prev => ({ ...prev, username: 'Alice' }));
        setCurrentView('landing');
        showToast('Your session has expired. Please log in again.', 'error');
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);
  const handleEnableNotifications = async () => {
    await requestPermission(userName);
    setNotifPermission('Notification' in window ? Notification.permission : 'unsupported');
  };

  useEffect(() => {
    sessionStorage.setItem('nexalink_notifications', JSON.stringify(inboxNotifications));
  }, [inboxNotifications]);

  const sendLobbyChat = async () => {
    if (!activeChatContact || !lobbyChatInput.trim()) return;
    const msgText = lobbyChatInput.trim();
    
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/dm/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ recipient: activeChatContact.username, text: msgText })
      });
      if (!res.ok) {
        throw new Error("Failed to persist message");
      }
      
      const sentMsg = await res.json();
      
      const msg: ChatMessage = {
        id: String(sentMsg.message.id),
        sender: profile.username || userName,
        text: msgText,
        time: nowTime(),
        self: true
      };
      
      setLobbyChats(prev => {
        const chatHistory = prev[activeChatContact.username] || [];
        return {
          ...prev,
          [activeChatContact.username]: [...chatHistory, msg]
        };
      });
      
      if (socket) {
        socket.emit('direct_message', {
          targetUsername: activeChatContact.username,
          senderUsername: userName,
          senderName: profile.username || userName,
          text: msgText,
          time: msg.time
        });
      }
      
      setLobbyChatInput('');
    } catch (err) {
      console.error("Failed to send lobby message:", err);
      showToast("Failed to deliver message.", "error");
    }
  };

  const loadContactsFromServer = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/contacts/list`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
      }
    } catch (err) {
      console.error("Failed to load contacts from server:", err);
    }
  };

  const loadCallHistoryFromServer = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/calls/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCallHistory(data);
      }
    } catch (err) {
      console.error("Failed to load call history:", err);
    }
  };

  const updateCallStatusOnServer = async (callId: number, status: string, ended = false) => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/calls/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ call_id: callId, status, ended })
      });
      loadCallHistoryFromServer();
    } catch (err) {
      console.error("Failed to update call status:", err);
    }
  };

  const loadChatHistory = async (otherUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/dm/history/${otherUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const chatMsgs = data.map((msg: any) => ({
          id: String(msg.id),
          sender: msg.sender,
          text: msg.text,
          time: new Date(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          self: msg.sender.toLowerCase() === userName.toLowerCase()
        }));
        setLobbyChats(prev => ({
          ...prev,
          [otherUser]: chatMsgs
        }));
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  };

  const removeContact = async (contactUsername: string) => {
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/contacts/remove/${contactUsername}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        showToast(`${contactUsername} removed persistently.`, 'success');
        await loadContactsFromServer();
        if (activeChatContact?.username === contactUsername) {
          setActiveChatContact(null);
        }
      }
    } catch (err) {
      console.error("Failed to remove contact:", err);
      showToast("Error removing contact", "error");
    }
  };

  const loadPendingMessages = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/dm/unread`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setLobbyChats(prev => {
            const nextChats = { ...prev };
            const nextUnreadCounts = { ...unreadChatCounts };
            const newNotifications = [...inboxNotifications];
            
            data.forEach((msg: any) => {
              const senderUser = msg.sender;
              const chatMsg: ChatMessage = {
                id: String(msg.id),
                sender: senderUser,
                text: msg.text,
                time: new Date(msg.sent_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                self: false
              };
              
              const chatHistory = nextChats[senderUser] || [];
              if (!chatHistory.some(m => m.id === chatMsg.id)) {
                nextChats[senderUser] = [...chatHistory, chatMsg];
                
                if (!activeChatContact || activeChatContact.username.toLowerCase() !== senderUser.toLowerCase()) {
                  nextUnreadCounts[senderUser] = (nextUnreadCounts[senderUser] || 0) + 1;
                }
                
                newNotifications.unshift({
                  id: `unread-${msg.id}`,
                  type: 'chat',
                  sender: senderUser,
                  title: `Unread message from ${senderUser}`,
                  desc: msg.text.slice(0, 60),
                  time: chatMsg.time,
                  read: false
                });
              }
            });
            
            setUnreadChatCounts(nextUnreadCounts);
            setInboxNotifications(newNotifications.slice(0, 50));
            return nextChats;
          });
          
          showToast(`Retrieved ${data.length} pending message${data.length > 1 ? 's' : ''}.`, 'info');
        }
      }
    } catch (err) {
      console.error("Failed to load pending messages:", err);
    }
  };

  const loadPendingFiles = async () => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/files/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPendingFiles(data);
        // Add them to notifications if not already added
        setInboxNotifications(prev => {
          const next = [...prev];
          data.forEach((f: any) => {
            const nid = `file-${f.id}`;
            if (!next.some(n => n.id === nid)) {
              next.unshift({
                id: nid,
                type: 'chat' as const,
                sender: f.sender,
                title: `Incoming File: ${f.file_name}`,
                desc: `Size: ${(f.file_size / (1024 * 1024)).toFixed(2)} MB`,
                time: new Date(f.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                read: false,
                fileTransferId: f.id
              });
            }
          });
          return next.slice(0, 50);
        });
      }
    } catch (err) {
      console.error("Failed to load pending file transfers:", err);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatContact) return;

    if (file.size > 100 * 1024 * 1024) {
      showToast('File size must be under 100 MB.', 'error');
      return;
    }

    selectedFileRef.current = file;
    showToast(`Initiating transfer: ${file.name}...`, 'info');

    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/files/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          recipient: activeChatContact.username,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream'
        })
      });
      
      if (!res.ok) {
        throw new Error("Failed to store file metadata on server.");
      }
      
      const data = await res.json();
      const transferId = data.transfer_id;

      const msg: ChatMessage = {
        id: `file-init-${transferId}`,
        sender: profile.username || userName,
        text: `📁 Initiated file transfer request: ${file.name} (${(file.size / (1024*1024)).toFixed(2)} MB)`,
        time: nowTime(),
        self: true
      };

      setLobbyChats(prev => {
        const chatHistory = prev[activeChatContact.username] || [];
        return {
          ...prev,
          [activeChatContact.username]: [...chatHistory, msg]
        };
      });

      if (socket) {
        socket.emit('file_transfer_initiate', {
          transferId,
          senderUsername: userName,
          recipientUsername: activeChatContact.username,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream'
        });
      }

      setFileTransferProgress({
        transferId,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        speed: '0.00 KB/s',
        status: 'connecting',
        role: 'sender'
      });
      
    } catch (err) {
      console.error("Failed to initiate file transfer:", err);
      showToast("Error starting transfer request.", "error");
    }
  };

  const initiateFilePeerConnection = async (recipient: string, file: File, transferId: number) => {
    setFileTransferProgress({
      transferId,
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      speed: '0.00 KB/s',
      status: 'connecting',
      role: 'sender'
    });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    filePeerConnectionRef.current = pc;

    const channel = pc.createDataChannel('fileTransfer', { ordered: true });
    fileDataChannelRef.current = channel;

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('file_ice_candidate', {
          targetUsername: recipient,
          candidate: e.candidate,
          senderUsername: userName
        });
      }
    };

    channel.onopen = () => {
      console.log('[WebRTC File] Data Channel opened! Streaming file...');
      sendFileInChunks(file, channel, transferId);
    };

    channel.onclose = () => {
      console.log('[WebRTC File] Data Channel closed.');
    };

    channel.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data === '{CANCEL}') {
          console.log('[WebRTC File] Recipient cancelled the transfer.');
          cleanupFilePeerConnection();
          setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
          showToast('File transfer was cancelled by the recipient.', 'error');
        }
      }
    };

    channel.onerror = (err) => {
      console.error('[WebRTC File] Data Channel error:', err);
      setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (socket) {
      socket.emit('file_offer', {
        targetUsername: recipient,
        offer,
        senderUsername: userName
      });
    }
  };

  const sendFileInChunks = (file: File, channel: RTCDataChannel, transferId: number) => {
    console.log(`[WebRTC File] Initiating chunked stream for transfer ID: ${transferId}`);
    const CHUNK_SIZE = 16384;
    const reader = new FileReader();
    let offset = 0;
    const startTime = Date.now();

    const readSlice = (o: number) => {
      const slice = file.slice(offset, o + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          sendChunk(buffer);
        };
        return;
      }
      sendChunk(buffer);
    };

    const sendChunk = (buffer: ArrayBuffer) => {
      channel.send(buffer);
      offset += buffer.byteLength;

      const elapsed = (Date.now() - startTime) / 1000;
      const speedBps = elapsed > 0 ? (offset / elapsed) : 0;
      const speedStr = speedBps > 1024 * 1024 
        ? `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`
        : `${(speedBps / 1024).toFixed(2)} KB/s`;

      const progress = Math.min(100, Math.round((offset / file.size) * 100));

      setFileTransferProgress(prev => prev ? { 
        ...prev, 
        progress,
        speed: speedStr,
        status: 'transferring'
      } : null);

      if (offset < file.size) {
        readSlice(offset);
      } else {
        setTimeout(() => {
          channel.send('{DONE}');
          setFileTransferProgress(prev => prev ? { ...prev, status: 'completed', progress: 100 } : null);
          showToast(`File transfer complete: ${file.name}`, 'success');
          selectedFileRef.current = null;
          const fileInput = document.getElementById('secure-file-input') as HTMLInputElement;
          if (fileInput) fileInput.value = '';
        }, 500);
      }
    };

    channel.bufferedAmountLowThreshold = 1024 * 1024;
    readSlice(0);
  };

  const acceptFileTransfer = async (transfer: { id: number; sender: string; file_name: string; file_size: number; file_type: string }) => {
    const transferId = transfer.id;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/files/respond/${transferId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'accepted' })
      });
    } catch (err) {
      console.error("Failed to respond to file transfer on server:", err);
    }

    setPendingFiles(prev => prev.filter(f => f.id !== transferId));

    if (socket) {
      socket.emit('file_transfer_response', {
        transferId,
        status: 'accepted',
        recipientUsername: userName,
        senderUsername: transfer.sender
      });
    }

    setFileTransferProgress({
      transferId,
      fileName: transfer.file_name,
      fileSize: transfer.file_size,
      progress: 0,
      speed: '0.00 KB/s',
      status: 'connecting',
      role: 'receiver'
    });

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    filePeerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('file_ice_candidate', {
          targetUsername: transfer.sender,
          candidate: e.candidate,
          senderUsername: userName
        });
      }
    };

    const receivedBuffers: ArrayBuffer[] = [];
    let receivedSize = 0;
    let startTime = Date.now();

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      fileDataChannelRef.current = channel;

      channel.onmessage = (e) => {
        if (typeof e.data === 'string') {
          if (e.data === '{CANCEL}') {
            console.log('[WebRTC File] Cancelled by remote peer!');
            cleanupFilePeerConnection();
            setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
            showToast('File transfer was cancelled by the peer.', 'error');
            return;
          }
          if (e.data === '{DONE}') {
            console.log('[WebRTC File] Complete! Aggregating file...');
            const fileBlob = new Blob(receivedBuffers, { type: transfer.file_type });
            const fileUrl = URL.createObjectURL(fileBlob);
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = transfer.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setFileTransferProgress(prev => prev ? { ...prev, status: 'completed', progress: 100 } : null);
            showToast(`File download completed: ${transfer.file_name}`, 'success');
            cleanupFilePeerConnection();
            return;
          }
        }

        const buffer = e.data as ArrayBuffer;
        receivedBuffers.push(buffer);
        receivedSize += buffer.byteLength;

        const elapsed = (Date.now() - startTime) / 1000;
        const speedBps = elapsed > 0 ? (receivedSize / elapsed) : 0;
        const speedStr = speedBps > 1024 * 1024 
          ? `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`
          : `${(speedBps / 1024).toFixed(2)} KB/s`;

        const progress = Math.min(100, Math.round((receivedSize / transfer.file_size) * 100));

        setFileTransferProgress(prev => prev ? { 
          ...prev, 
          progress,
          speed: speedStr,
          status: 'transferring'
        } : null);
      };

      channel.onerror = (err) => {
        console.error('[WebRTC File] Receiver channel error:', err);
        setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
      };
    };

    showToast('Waiting for peer data channel connection...', 'info');
  };

  const cleanupFilePeerConnection = () => {
    if (fileDataChannelRef.current) {
      try {
        fileDataChannelRef.current.close();
      } catch (e) {}
      fileDataChannelRef.current = null;
    }
    if (filePeerConnectionRef.current) {
      try {
        filePeerConnectionRef.current.close();
      } catch (e) {}
      filePeerConnectionRef.current = null;
    }
    fileIceCandidatesQueueRef.current = [];
  };

  const cancelFileTransfer = (remoteUser: string) => {
    // 1. Send CANCEL control phrase if channel is open
    if (fileDataChannelRef.current && fileDataChannelRef.current.readyState === 'open') {
      try {
        fileDataChannelRef.current.send('{CANCEL}');
      } catch (e) {
        console.error('[WebRTC File] Error sending CANCEL over data channel:', e);
      }
    }

    // 2. Emit cancel via socket relay in case connection is still negotiating
    if (socket && fileTransferProgress) {
      socket.emit('file_transfer_cancel', {
        transferId: fileTransferProgress.transferId,
        targetUsername: remoteUser,
        senderUsername: userName
      });
    }

    // 3. Close and purge peer connection
    cleanupFilePeerConnection();
    selectedFileRef.current = null;

    // 4. Update local state
    setFileTransferProgress(prev => prev ? { ...prev, status: 'failed' } : null);
    showToast('File transfer cancelled.', 'info');
  };

  const declineFileTransfer = async (transfer: { id: number; sender: string }) => {
    const transferId = transfer.id;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      await fetch(`${API}/api/files/respond/${transferId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'declined' })
      });
    } catch (err) {
      console.error("Failed to decline file transfer on server:", err);
    }

    setPendingFiles(prev => prev.filter(f => f.id !== transferId));

    if (socket) {
      socket.emit('file_transfer_response', {
        transferId,
        status: 'declined',
        recipientUsername: userName,
        senderUsername: transfer.sender
      });
    }
    showToast('File transfer request declined.', 'info');
  };

  const markMessagesAsRead = async (otherUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      await fetch(`${API}/api/dm/read/${otherUser}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setUnreadChatCounts(prev => {
        const nextCounts = { ...prev };
        delete nextCounts[otherUser];
        return nextCounts;
      });
    } catch (err) {
      console.error("Failed to mark messages as read:", err);
    }
  };

  useEffect(() => {
    if (authToken) {
      loadContactsFromServer();
      loadCallHistoryFromServer();
      loadPendingMessages();
      loadPendingFiles();
    } else {
      setContacts([]);
      setCallHistory([]);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken && sidebarTab === 'calls') {
      loadCallHistoryFromServer();
    }
  }, [authToken, sidebarTab]);

  useEffect(() => {
    if (activeChatContact) {
      loadChatHistory(activeChatContact.username);
      markMessagesAsRead(activeChatContact.username);
    }
  }, [activeChatContact]);

  const loadProfileFromDB = async (targetUser: string) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/profile/${targetUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile({
          username: data.username || targetUser,
          bio: data.bio || '',
          profilePic: data.profile_pic || ''
        });

        // Restore settings if targetUser is the current user
        const currentUser = sessionStorage.getItem('nexalink_username') || userName;
        if (targetUser.toLowerCase() === currentUser.toLowerCase()) {
          if (data.theme) {
            setTheme(data.theme);
            sessionStorage.setItem('nexalink_theme', data.theme);
          }
          if (data.chat_settings) {
            setChatSettings(data.chat_settings);
            sessionStorage.setItem('nexalink_chat_settings', JSON.stringify(data.chat_settings));
          }
          if (data.notif_settings) {
            setNotifSettings(data.notif_settings);
            sessionStorage.setItem('nexalink_notif_settings', JSON.stringify(data.notif_settings));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load profile from database:', err);
    }
  };

  const pushProfileToDB = async (updatedProfile = profile, updatedTheme = theme, updatedChat = chatSettings, updatedNotif = notifSettings) => {
    const token = sessionStorage.getItem('nexalink_token') || authToken;
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/profile/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: updatedProfile.username,
          bio: updatedProfile.bio,
          profile_pic: updatedProfile.profilePic,
          theme: updatedTheme,
          chat_settings: updatedChat,
          notif_settings: updatedNotif
        })
      });
      if (res.ok) {
        showToast('Profile and settings saved to database server.', 'success');
      } else {
        showToast('Failed to save profile to database.', 'error');
      }
    } catch (err) {
      console.error('Failed to sync profile to database:', err);
      showToast('Database server error while saving profile.', 'error');
    }
  };

  /* Restore username */
  useEffect(() => {
    const saved = sessionStorage.getItem('nexalink_username');
    if (saved) {
      setUserName(saved);
      setProfile(prev => ({ ...prev, username: saved }));
      loadProfileFromDB(saved);
    }
  }, [authToken]);

  /* Dynamic Page Scroll Control */
  useEffect(() => {
    if (!authToken) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [authToken]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_contacts', JSON.stringify(contacts));
  }, [contacts]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_current_view', currentView);
  }, [currentView]);

  useEffect(() => {
    sessionStorage.setItem('nexalink_lobby_subview', lobbySubView);
  }, [lobbySubView]);

  /* Scroll chat to bottom */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (activeTab === 'chat') setUnreadChat(0);
  }, [activeTab]);

  /* Toast helper */
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
  }, []);

  const buildInviteLink = useCallback((targetRoom = roomName) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', targetRoom);
    return url.toString();
  }, [roomName]);

  const copyInviteLink = useCallback(async (targetRoom = roomName) => {
    const invite = buildInviteLink(targetRoom);
    try {
      await navigator.clipboard.writeText(invite);
      showToast('Invite link copied.', 'success');
    } catch {
      window.prompt('Invite link', invite);
    }
  }, [buildInviteLink, roomName, showToast]);

  const handleProfilePicUpload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file for your profile picture.', 'error');
      return;
    }
    if (file.size > 750_000) {
      showToast('Profile picture must be under 750 KB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfile(prev => ({ ...prev, profilePic: String(reader.result || '') }));
      showToast('Profile picture updated.', 'success');
    };
    reader.readAsDataURL(file);
  };

  const addContact = async () => {
    const username = newContact.trim();
    if (!username) return;
    
    if (username.toLowerCase() === userName.toLowerCase()) {
      showToast("You cannot add yourself as a contact.", "error");
      return;
    }
    
    if (contacts.some(c => c.username.toLowerCase() === username.toLowerCase())) {
      showToast('That contact is already saved.', 'info');
      return;
    }
    
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/contacts/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ contact_username: username })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to add contact');
      }
      
      if (socket) {
        socket.emit('add_contact', { targetUsername: username, addedBy: userName });
      }
      
      await loadContactsFromServer();
      setNewContact('');
      showToast(`${username} added persistently.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Error adding contact', 'error');
    }
  };

  const callContact = async (username: string) => {
    setDirectPeer(username);
    const participants = [userName, username]
      .map(name => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
      .sort();
    const directRoom = `Direct-${participants.join('-')}`;
    copyInviteLink(directRoom);
    
    let callId: number | undefined;
    try {
      const token = sessionStorage.getItem('nexalink_token') || authToken;
      const res = await fetch(`${API}/api/calls/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          callee: username,
          call_type: callType,
          room_name: directRoom
        })
      });
      if (res.ok) {
        const logData = await res.json();
        callId = logData.call_id;
        if (callId) {
          setActiveDirectCallId(callId);
        }
      }
    } catch (err) {
      console.error("Failed to log call:", err);
    }

    setOutgoingCall({
      targetUsername: username,
      room: directRoom,
      callType: callType,
      callId: callId,
      status: 'ringing'
    });

    if (socket) {
      socket.emit('call_invite', {
        targetUsername: username,
        callerName:     profile.username || userName,
        callerUsername: userName,
        room:           directRoom,
        callType:       callType,
        callId:         callId
      });
      socket.once('call_invite_failed', ({ reason }: { reason: string }) => {
        showToast(`Cannot reach ${username}: ${reason === 'offline' ? 'user is offline' : reason}`, 'error');
        setOutgoingCall(prev => prev ? { ...prev, status: 'failed', errorReason: reason === 'offline' ? 'User is offline' : reason } : null);
        if (callId) {
          updateCallStatusOnServer(callId, 'missed');
        }
      });
    }
  };

  // ── RESPOND TO INCOMING CALL ──────────────────────────────────────────────
  const handleIncomingCallResponse = async (
    action: 'leave_accept' | 'cut_accept' | 'merge' | 'ignore'
  ) => {
    if (!incomingCall) return;
    if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);

    if (action === 'ignore') {
      socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'declined' });
      if (incomingCall.callId) {
        updateCallStatusOnServer(incomingCall.callId, 'declined');
      }
      setIncomingCall(null);
      return;
    }

    if (action === 'merge') {
      socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'merged' });
      if (incomingCall.callId) {
        updateCallStatusOnServer(incomingCall.callId, 'accepted');
        setActiveDirectCallId(incomingCall.callId);
      }
      setIncomingCall(null);
      showToast(`Merging call — joining ${incomingCall.callerName}'s room as well.`, 'info');
      connectToRoom(incomingCall.room, `Merged into ${incomingCall.callerName}'s room`);
      return;
    }

    if (inRoom) {
      await handleDisconnectRoom();
    }
    socket?.emit('call_response', { callerId: incomingCall.callerId, response: 'accepted' });
    if (incomingCall.callId) {
      updateCallStatusOnServer(incomingCall.callId, 'accepted');
      setActiveDirectCallId(incomingCall.callId);
    }
    setIncomingCall(null);
    connectToRoom(incomingCall.room, `Joined ${incomingCall.callerName}'s call`);
  };

  // const toggleHiddenTile = (tileId: string) => {
  //   setHiddenTiles(prev => prev.includes(tileId) ? prev.filter(id => id !== tileId) : [...prev, tileId]);
  //   if (pinnedTile === tileId) setPinnedTile(null);
  // };

  const togglePinnedTile = (tileId: string) => {
    setPinnedTile(prev => prev === tileId ? null : tileId);
    setHiddenTiles(prev => prev.filter(id => id !== tileId));
  };

  const openFullscreen = async (id?: string) => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
        showToast('Exited full screen.', 'success');
      } catch (err) {
        console.error('Failed to exit fullscreen:', err);
      }
      return;
    }
    const target = id ? document.getElementById(id) : callStageRef.current;
    try {
      await target?.requestFullscreen?.();
      showToast('Entered full screen.', 'success');
    } catch {
      showToast('Fullscreen is blocked by the browser.', 'error');
    }
  };

  const toggleLocalHide = (peerId: string) => {
    const isCurrentlyHidden = locallyHiddenPeers.includes(peerId);
    if (!isCurrentlyHidden) {
      // Trying to hide a stream. Check if that would leave 0 active streams.
      const activeCount = (locallyHiddenPeers.includes('self') ? 0 : 1) + 
                          participants.filter(p => !locallyHiddenPeers.includes(p.id)).length +
                          (screenStream ? 1 : 0);
      if (activeCount <= 1) {
        showToast('At least one active stream must remain visible.', 'error');
        return;
      }
      setLocallyHiddenPeers(prev => [...prev, peerId]);
      showToast(`Locally hid ${peerId === 'self' ? 'your stream' : 'peer stream'}.`, 'info');
    } else {
      setLocallyHiddenPeers(prev => prev.filter(id => id !== peerId));
      showToast(`Locally unhid ${peerId === 'self' ? 'your stream' : 'peer stream'}.`, 'info');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get('room');
    if (invitedRoom) {
      setRoomName(invitedRoom);
      showToast(`Invite loaded for ${invitedRoom}`, 'info');
    }
  }, [showToast]);

  /* ── Auth ───────────────────────────── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = 'Registration failed';
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map((d: any) => d.msg).join(', ');
          } else if (typeof data.detail === 'object') {
            msg = JSON.stringify(data.detail);
          }
        }
        throw new Error(msg);
      }
      setIsRegisterMode(false);
      setAuthPassword('');

      if (data.confirmation_required) {
        setAuthSuccess(data.message || 'Registration successful. Please check your email to verify your account.');
        showToast('Verification email sent', 'success');
      } else {
        setAuthSuccess('Account created successfully! Please log in.');
        showToast(data.message || 'Account created! Please sign in.', 'success');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = 'Login failed';
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map((d: any) => d.msg).join(', ');
          } else if (typeof data.detail === 'object') {
            msg = JSON.stringify(data.detail);
          }
        }
        throw new Error(msg);
      }
      sessionStorage.setItem('nexalink_token', data.access_token);
      sessionStorage.setItem('nexalink_username', data.username);
      setAuthToken(data.access_token);
      setUserName(data.username);
      setProfile(prev => ({ ...prev, username: data.username }));
      setCurrentView('lobby');
      setLobbySubView('connect');
      setAuthPassword('');
      showToast(`Welcome back, ${data.username}!`, 'success');
      // Request OS notification permission + subscribe to Web Push for this user
      requestPermission(data.username);
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('nexalink_token');
    sessionStorage.removeItem('nexalink_username');
    sessionStorage.removeItem('nexalink_current_view');
    sessionStorage.removeItem('nexalink_lobby_subview');
    sessionStorage.removeItem('nexalink_contacts');
    sessionStorage.removeItem('nexalink_notifications');
    unsubscribeNotif(userName);   // remove push subscription from server
    setAuthToken(null);
    setUserName('Alice');
    setProfile(prev => ({ ...prev, username: 'Alice' }));
    setCurrentView('landing');
    showToast('Signed out securely.', 'info');
  };

  // Handle notification click navigation (from SW postMessage)
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const { room } = (e as CustomEvent).detail || {};
      if (room && !inRoom) {
        connectToRoom(room, `Joining room from notification...`);
      }
    };
    window.addEventListener('nexalink:navigate', onNavigate);
    return () => window.removeEventListener('nexalink:navigate', onNavigate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom]);

  // Also handle ?room=X&auto=1 URL params on initial load (when browser was closed)
  useEffect(() => {
    if (!authToken) return;
    const params = new URLSearchParams(window.location.search);
    const autoRoom = params.get('room');
    const autoJoin = params.get('auto') === '1';
    if (autoRoom && autoJoin) {
      // Clear params so refresh doesn't re-trigger
      window.history.replaceState({}, '', window.location.pathname);
      connectToRoom(autoRoom, `Auto-joining room from notification...`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  /* ── Room Connect ───────────────────── */
  const connectToRoom = async (targetRoom: string, successLabel = `Joined ${targetRoom} — E2EE active`) => {
    setConnecting(true);
    try {
      const token = sessionStorage.getItem('nexalink_token') || '';
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      const roomRes = await fetch(`${API}/api/rooms/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ room_name: targetRoom, ephemeral_mode: true, metadata_stripping: true }),
      });
      const roomData = await roomRes.json();
      if (!roomRes.ok) throw new Error(roomData.detail || 'Room creation failed');
      const newRoomId = roomData.room_id;
      setActiveRoomId(newRoomId);

      await fetch(`${API}/api/call/join`, {
        method: 'POST', headers,
        body: JSON.stringify({ room_id: newRoomId, room_name: targetRoom, username: userName }),
      });

      setRoomName(targetRoom);
      setInRoom(true);
      setCurrentView('room');
      showToast(successLabel, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to connect', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectRoom = () => {
    const targetRoom = roomName.trim();
    if (!targetRoom) return;
    connectToRoom(targetRoom);
  };

  // const handleDirectCall = async () => {
  //   const peer = directPeer.trim();
  //   if (!peer) {
  //     showToast('Enter a username to call.', 'error');
  //     return;
  //   }
  //   const participants = [userName, peer]
  //     .map(name => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'))
  //     .sort();
  //   const directRoom = `Direct-${participants.join('-')}`;
  //   await copyInviteLink(directRoom);
  //   connectToRoom(directRoom, `Direct call room opened for ${peer}.`);
  // };

  const handleDisconnectRoom = async () => {
    if (activeRoomId) {
      try {
        const token = sessionStorage.getItem('nexalink_token') || '';
        await fetch(`${API}/api/call/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ room_id: activeRoomId, username: userName }),
        });
      } catch {}
    }

    if (activeDirectCallId) {
      updateCallStatusOnServer(activeDirectCallId, 'accepted', true);
      setActiveDirectCallId(null);
    }

    // Stop local media tracks to turn off the camera/mic indicator when leaving the room
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }

    setInRoom(false);
    setActiveRoomId(null);
    setChatMessages([]);
    setCurrentView('lobby');
    showToast('Disconnected from room.', 'info');
  };

  /* ── WebRTC ─────────────────────────── */
  const {
    socket, isConnected, localStream, screenStream, participants,
    audioEnabled, videoEnabled,
    myAlias, isAliasEnabled, stats, controlledBy,
    pendingControlRequestFrom, pendingControlRequestType, controlLogs,
    initMedia, toggleVideo, toggleAudio, toggleScreenShare,
    toggleAlias, requestRemoteControl, respondToControlRequest, triggerEmergencyKill,
  } = useWebRTC(
    inRoom ? roomName : '', 
    userName, 
    {
      profilePic: profile.profilePic,
      bio: profile.bio,
    },
    selectedAudioInput,
    selectedVideoInput
  );

  const {
    volumeLevel, config: audioConfig, setConfig: setAudioConfig,
    startPipeline, stopPipeline,
  } = useAudioPipeline();

  useEffect(() => {
    if (inRoom && localStream) startPipeline(localStream);
    else stopPipeline();
    return () => stopPipeline();
  }, [inRoom, localStream, startPipeline, stopPipeline]);

  // ── PRESENCE REGISTRATION & INCOMING CALL LISTENER ────────────────────────
  // Placed here so `socket` (from useWebRTC above) is in scope.
  useEffect(() => {
    if (!socket || !userName) return;
    socket.emit('register_presence', { username: userName });

    const handleOnlineUsersList = (usernames: string[]) => {
      setOnlineUsers(new Set(usernames.map(u => u.toLowerCase())));
    };

    const handlePresenceUpdate = ({ username, online }: { username: string; online: boolean }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (online) {
          next.add(username.toLowerCase());
        } else {
          next.delete(username.toLowerCase());
        }
        return next;
      });
    };

    socket.on('online_users_list', handleOnlineUsersList);
    socket.on('presence_update', handlePresenceUpdate);

    const handleIncomingCall = (data: IncomingCallData & { callId?: number }) => {
      setIncomingCall({ ...data, callId: data.callId });
      setInboxNotifications(prev => [{
        id: uid(),
        type: 'call' as const,
        sender: data.callerName,
        title: `Incoming ${data.callType === 'voice' ? 'Voice' : 'Video'} Call`,
        desc: `${data.callerName} is calling you`,
        time: nowTime(),
        read: false,
        room: data.room,
      }, ...prev.slice(0, 49)]);
      // OS popup — "NexaLink requesting an active session"
      notify('session', {
        sender: data.callerName,
        body: 'NexaLink requesting an active session',
        tag: 'nexalink-call',
        onClick: () => { /* modal already visible */ },
      });
      if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);
      callDismissTimerRef.current = setTimeout(() => {
        setIncomingCall(null);
        socket.emit('call_response', { callerId: data.callerId, response: 'declined' });
        if (data.callId) {
          updateCallStatusOnServer(data.callId, 'declined');
        }
      }, 30_000);
    };

    const handleCallCancelled = () => {
      setIncomingCall(null);
      if (callDismissTimerRef.current) clearTimeout(callDismissTimerRef.current);
      showToast('Caller cancelled the call.', 'info');
    };

    const handleDirectMessage = (data: { senderUsername: string; senderName: string; text: string; time: string }) => {
      const { senderUsername, senderName, text, time } = data;

      const msg: ChatMessage = {
        id: uid(),
        sender: senderName,
        text,
        time,
        self: false
      };

      // Check if contact exists
      setContacts(prev => {
        if (!prev.some(c => c.username.toLowerCase() === senderUsername.toLowerCase())) {
          return [...prev, { id: uid(), username: senderUsername, bio: 'Added from message', profilePic: '' }];
        }
        return prev;
      });

      setLobbyChats(prev => {
        const chatHistory = prev[senderUsername] || [];
        return {
          ...prev,
          [senderUsername]: [...chatHistory, msg]
        };
      });

      // Update unread count if we are not actively chatting with them
      if (!activeChatContact || activeChatContact.username.toLowerCase() !== senderUsername.toLowerCase() || lobbySubView !== 'chat_lobby') {
        setUnreadChatCounts(prev => {
          const currentUnread = prev[senderUsername] || 0;
          return {
            ...prev,
            [senderUsername]: currentUnread + 1
          };
        });

        // Add inbox notification
        setInboxNotifications(prev => [{
          id: uid(),
          type: 'chat',
          sender: senderUsername,
          title: `New message from ${senderName}`,
          desc: text,
          time: nowTime(),
          read: false
        }, ...prev.slice(0, 49)]);

        notify('update', {
          sender: senderUsername,
          body: `New message: ${text}`,
          tag: `nexalink-lobby-${senderUsername}`,
        });
      }
    };

    const handleContactAddedNotification = (data: { addedBy: string }) => {
      showToast(`${data.addedBy} added you as a contact!`, 'success');
      loadContactsFromServer();
      
      setInboxNotifications(prev => [{
        id: uid(),
        type: 'chat' as const,
        sender: data.addedBy,
        title: "Contact Relationship Added",
        desc: `${data.addedBy} added you to their secure contacts list.`,
        time: nowTime(),
        read: false
      }, ...prev.slice(0, 49)]);
    };

    const handleFileTransferRequest = (data: { transferId: number; senderUsername: string; recipientUsername: string; fileName: string; fileSize: number; fileType: string }) => {
      setPendingFiles(prev => [...prev, { id: data.transferId, sender: data.senderUsername, file_name: data.fileName, file_size: data.fileSize, file_type: data.fileType }]);
      
      setInboxNotifications(prev => [{
        id: `file-${data.transferId}`,
        type: 'chat' as const,
        sender: data.senderUsername,
        title: `Incoming File: ${data.fileName}`,
        desc: `Size: ${(data.fileSize / (1024*1024)).toFixed(2)} MB`,
        time: nowTime(),
        read: false,
        fileTransferId: data.transferId
      }, ...prev.slice(0, 49)]);

      notify('update', {
        sender: data.senderUsername,
        body: `File: ${data.fileName} (${(data.fileSize / (1024*1024)).toFixed(2)} MB)`,
        tag: `nexalink-file-${data.transferId}`
      });
    };

    const handleFileTransferResponseEvent = (data: { transferId: number; status: 'accepted'|'declined'; recipientUsername: string }) => {
      const notifTitle = data.status === 'accepted' ? 'File Request Accepted' : 'File Request Declined';
      const notifDesc = `${data.recipientUsername} has ${data.status} your file transfer request.`;
      setInboxNotifications(prev => [{
        id: `file-resp-${data.transferId}-${Date.now()}`,
        type: 'chat' as const,
        sender: data.recipientUsername,
        title: notifTitle,
        desc: notifDesc,
        time: nowTime(),
        read: false
      }, ...prev.slice(0, 49)]);

      if (data.status === 'declined') {
        showToast(`${data.recipientUsername} declined the file transfer request.`, 'error');
        setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
        selectedFileRef.current = null;
      } else if (data.status === 'accepted') {
        showToast(`${data.recipientUsername} accepted the request. Initiating P2P secure channel...`, 'success');
        if (selectedFileRef.current) {
          initiateFilePeerConnection(data.recipientUsername, selectedFileRef.current, data.transferId);
        } else {
          const fileInput = document.getElementById('secure-file-input') as HTMLInputElement;
          if (fileInput && fileInput.files && fileInput.files[0]) {
            initiateFilePeerConnection(data.recipientUsername, fileInput.files[0], data.transferId);
          } else {
            showToast('Selected file could not be retrieved from memory.', 'error');
            setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
          }
        }
      }
    };

    const handleFileTransferCancel = (data: { transferId: number; senderUsername: string }) => {
      cleanupFilePeerConnection();
      selectedFileRef.current = null;
      setFileTransferProgress(prev => prev && prev.transferId === data.transferId ? { ...prev, status: 'failed' } : prev);
      showToast(`File transfer was cancelled by ${data.senderUsername}.`, 'error');
    };

    const processQueuedFileCandidates = async (pc: RTCPeerConnection) => {
      const candidates = [...fileIceCandidatesQueueRef.current];
      fileIceCandidatesQueueRef.current = [];
      console.log(`[WebRTC File] Processing ${candidates.length} queued ICE candidates`);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('[WebRTC File] Error adding queued ICE candidate:', e);
        }
      }
    };

    const handleFileOffer = async (data: { fromUsername: string; offer: RTCSessionDescriptionInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await processQueuedFileCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (socket) {
          socket.emit('file_answer', {
            targetUsername: data.fromUsername,
            answer,
            senderUsername: userName
          });
        }
      } catch (err) {
        console.error('[WebRTC File] Error in handleFileOffer:', err);
      }
    };

    const handleFileAnswer = async (data: { fromUsername: string; answer: RTCSessionDescriptionInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await processQueuedFileCandidates(pc);
      } catch (err) {
        console.error('[WebRTC File] Error in handleFileAnswer:', err);
      }
    };

    const handleFileIceCandidate = async (data: { fromUsername: string; candidate: RTCIceCandidateInit }) => {
      const pc = filePeerConnectionRef.current;
      if (!pc) {
        console.log('[WebRTC File] Buffering incoming ICE candidate (pc is null)');
        fileIceCandidatesQueueRef.current.push(data.candidate);
        return;
      }
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        console.log('[WebRTC File] Buffering incoming ICE candidate (remoteDescription is not set)');
        fileIceCandidatesQueueRef.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('[WebRTC File] Error adding ICE candidate:', e);
      }
    };

    const handleCallResponseEvent = (data: { response: 'accepted' | 'declined' | 'merged'; responderId: string }) => {
      console.log('[Call Response Event]', data);
      const { response } = data;
      setOutgoingCall(prev => {
        if (!prev) return null;
        if (response === 'accepted' || response === 'merged') {
          setTimeout(() => {
            connectToRoom(prev.room, `Direct call accepted by ${prev.targetUsername}.`);
            setOutgoingCall(null);
          }, 100);
          return { ...prev, status: 'accepted' };
        } else if (response === 'declined') {
          return { ...prev, status: 'declined' };
        }
        return prev;
      });
    };

    socket.on('incoming_call', handleIncomingCall);
    socket.on('call_cancelled', handleCallCancelled);
    socket.on('call_response', handleCallResponseEvent);
    socket.on('direct_message', handleDirectMessage);
    socket.on('contact_added_notification', handleContactAddedNotification);
    socket.on('file_transfer_request', handleFileTransferRequest);
    socket.on('file_transfer_response', handleFileTransferResponseEvent);
    socket.on('file_transfer_cancel', handleFileTransferCancel);
    socket.on('file_offer', handleFileOffer);
    socket.on('file_answer', handleFileAnswer);
    socket.on('file_ice_candidate', handleFileIceCandidate);

    return () => {
      socket.off('incoming_call', handleIncomingCall);
      socket.off('call_cancelled', handleCallCancelled);
      socket.off('call_response', handleCallResponseEvent);
      socket.off('direct_message', handleDirectMessage);
      socket.off('contact_added_notification', handleContactAddedNotification);
      socket.off('file_transfer_request', handleFileTransferRequest);
      socket.off('file_transfer_response', handleFileTransferResponseEvent);
      socket.off('file_transfer_cancel', handleFileTransferCancel);
      socket.off('file_offer', handleFileOffer);
      socket.off('file_answer', handleFileAnswer);
      socket.off('file_ice_candidate', handleFileIceCandidate);
      socket.off('online_users_list', handleOnlineUsersList);
      socket.off('presence_update', handlePresenceUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, userName, activeChatContact, lobbySubView, contacts, pendingFiles]);

  /* ── Video refs ─────────────────────── */
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioIns = devices.filter(d => d.kind === 'audioinput');
      const videoIns = devices.filter(d => d.kind === 'videoinput');
      const audioOuts = devices.filter(d => d.kind === 'audiooutput');
      
      setAudioInputs(audioIns);
      setVideoInputs(videoIns);
      setAudioOutputs(audioOuts);
      
      if (audioIns.length > 0 && selectedAudioInput === 'default') {
        const def = audioIns.find(d => d.deviceId === 'default') || audioIns[0];
        setSelectedAudioInput(def.deviceId);
      }
      if (videoIns.length > 0 && selectedVideoInput === 'default') {
        const def = videoIns.find(d => d.deviceId === 'default') || videoIns[0];
        setSelectedVideoInput(def.deviceId);
      }
      if (audioOuts.length > 0 && selectedAudioOutput === 'default') {
        const def = audioOuts.find(d => d.deviceId === 'default') || audioOuts[0];
        setSelectedAudioOutput(def.deviceId);
      }
    } catch (err) {
      console.error('Failed to enumerate media devices:', err);
    }
  }, [selectedAudioInput, selectedVideoInput, selectedAudioOutput]);

  const applyAudioOutput = useCallback(async (deviceId: string) => {
    if (typeof HTMLVideoElement.prototype.setSinkId === 'undefined') {
      console.warn('Browser does not support setSinkId speaker output selection.');
      return;
    }
    try {
      if (localVideoRef.current) {
        await (localVideoRef.current as any).setSinkId(deviceId);
      }
      if (screenVideoRef.current) {
        await (screenVideoRef.current as any).setSinkId(deviceId);
      }
      const remoteAudios = document.querySelectorAll('audio, video');
      for (let i = 0; i < remoteAudios.length; i++) {
        const media = remoteAudios[i] as any;
        if (media.setSinkId) {
          await media.setSinkId(deviceId);
        }
      }
    } catch (err) {
      console.error('Failed to set speaker output sinkId:', err);
    }
  }, []);

  // Run on mount
  useEffect(() => {
    enumerateDevices();
    if (typeof navigator.mediaDevices !== 'undefined') {
      navigator.mediaDevices.ondevicechange = enumerateDevices;
    }
    return () => {
      if (typeof navigator.mediaDevices !== 'undefined') {
        navigator.mediaDevices.ondevicechange = null;
      }
    };
  }, [enumerateDevices]);

  // Apply audio output speaker change
  useEffect(() => {
    if (selectedAudioOutput && selectedAudioOutput !== 'default') {
      applyAudioOutput(selectedAudioOutput);
      sessionStorage.setItem('nexalink_selected_speaker', selectedAudioOutput);
    }
  }, [selectedAudioOutput, applyAudioOutput]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream, inRoom]);

  useEffect(() => {
    if (screenVideoRef.current && screenStream) screenVideoRef.current.srcObject = screenStream;
  }, [screenStream]);

  /* ── Media init ─────────────────────── */
  const handleInitMedia = async () => {
    const res = await initMedia(callType);
    if (res) {
      showToast('Camera & mic initialised successfully.', 'success');
      await enumerateDevices();
    } else {
      showToast('Camera & mic inputs stopped & released.', 'info');
    }
  };

  /* ── Chat ─────────────────────────── */
  const sendChat = () => {
    if (!chatInput.trim()) return;
    const msg: ChatMessage = {
      id: uid(), sender: myAlias.name, text: chatInput.trim(),
      time: nowTime(), self: true,
    };
    setChatMessages(prev => [...prev, msg]);
    if (socket) socket.emit('chat_message', { roomName, sender: myAlias.name, text: chatInput.trim(), time: msg.time });
    setChatInput('');
  };

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { sender: string; text: string; time: string }) => {
      setChatMessages(prev => [...prev, { id: uid(), ...data, self: false }]);
      setActiveTab(currentTab => {
        if (currentTab !== 'chat') {
          setUnreadChat(prev => prev + 1);
        }
        return currentTab;
      });
      // OS push notification — fires only when the tab is hidden/blurred
      notify('update', {
        sender: data.sender,
        body: 'NexaLink received an update',
        tag: 'nexalink-chat',
        onClick: () => setActiveTab('chat'),
      });
    };
    socket.on('chat_message', handler);
    return () => { socket.off('chat_message', handler); };
  }, [socket, notify]);

  /* ── TTS ─────────────────────────── */
  const speakText = useCallback((text: string, voiceName: string) => {
    if ('speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      if (voiceName.includes('Female')) {
        const femaleVoice = voices.find(v => v.name.toLowerCase().includes('female') || v.name.includes('Zira'));
        if (femaleVoice) utt.voice = femaleVoice;
      }
      utt.rate = 0.96;
      utt.volume = 0.92;
      window.speechSynthesis.speak(utt);
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { sender: string; text: string; voice: string }) => {
      setTtsQueue(prev => [...prev, `${data.sender}: "${data.text}"`]);
      speakText(data.text, data.voice);
      showToast(`Synthetic voice from ${data.sender}`, 'info');
    };
    socket.on('tts_message', handler);
    return () => { socket.off('tts_message', handler); };
  }, [socket, speakText, showToast]);

  const queueTTS = () => {
    const cleanText = ttsText.trim();
    if (!cleanText) return;
    const entry = `${selectedVoice}: "${cleanText}"`;
    setTtsQueue(prev => [...prev, entry]);
    speakText(cleanText, selectedVoice);
    socket?.emit('tts_message', { roomName, sender: myAlias.name, text: cleanText, voice: selectedVoice });
    setTtsText('');
    showToast('TTS sent to peers', 'info');
  };

  /* ── Derived ─────────────────────────── */
  const volPercent    = Math.min(100, (volumeLevel / 255) * 100);
  const visibleParticipants = participants.filter(peer => !locallyHiddenPeers.includes(peer.id));
  const isSelfHidden = locallyHiddenPeers.includes('self');
  const orderedParticipants = pinnedTile && pinnedTile !== 'self'
    ? [...visibleParticipants].sort((a, b) => (a.id === pinnedTile ? -1 : b.id === pinnedTile ? 1 : 0))
    : visibleParticipants;
  const hasPinnedTile = Boolean(pinnedTile && !locallyHiddenPeers.includes(pinnedTile));
  const videoFitClass = fitMode === 'cover' ? 'object-cover' : 'object-contain bg-slate-950';

  const totalVisibleTiles = (!isSelfHidden ? 1 : 0) + orderedParticipants.length + (screenStream ? 1 : 0);

  /* ── Unified settings render helper ──── */
  const renderSettingsArea = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 fade-up">
        {/* Card 1: Account Profile settings */}
        <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <User className="w-4 h-4 text-[var(--nx-primary)]" />
            <h3 className="text-sm font-bold text-white">Account Profile</h3>
          </div>
          
          <div className="flex flex-col items-center gap-3 text-center mt-2">
            <label className="w-24 h-24 rounded-full flex items-center justify-center cursor-pointer overflow-hidden transition-all hover:scale-105"
              style={{ background: 'var(--nx-teal-soft)', border: '2px solid var(--nx-primary)' }}>
              {profile.profilePic ? (
                <img src={profile.profilePic} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus className="w-7 h-7 text-[var(--nx-primary)]" />
              )}
              <input type="file" accept="image/*" className="hidden"
                onChange={e => handleProfilePicUpload(e.target.files?.[0])} />
            </label>
            
            <div className="w-full text-left">
              <label className="nx-input-label text-slate-400">Username Display</label>
              <input className="nx-input mb-3 text-xs" value={profile.username}
                onChange={e => {
                  setProfile(prev => ({ ...prev, username: e.target.value }));
                  setUserName(e.target.value || userName);
                }} />
              
              <label className="nx-input-label text-slate-400">Bio Description</label>
              <textarea className="nx-input text-xs" rows={3} value={profile.bio}
                onChange={e => setProfile(prev => ({ ...prev, bio: e.target.value.slice(0, 160) }))}
                placeholder="Write a private profile note." />
            </div>
            
            <button className="nx-btn nx-btn-primary w-full text-2xs font-semibold flex items-center justify-center gap-2 mt-2" onClick={() => pushProfileToDB()}>
              <Save className="w-3.5 h-3.5" /> Save & Sync Profile
            </button>
          </div>
        </div>

        {/* Card 2: Theme, Chat, & Alerts Settings */}
        <div className="flex flex-col gap-6">
          {/* Subcard A: Interface Theme (Light/Dark) */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <Sliders className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Interface & Theme</h3>
            </div>
            
            <div className="flex items-center justify-between mt-1">
              <div>
                <p className="text-2xs font-bold text-white">Application Theme</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Toggle between premium light and dark themes</p>
              </div>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                <button 
                  onClick={() => setTheme('light')}
                  className={`px-3 py-1.5 rounded-lg text-3xs font-bold transition flex items-center gap-1.5 ${theme === 'light' ? 'bg-[var(--nx-primary)] text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  ☀️ Light
                </button>
                <button 
                  onClick={() => setTheme('dark')}
                  className={`px-3 py-1.5 rounded-lg text-3xs font-bold transition flex items-center gap-1.5 ${theme === 'dark' ? 'bg-[var(--nx-primary)] text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  🌙 Dark
                </button>
              </div>
            </div>
          </div>

          {/* Subcard B: Chat custom options */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <MessageSquare className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Chat Customizations</h3>
            </div>

            <div className="flex flex-col gap-3.5 mt-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Press Enter to Send</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Submit messages instantly when pressing Enter</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={chatSettings.pressEnterToSend} 
                    onChange={e => setChatSettings(prev => ({ ...prev, pressEnterToSend: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Message Sound Alerts</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Play sound effects upon receiving direct messages</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={chatSettings.soundEnabled} 
                    onChange={e => setChatSettings(prev => ({ ...prev, soundEnabled: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>
            </div>
          </div>

          {/* Subcard C: Desktop Notifications preferences */}
          <div className="glass-card rounded-3xl p-6 flex flex-col gap-4 border border-white/5">
            <div className="flex items-center gap-2 pb-2 border-b border-white/5">
              <Radio className="w-4 h-4 text-[var(--nx-primary)]" />
              <h3 className="text-sm font-bold text-white">Notifications Preferences</h3>
            </div>

            <div className="flex flex-col gap-3.5 mt-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Desktop Notifications</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Show native OS alert indicators for incoming calls</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={notifSettings.desktopEnabled} 
                    onChange={e => {
                      const checked = e.target.checked;
                      setNotifSettings(prev => ({ ...prev, desktopEnabled: checked }));
                      if (checked) {
                        requestPermission(userName);
                      }
                    }}
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-bold text-white">Persistent Notification Banner</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">Display in-app floating system status alerts</p>
                </div>
                <label className="nx-toggle">
                  <input 
                    type="checkbox" 
                    checked={notifSettings.showToastAlerts} 
                    onChange={e => setNotifSettings(prev => ({ ...prev, showToastAlerts: e.target.checked }))} 
                  />
                  <span className="nx-toggle-track" />
                  <span className="nx-toggle-thumb" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════
     RENDER
  ═══════════════════════════════════════ */
  return (
    <div className={`min-h-screen flex flex-col nx-app-shell ${!authToken ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ fontFamily: 'var(--font-sans)' }}>

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* ── INCOMING CALL MODAL ─────────────────────────────────────────────── */}
      {incomingCall && (
        <div
          className="fixed inset-0 z-[9998] flex items-end justify-center pb-10"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)' }}
        >
          <div
            className="relative flex flex-col items-center gap-5 px-8 py-7 rounded-3xl shadow-2xl"
            style={{
              background: 'linear-gradient(145deg, rgba(44,37,35,0.97) 0%, rgba(28,22,20,0.99) 100%)',
              border: '1.5px solid rgba(255,212,172,0.18)',
              minWidth: 340, maxWidth: 420,
              boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,212,172,0.06)',
            }}
          >
            {/* Ringing ring animation */}
            <div className="relative flex items-center justify-center">
              <span className="absolute w-24 h-24 rounded-full animate-ping"
                style={{ background: 'rgba(227,154,122,0.18)', animationDuration: '1.2s' }} />
              <span className="absolute w-20 h-20 rounded-full animate-ping"
                style={{ background: 'rgba(227,154,122,0.12)', animationDuration: '1.2s', animationDelay: '0.3s' }} />
              <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-xl"
                style={{ background: 'linear-gradient(135deg, #E39A7A, #FFD4AC)', border: '2px solid rgba(255,212,172,0.5)' }}>
                {incomingCall.callType === 'voice' ? '📞' : '📹'}
              </div>
            </div>

            {/* Caller info */}
            <div className="text-center">
              <p className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: 'rgba(255,212,172,0.55)' }}>
                Incoming {incomingCall.callType === 'voice' ? 'Voice' : 'Video'} Call
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: '#FFD4AC' }}>
                {incomingCall.callerName}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,212,172,0.45)' }}>
                @{incomingCall.callerUsername}
              </p>
            </div>

            {/* Status badge */}
            {inRoom && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                You are currently in a {participants.length > 0 ? `room with ${participants.length} other${participants.length > 1 ? 's' : ''}` : 'room'}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2 w-full">
              {/* Primary: Leave/Cut + Accept */}
              <button
                onClick={() => handleIncomingCallResponse(inRoom ? 'leave_accept' : 'cut_accept')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff',
                  boxShadow: '0 4px 20px rgba(22,163,74,0.35)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <PhoneCall className="w-4 h-4" />
                {inRoom ? 'Leave Room & Accept' : 'Accept Call'}
              </button>

              {/* Merge */}
              <button
                onClick={() => handleIncomingCallResponse('merge')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(99,102,241,0.12))',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99,102,241,0.35)',
                  boxShadow: '0 2px 12px rgba(99,102,241,0.2)',
                }}
              >
                <Users className="w-4 h-4" />
                Merge {inRoom ? 'Rooms' : 'Calls'}
              </button>

              {/* Ignore */}
              <button
                onClick={() => handleIncomingCallResponse('ignore')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-sm transition-all duration-150"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <PhoneOff className="w-4 h-4" />
                Ignore
              </button>
            </div>

            {/* Auto-dismiss countdown hint */}
            <p className="text-[9px] font-mono" style={{ color: 'rgba(255,212,172,0.28)' }}>
              Auto-dismissed in 30s if not answered
            </p>
          </div>
        </div>
      )}

      {outgoingCall && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(15px)' }}
        >
          <div
            className="relative flex flex-col items-center gap-6 px-8 py-8 rounded-3xl shadow-2xl animate-fade-in"
            style={{
              background: 'linear-gradient(145deg, rgba(44,37,35,0.98) 0%, rgba(28,22,20,0.99) 100%)',
              border: '1.5px solid rgba(255,212,172,0.22)',
              minWidth: 340, maxWidth: 440,
              boxShadow: '0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,212,172,0.08)',
            }}
          >
            {/* Ringing ring animation */}
            <div className="relative flex items-center justify-center">
              {outgoingCall.status === 'ringing' && (
                <>
                  <span className="absolute w-24 h-24 rounded-full animate-ping"
                    style={{ background: 'rgba(227,154,122,0.18)', animationDuration: '1.2s' }} />
                  <span className="absolute w-20 h-20 rounded-full animate-ping"
                    style={{ background: 'rgba(227,154,122,0.12)', animationDuration: '1.2s', animationDelay: '0.3s' }} />
                </>
              )}
              <div className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-xl"
                style={{ 
                  background: outgoingCall.status === 'declined' || outgoingCall.status === 'failed'
                    ? 'linear-gradient(135deg, #ef4444, #b91c1c)' 
                    : 'linear-gradient(135deg, #E39A7A, #FFD4AC)', 
                  border: '2px solid rgba(255,212,172,0.5)' 
                }}>
                {outgoingCall.status === 'declined' || outgoingCall.status === 'failed' ? '❌' : (outgoingCall.callType === 'voice' ? '📞' : '📹')}
              </div>
            </div>

            {/* Callee info */}
            <div className="text-center">
              <p className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: 'rgba(255,212,172,0.55)' }}>
                {outgoingCall.status === 'ringing' && 'Calling Peer...'}
                {outgoingCall.status === 'accepted' && 'Connecting...'}
                {outgoingCall.status === 'declined' && 'Call Rejected'}
                {outgoingCall.status === 'failed' && 'Connection Failed'}
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: '#FFD4AC' }}>
                {outgoingCall.targetUsername}
              </p>
              <p className="text-2xs font-mono mt-1 text-slate-400">
                {outgoingCall.status === 'ringing' && 'Waiting for handshake...'}
                {outgoingCall.status === 'accepted' && 'Establishing WebRTC channels...'}
                {outgoingCall.status === 'declined' && 'The recipient declined your call.'}
                {outgoingCall.status === 'failed' && (outgoingCall.errorReason || 'User is offline.')}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2.5 w-full mt-2">
              {outgoingCall.status === 'ringing' && (
                <button
                  onClick={() => {
                    // Cancel the call
                    socket?.emit('call_cancel', { targetUsername: outgoingCall.targetUsername });
                    if (outgoingCall.callId) {
                      updateCallStatusOnServer(outgoingCall.callId, 'missed');
                    }
                    setOutgoingCall(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition hover:bg-white/5"
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.25)',
                  }}
                >
                  <PhoneOff className="w-4 h-4" />
                  Cancel Call
                </button>
              )}

              {(outgoingCall.status === 'declined' || outgoingCall.status === 'failed') && (
                <>
                  <button
                    onClick={() => {
                      const target = outgoingCall.targetUsername;
                      const type = outgoingCall.callType;
                      setOutgoingCall(null);
                      setTimeout(() => {
                        setCallType(type);
                        callContact(target);
                      }, 100);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition"
                    style={{
                      background: 'linear-gradient(135deg, #FFD4AC, #E39A7A)',
                      color: '#2c2523',
                      boxShadow: '0 4px 15px rgba(227,154,122,0.25)',
                      border: 'none'
                    }}
                  >
                    <PhoneCall className="w-4 h-4" />
                    Try Again
                  </button>

                  <button
                    onClick={() => setOutgoingCall(null)}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-bold text-xs transition hover:bg-white/5 border border-white/10 text-slate-300"
                    style={{ background: 'transparent' }}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="nx-bg">
        <div className="nx-bg-grid" />
        <div className="nx-bg-orb nx-bg-orb-1" />
        <div className="nx-bg-orb nx-bg-orb-2" />
        <div className="nx-bg-orb nx-bg-orb-3" />
      </div>

      {/* ── HEADER ─────────────────────── */}
      <header className="relative z-50 glass app-header flex items-center justify-between px-6 py-3 border-b">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="nx-logo w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-white text-lg"
            style={{ borderRadius: 12 }}>
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>NexaLink</span>
              <span className="nx-badge nx-badge-green">v1.0</span>
            </div>
            <p className="text-3xs text-slate-500 leading-none mt-0.5">E2E Encrypted Real-Time Control</p>
          </div>
        </div>

        {/* Centre: Live stats (in-call only) */}
        {inRoom && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className={`status-dot ${isConnected ? 'live' : 'error'}`} />
              <span className="text-2xs font-mono text-slate-400">
                {isConnected ? 'Relay Established' : 'Reconnecting...'}
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center gap-4 font-mono text-2xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Activity className="w-3 h-3 text-indigo-400" />
                <span className="text-slate-300">{stats.videoLatency}ms</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <BarChart2 className="w-3 h-3 text-emerald-400" />
                <span className="text-slate-300">{stats.jitter}ms</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <WifiOff className="w-3 h-3 text-rose-400" />
                <span className={stats.packetLoss > 0 ? 'text-rose-400' : 'text-slate-300'}>{stats.packetLoss}%</span>
              </span>
            </div>
            <div className="divider" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <span className="text-base">{myAlias.avatar}</span>
              <span className="text-2xs font-semibold text-indigo-200">{myAlias.name}</span>
              {isAliasEnabled && <span className="nx-badge nx-badge-indigo">alias</span>}
            </div>
          </div>
        )}

        {/* Right: E2EE + User */}
        <div className="flex items-center gap-3">
          {inRoom && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-2xs font-mono font-semibold text-emerald-300">AES-GCM-256</span>
            </div>
          )}
          {authToken && (
            <div className="relative">
              <button 
                onClick={() => setShowInboxDropdown(d => !d)}
                className={`relative nx-btn-icon nx-tooltip ${showInboxDropdown ? 'active' : ''}`}
                data-tip="Inbox Notifications"
              >
                {inboxNotifications.filter(n => !n.read).length > 0 && (
                  <div className="absolute -top-1.5 -right-1.5 bg-[var(--nx-primary)] rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg animate-pulse px-1" style={{ minWidth: '18px', height: '18px' }}>
                    {inboxNotifications.filter(n => !n.read).length}
                  </div>
                )}
                <Radio className="w-4 h-4 text-white" />
              </button>

              {showInboxDropdown && (
                <div className="absolute right-0 mt-3 w-80 glass border border-white/10 rounded-2xl p-4 shadow-2xl z-[1000] animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5 mb-3">
                    <span className="text-xs font-bold text-white">Lobby Inbox Notifications</span>
                    <button 
                      onClick={() => setInboxNotifications([])}
                      className="text-3xs text-rose-400 hover:text-rose-300 font-semibold"
                    >
                      Clear all alerts
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-2.5">
                    {inboxNotifications.length === 0 ? (
                      <p className="text-3xs text-slate-500 text-center py-4 italic">No alerts in your inbox.</p>
                    ) : (
                      inboxNotifications.map(notification => (
                        <div 
                          key={notification.id} 
                          className="p-2.5 rounded-xl border border-[var(--nx-primary)]/20 bg-[var(--nx-teal-soft)]/20 hover:bg-[var(--nx-teal-soft)]/40 transition-all duration-200 text-left cursor-pointer"
                          onClick={() => {
                            setInboxNotifications(prev => prev.filter(n => n.id !== notification.id));
                            setShowInboxDropdown(false);
                            if (notification.type === 'chat') {
                              setLobbySubView('chat_lobby');
                              const foundContact = contacts.find(c => c.username.toLowerCase() === notification.sender.toLowerCase());
                              if (foundContact) {
                                setActiveChatContact(foundContact);
                              } else {
                                const tempContact = { id: uid(), username: notification.sender, bio: 'Inbox Chat Partner', profilePic: '' };
                                setContacts(prev => [...prev, tempContact]);
                                setActiveChatContact(tempContact);
                              }
                            } else if (notification.type === 'call' && notification.room) {
                              setRoomName(notification.room);
                              setCallType('video');
                              setCurrentView('connecting');
                            }
                          }}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-2xs font-bold text-white">{notification.title}</span>
                            <span className="text-3xs text-slate-500 font-mono">{notification.time}</span>
                          </div>
                          <p className="text-3xs text-slate-300 leading-tight">{notification.desc}</p>
                          <p className="text-[8px] text-indigo-400 mt-1 font-semibold uppercase tracking-wider">
                            {notification.type === 'chat' ? '✉ Open Chat Lobby' : '📞 Join Tunnel Room'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {authToken && (
            <button 
              onClick={() => {
                if (currentView === 'lobby') {
                  setLobbySubView(prev => prev === 'settings' ? 'connect' : 'settings');
                } else if (currentView === 'room') {
                  setActiveTab('profile');
                }
              }}
              className={`nx-tooltip nx-btn-icon ${(currentView === 'lobby' && lobbySubView === 'settings') || (currentView === 'room' && activeTab === 'profile') ? 'active' : ''}`}
              data-tip="Settings"
            >
              <Sliders className="w-4 h-4 text-white" />
            </button>
          )}
          {authToken && (
            <button onClick={handleSignOut}
              className="nx-tooltip nx-btn-icon"
              data-tip="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN ─────────────────────── */}
      <main className="flex-1 relative z-10 flex app-main" style={{ height: inRoom ? 'calc(100vh - 154px)' : 'calc(100vh - 88px)' }}>

        {!authToken ? (
          /* ════════════════════════════
             AUTHENTICATION GATEWAY
             ════════════════════════════ */
          <div className="w-full flex items-center justify-center p-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
            <div className="w-full max-w-md glass-card rounded-3xl p-8 flex flex-col gap-6 fade-up shadow-2xl relative overflow-hidden">
              
              {/* Contoured glow */}
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-[var(--nx-primary)]/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-[var(--nx-primary)]/10 rounded-full blur-2xl" />

              <div className="text-center">
                <div className="nx-logo w-12 h-12 rounded-2xl flex items-center justify-center font-extrabold text-white text-xl mx-auto mb-4"
                  style={{ borderRadius: 16 }}>
                  N
                </div>
                <h2 className="text-xl font-bold text-white font-display">Authentication Gateway</h2>
                <p className="text-3xs text-slate-500 mt-1 uppercase tracking-widest font-mono">End-to-End Secure Relay Terminal</p>
              </div>

              {/* Error alerts */}
              {authError && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl nx-alert"
                  style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
                  <span className="text-2xs font-semibold text-rose-300">{authError}</span>
                </div>
              )}
              {authSuccess && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl nx-alert"
                  style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 animate-pulse" />
                  <span className="text-2xs font-semibold text-emerald-300">{authSuccess}</span>
                </div>
              )}

              <form onSubmit={isRegisterMode ? handleRegister : handleLogin} className="flex flex-col gap-4">
                <div>
                  <label className="nx-input-label text-slate-400">Tunnel Username</label>
                  <input 
                    className="nx-input text-xs" 
                    type="text" 
                    required 
                    autoComplete="username"
                    placeholder="e.g. alice" 
                    value={authUsername}
                    onChange={e => setAuthUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} 
                  />
                </div>

                {isRegisterMode && (
                  <div>
                    <label className="nx-input-label text-slate-400">Identity Email Address</label>
                    <input 
                      className="nx-input text-xs" 
                      type="email" 
                      required 
                      autoComplete="email"
                      placeholder="alice@domain.com" 
                      value={authEmail}
                      onChange={e => setAuthEmail(e.target.value)} 
                    />
                  </div>
                )}

                <div>
                  <label className="nx-input-label text-slate-400">Passphrase</label>
                  <div className="relative">
                    <input 
                      className="nx-input text-xs pr-10" 
                      type={showPass ? "text" : "password"} 
                      required 
                      autoComplete="current-password"
                      placeholder="••••••••••••••" 
                      value={authPassword}
                      onChange={e => setAuthPassword(e.target.value)} 
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      {showPass ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={authLoading}
                  className="nx-btn nx-btn-primary py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 mt-2 w-full"
                >
                  {authLoading ? (
                    <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  ) : (
                    <>
                      <Lock className="w-4 h-4" /> {isRegisterMode ? "Generate Keys & Authenticate" : "Establish Secure Access"}
                    </>
                  )}
                </button>
              </form>

              <div className="border-t border-white/5 pt-4 text-center">
                <button 
                  onClick={() => {
                    setIsRegisterMode(!isRegisterMode);
                    setAuthError(null);
                    setAuthSuccess(null);
                  }}
                  className="text-2xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  {isRegisterMode ? "Already verified? Access Tunnel" : "Request access tunnel? Register Here"}
                </button>
              </div>

            </div>
          </div>
        ) : !inRoom ? (
          currentView === 'landing' ? (
            /* ════════════════════════════
               PREMIUM LANDING PAGE
               ════════════════════════════ */
            <div className="w-full landing-container">
              <div className="landing-hero">
                <div className="nx-badge nx-badge-indigo mb-2">Introducing NexaLink v1.0</div>
                <h1 className="landing-title">Secure Real-Time Talking & Instant Connection Room</h1>
                <p className="landing-subtitle">
                  A premium secure platform designed for talking and instant connection — not just another corporate meeting. NexaLink blends military-grade AES-GCM-256 chat privacy, microsecond WebRTC audio DSP voice morphing, and chaperoned remote operations into a smooth, seamless personal connection experience.
                </p>
                <div className="landing-cta-group">
                  <button onClick={() => { setCurrentView('lobby'); setLobbySubView('connect'); }} className="nx-btn nx-btn-primary flex items-center gap-2" style={{ padding: '14px 28px', fontSize: '14px' }}>
                    <Zap className="w-4 h-4" /> Start Connecting
                  </button>
                  <a href="#features" onClick={(e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); }} className="nx-btn nx-btn-ghost flex items-center gap-2" style={{ padding: '14px 28px' }}>
                    Explore Capabilities
                  </a>
                </div>
              </div>

              {/* Highlights grid */}
              <div id="features" className="landing-features-grid">
                <div className="landing-feature-card">
                  <div className="landing-feature-icon">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h3 className="landing-feature-title">AES-GCM-256 Privacy</h3>
                  <p className="landing-feature-desc">
                    Your video streams, collaborative vector blackboard sketches, and chat history are fully encrypted on the client side for absolute confidentiality.
                  </p>
                </div>

                <div className="landing-feature-card">
                  <div className="landing-feature-icon">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <h3 className="landing-feature-title">DSP Voice Morphing</h3>
                  <p className="landing-feature-desc">
                    Alter your voice frequencies in real-time with sub-millisecond pitch shifting, sub-ambient whisper boosters, and voice cloning models.
                  </p>
                </div>

                <div className="landing-feature-card">
                  <div className="landing-feature-icon">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="landing-feature-title">Chaperoned Controls</h3>
                  <p className="landing-feature-desc">
                    Securely request, grant, and run remote interactions with strict active sandboxing, consent logging, and immediate panic kill-switches.
                  </p>
                </div>

                <div className="landing-feature-card">
                  <div className="landing-feature-icon">
                    <Edit2 className="w-5 h-5" />
                  </div>
                  <h3 className="landing-feature-title">Shared Whiteboard</h3>
                  <p className="landing-feature-desc">
                    Co-create equations, vector layouts, and brainstorm ideas in real-time on a robust blackboard canvas synchronized with Yjs.
                  </p>
                </div>
              </div>
            </div>
          ) : currentView === 'connecting' ? (
            /* ════════════════════════════
               PRE-FLIGHT CONNECTING PAGE
               ════════════════════════════ */
            <div className="w-full lobby-scroll p-6" style={{ height: 'calc(100vh - 120px)' }}>
              <div className="w-full max-w-5xl mx-auto glass-card rounded-3xl p-8 flex flex-col gap-6 fade-up">
                
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <div>
                    <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">Pre-flight Studio</span>
                    <h2 className="text-xl font-bold text-white font-display">Configure Secure Connection Tunnel</h2>
                    <p className="text-2xs text-slate-500 mt-0.5">Initialize media assets and DSP audio pipelines before going live in room: <strong className="text-indigo-400 font-mono">#{roomName}</strong></p>
                  </div>
                  <button 
                    onClick={() => setCurrentView('lobby')}
                    className="text-2xs font-bold text-slate-900 bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg transition shadow-sm"
                  >
                    ← Return to Lobby
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
                  
                  {/* Media Box */}
                  <div className="flex flex-col gap-5">
                    <p className="nx-section-header uppercase tracking-wider text-[10px] text-slate-400"><Video className="w-3.5 h-3.5 inline mr-1 text-indigo-400" /> Media Preview Studio</p>
                    
                    {callType === 'video' ? (
                      /* Video Preview */
                      <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-950">
                        {localStream ? (
                          <video ref={localVideoRef} autoPlay playsInline muted
                            className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 shimmer">
                              <Video className="w-7 h-7 text-indigo-400" />
                            </div>
                            <p className="text-2xs text-slate-500 font-medium">Initializing secure video preview...</p>
                          </div>
                        )}
                        
                        {localStream && (
                          <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-white/5 backdrop-blur-md">
                            <Mic className="w-3.5 h-3.5 text-indigo-400" />
                            <div className="voice-meter w-16">
                              <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Voice Waveform Preview (CSS Animated Waveform) */
                      <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-slate-950 flex flex-col items-center justify-center p-6">
                        <style>{`
                          @keyframes nexawave {
                            0%, 100% { transform: scaleY(0.2); }
                            50% { transform: scaleY(1); }
                          }
                          .nx-bar-anim {
                            animation: nexawave 0.9s ease-in-out infinite;
                            transform-origin: bottom;
                          }
                        `}</style>
                        
                        <div className="flex items-end justify-center gap-1.5 h-28 w-full max-w-xs px-4 py-2 relative overflow-hidden z-10">
                          {Array.from({ length: 16 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="w-1.5 bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-full nx-bar-anim" 
                              style={{ 
                                height: `${30 + Math.sin(i * 0.5) * 50}%`,
                                animationDelay: `${i * 0.05}s`,
                                animationDuration: `${0.5 + Math.random() * 0.6}s`
                              }} 
                            />
                          ))}
                        </div>
                        
                        <p className="text-3xs font-bold text-slate-500 uppercase tracking-widest mt-4 relative z-10 flex items-center gap-1.5">
                          <Headphones className="w-3.5 h-3.5 text-indigo-400" /> Audio Waveform Preview Active
                        </p>

                        <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-white/5 backdrop-blur-md">
                          <Mic className="w-3.5 h-3.5 text-indigo-400" />
                          <div className="voice-meter w-16">
                            <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={handleInitMedia}
                        className="nx-btn nx-btn-ghost flex-1 text-2xs py-2.5">
                        <Sliders className="w-3.5 h-3.5" /> Initialize Media
                      </button>
                      {callType === 'video' && (
                        <button onClick={toggleVideo}
                          className={`nx-btn flex-1 text-2xs py-2.5 ${videoEnabled ? 'nx-btn-primary' : 'nx-btn-ghost'}`}>
                          {videoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                          {videoEnabled ? 'Camera: Active' : 'Camera: Disabled'}
                        </button>
                      )}
                      <button onClick={toggleAudio}
                        className={`nx-btn flex-1 text-2xs py-2.5 ${audioEnabled ? 'nx-btn-primary' : 'nx-btn-ghost'}`}>
                        {audioEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                        {audioEnabled ? 'Mic: Active' : 'Mic: Muted'}
                      </button>
                    </div>

                    {audioEnabled && (
                      <div className="text-3xs font-semibold flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900/40 border border-white/5 mt-2 transition-all">
                        <span className="text-slate-400">Microphone Integrity Check:</span>
                        {volumeLevel > 2 ? (
                          <span className="text-emerald-400 flex items-center gap-1">✓ Active Signal Detected ({Math.round(volumeLevel)})</span>
                        ) : (
                          <span className="text-amber-400 animate-pulse">Silence / Waiting for Input...</span>
                        )}
                      </div>
                    )}

                    {/* Device Selector Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-2 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                      <div className="flex flex-col gap-1.5 text-left">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Mic className="w-3 h-3 text-indigo-400" /> Microphone
                        </label>
                        <select 
                          value={selectedAudioInput}
                          onChange={e => {
                            setSelectedAudioInput(e.target.value);
                            sessionStorage.setItem('nexalink_selected_mic', e.target.value);
                          }}
                          className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                        >
                          {audioInputs.length === 0 ? (
                            <option value="default">Default Microphone</option>
                          ) : (
                            audioInputs.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 5)})`}</option>
                            ))
                          )}
                        </select>
                      </div>

                      {callType === 'video' && (
                        <div className="flex flex-col gap-1.5 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Video className="w-3 h-3 text-indigo-400" /> Camera
                          </label>
                          <select 
                            value={selectedVideoInput}
                            onChange={e => {
                              setSelectedVideoInput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_cam', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {videoInputs.length === 0 ? (
                              <option value="default">Default Camera</option>
                            ) : (
                              videoInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 text-left">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Headphones className="w-3 h-3 text-indigo-400" /> Audio Output
                        </label>
                        <select 
                          value={selectedAudioOutput}
                          onChange={e => {
                            setSelectedAudioOutput(e.target.value);
                            sessionStorage.setItem('nexalink_selected_speaker', e.target.value);
                          }}
                          className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                        >
                          {audioOutputs.length === 0 ? (
                            <option value="default">Default Speakers</option>
                          ) : (
                            audioOutputs.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.slice(0, 5)})`}</option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Setup & Morphing Controls */}
                  <div className="flex flex-col gap-5">
                    <p className="nx-section-header uppercase tracking-wider text-[10px] text-slate-400"><Sliders className="w-3.5 h-3.5 inline mr-1 text-indigo-400" /> Live Audio Morphing (DSP)</p>
                    
                    <div className="rounded-2xl p-4 bg-slate-900/50 border border-white/5 space-y-4">
                      <div>
                        <label className="nx-input-label text-slate-400">Your Tunnel Alias Nickname</label>
                        <input 
                          className="nx-input text-xs" 
                          type="text" 
                          value={profile.username}
                          onChange={e => {
                            setProfile(prev => ({ ...prev, username: e.target.value }));
                            setUserName(e.target.value || userName);
                          }} 
                          placeholder="Display name" 
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-2xs mb-2">
                          <span className="text-slate-400">Microsecond Pitch Shift</span>
                          <span className="font-mono text-indigo-400 font-bold">
                            {audioConfig.pitchShift > 0 ? `+${audioConfig.pitchShift}` : audioConfig.pitchShift} st
                          </span>
                        </div>
                        <input type="range" min="-12" max="12" value={audioConfig.pitchShift}
                          onChange={e => setAudioConfig(p => ({ ...p, pitchShift: parseInt(e.target.value) }))} />
                        <div className="flex justify-between text-3xs text-slate-500 mt-1">
                          <span>−12 (Deep)</span><span>0</span><span>+12 (High)</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <label className="nx-toggle mt-0.5">
                            <input type="checkbox"
                              checked={audioConfig.whisperFilterEnabled}
                              onChange={e => setAudioConfig(p => ({ ...p, whisperFilterEnabled: e.target.checked }))} />
                            <span className="nx-toggle-track" />
                            <span className="nx-toggle-thumb" />
                          </label>
                          <div>
                            <span className="text-2xs font-semibold text-slate-200 block">Whisper Filter</span>
                            <span className="text-3xs text-slate-500 block mt-0.5">Amplify sub-ambient inputs</span>
                          </div>
                        </label>
                      </div>

                      {/* Go Live Button */}
                      <button 
                        onClick={handleConnectRoom} 
                        disabled={connecting}
                        className="nx-btn nx-btn-primary w-full py-3.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-2xl mt-4"
                      >
                        {connecting ? (
                          <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-white animate-pulse" /> Establish Secure Tunnel (Go Live)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ════════════════════════════
               LOBBY / HUB VIEW
               ════════════════════════════ */
            <div className="w-full lobby-scroll p-6" style={{ height: 'calc(100vh - 120px)' }}>

              {/* ── NOTIFICATION PERMISSION BANNER ── */}
              {notifPermission === 'default' && (
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-4"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255,212,172,0.07) 0%, rgba(227,154,122,0.05) 100%)',
                    border: '1px solid rgba(255,212,172,0.16)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">🔔</span>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: '#FFD4AC' }}>Enable push notifications</p>
                      <p className="text-[10px]" style={{ color: 'rgba(255,212,172,0.48)' }}>
                        Get alerted for messages and incoming calls even when NexaLink is in the background
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={handleEnableNotifications}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all"
                      style={{ background: 'rgba(255,212,172,0.15)', color: '#FFD4AC', border: '1px solid rgba(255,212,172,0.25)' }}
                    >
                      Enable
                    </button>
                    <button
                      onClick={() => setNotifPermission('denied')}
                      className="text-[10px] px-2 py-1.5 rounded-lg"
                      style={{ color: 'rgba(255,212,172,0.35)' }}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              )}

              {lobbySubView === 'settings' ? (
                /* SETTINGS SUBVIEW */
                <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 fade-up">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="nx-badge nx-badge-amber mb-1.5 uppercase tracking-widest text-[9px]">App Preferences</span>
                      <h2 className="text-xl font-bold text-white font-display flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-[var(--nx-primary)]" />
                        Account & App Settings
                      </h2>
                      <p className="text-3xs text-slate-500 mt-0.5 font-mono">Manage E2E client profile and local application state</p>
                    </div>
                    <button 
                      onClick={() => setLobbySubView('connect')}
                      className="nx-btn nx-btn-ghost text-2xs font-semibold py-2 px-4"
                    >
                      ← Back to Connect
                    </button>
                  </div>
                  {renderSettingsArea()}
                </div>
              ) : lobbySubView === 'connect' ? (
                /* CONNECT SUBVIEW */
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-6 fade-up">
                  
                  {/* Left: Connect Panels */}
                  <div className="flex flex-col gap-6">
                    
                    {/* Tunnel Room Creation Card */}
                    <div className="glass-card rounded-3xl p-6 flex flex-col gap-5">
                      <div>
                        <span className="nx-badge nx-badge-indigo mb-1.5 uppercase tracking-widest text-[9px]">Establish Secure Tunnel</span>
                        <h2 className="text-lg font-bold text-white font-display">Create or Join Secure Room</h2>
                        <p className="text-3xs text-slate-500 mt-0.5 font-mono">Military-grade AES-GCM-256 chat and collaborative whiteboard</p>
                      </div>

                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="nx-input-label text-slate-400">Tunnel Name</label>
                          <input 
                            className="nx-input text-xs font-mono" 
                            type="text" 
                            value={roomName}
                            onChange={e => setRoomName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                            placeholder="e.g. nexalink-alpha" 
                          />
                        </div>

                        <div>
                          <label className="nx-input-label text-slate-400">Connection Mode</label>
                          <div className="grid grid-cols-2 gap-3 mt-1">
                            <button 
                              onClick={() => setCallType('video')} 
                              className={`nx-btn py-3 text-2xs font-semibold flex items-center justify-center gap-2 ${callType === 'video' ? 'nx-btn-primary' : 'nx-btn-ghost'}`}
                            >
                              <Video className="w-3.5 h-3.5" /> Video + Voice Call
                            </button>
                            <button 
                              onClick={() => setCallType('voice')} 
                              className={`nx-btn py-3 text-2xs font-semibold flex items-center justify-center gap-2 ${callType === 'voice' ? 'nx-btn-primary' : 'nx-btn-ghost'}`}
                            >
                              <Headphones className="w-3.5 h-3.5" /> Voice Call Only
                            </button>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            if (!roomName.trim()) {
                              showToast('Enter a room name.', 'error');
                              return;
                            }
                            setCurrentView('connecting');
                          }} 
                          className="nx-btn nx-btn-primary py-3 text-xs flex items-center justify-center gap-2 mt-2 w-full"
                        >
                          <Zap className="w-4 h-4" /> Initialize Pre-flight Studio
                        </button>
                      </div>
                    </div>

                    {/* Direct Call Card */}
                    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-white font-display">Direct Peer Connection</h3>
                        <p className="text-3xs text-slate-500 mt-0.5">Start an instant end-to-end direct tunnel to another username</p>
                      </div>
                      <div className="flex gap-2.5">
                        <input 
                          className="nx-input flex-1 text-xs" 
                          value={directPeer}
                          onChange={e => setDirectPeer(e.target.value)}
                          placeholder="Type peer's handle (e.g. Bob)" 
                        />
                        <button 
                          onClick={() => {
                            if (!directPeer.trim()) {
                              showToast('Enter a username to call.', 'error');
                              return;
                            }
                            setRoomName(`Direct-${[userName, directPeer].map(n => n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).sort().join('-')}`);
                            setCallType('video');
                            setCurrentView('connecting');
                          }}
                          className="nx-btn nx-btn-ghost text-2xs px-4"
                        >
                          Video Call
                        </button>
                        <button 
                          onClick={() => {
                            if (!directPeer.trim()) {
                              showToast('Enter a username to call.', 'error');
                              return;
                            }
                            setRoomName(`Direct-${[userName, directPeer].map(n => n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).sort().join('-')}`);
                            setCallType('voice');
                            setCurrentView('connecting');
                          }}
                          className="nx-btn nx-btn-ghost text-2xs px-4"
                        >
                          Voice Call
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: Sidebar Panel */}
                  <div className="glass-card rounded-3xl p-6 flex flex-col gap-5 max-h-[500px]">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setSidebarTab('contacts')}
                          className={`text-xs font-bold transition-all relative pb-1 ${
                            sidebarTab === 'contacts' ? 'text-white border-b-2 border-[var(--nx-primary)]' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          Contacts
                        </button>
                        <button 
                          onClick={() => setSidebarTab('calls')}
                          className={`text-xs font-bold transition-all relative pb-1 ${
                            sidebarTab === 'calls' ? 'text-white border-b-2 border-[var(--nx-primary)]' : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          Call History
                        </button>
                      </div>
                      <span className="nx-badge nx-badge-indigo">
                        {sidebarTab === 'contacts' ? contacts.length : callHistory.length}
                      </span>
                    </div>

                    {sidebarTab === 'contacts' ? (
                      <>
                        {/* Add contact */}
                        <div className="flex gap-2">
                          <input 
                            className="nx-input text-xs" 
                            value={newContact}
                            onChange={e => setNewContact(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addContact(); }}
                            placeholder="Add username..." 
                          />
                          <button onClick={addContact} className="nx-btn-icon active px-3">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Contacts List Scroll Container */}
                        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                          {contacts.length === 0 ? (
                            <p className="text-3xs text-slate-600 text-center py-8 italic">No saved contacts yet.</p>
                          ) : (
                            contacts.map(contact => {
                              const unreadCount = unreadChatCounts[contact.username] || 0;
                              return (
                                <div 
                                  key={contact.id} 
                                  className="relative flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-white/2 hover:bg-indigo-950/20 hover:border-indigo-500/20 transition-all duration-300 group"
                                >
                                  <div className="relative flex-shrink-0">
                                    {contact.profilePic ? (
                                      <img src={contact.profilePic} alt={contact.username} className="w-10 h-10 rounded-2xl object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold" style={{ background: 'var(--nx-teal-soft)', color: 'var(--nx-primary-dark)' }}>
                                        {contact.username.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-950 shadow-sm ${
                                      onlineUsers.has(contact.username.toLowerCase()) ? 'bg-emerald-500' : 'bg-slate-600'
                                    }`} />
                                  </div>
                                  
                                  {/* Unread indicator */}
                                  {unreadCount > 0 && (
                                    <div className="absolute -top-1 -left-1 w-5 h-5 bg-rose-600 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg">
                                      {unreadCount}
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    <p className="text-2xs font-semibold text-white truncate">{contact.username}</p>
                                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{contact.bio || 'Secure Contact'}</p>
                                  </div>

                                  {/* Hover Options Overlay */}
                                  <div className="absolute inset-0 bg-slate-950/90 rounded-2xl flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm px-2">
                                    <span className="text-[10px] text-slate-400 font-semibold truncate flex-1 pl-2">{contact.username}</span>
                                    <button 
                                      onClick={() => {
                                        setLobbySubView('chat_lobby');
                                        setActiveChatContact(contact);
                                        setUnreadChatCounts(prev => ({ ...prev, [contact.username]: 0 }));
                                      }}
                                      className="nx-btn nx-btn-ghost text-[9px] py-1 px-2 flex items-center gap-1"
                                    >
                                      <MessageSquare className="w-3 h-3 text-indigo-400" /> Chat
                                    </button>
                                    <button 
                                      onClick={() => callContact(contact.username)}
                                      className="nx-btn nx-btn-primary text-[9px] py-1 px-2 flex items-center gap-1"
                                    >
                                      <Video className="w-3 h-3" /> Call
                                    </button>
                                    <button 
                                      onClick={() => removeContact(contact.username)}
                                      className="nx-btn nx-btn-danger text-[9px] py-1 px-2 flex items-center gap-1"
                                      title="Remove Contact"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    ) : (
                      /* Call History List Scroll Container */
                      <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                        {callHistory.length === 0 ? (
                          <p className="text-3xs text-slate-600 text-center py-8 italic">No call attempts yet.</p>
                        ) : (
                          callHistory.map(call => {
                            const isOutgoing = call.caller.toLowerCase() === userName.toLowerCase();
                            const peerName = isOutgoing ? call.callee : call.caller;
                            const callTime = new Date(call.started_at).toLocaleString('en-IN', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            });
                            return (
                              <div 
                                key={call.id} 
                                className="flex items-center gap-3 p-3 rounded-2xl border border-white/5 bg-white/2 hover:bg-indigo-950/10 transition-all duration-300"
                              >
                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold" style={{ background: call.status === 'accepted' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: call.status === 'accepted' ? '#34d399' : '#fca5a5' }}>
                                  {isOutgoing ? '↗' : '↙'}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <p className="text-2xs font-semibold text-white truncate">{peerName}</p>
                                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{callTime} · {call.call_type}</p>
                                </div>
                                
                                <div className="flex flex-col items-end gap-1">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                    call.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                    call.status === 'declined' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                    'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {call.status}
                                  </span>
                                  <button 
                                    onClick={() => callContact(peerName)}
                                    className="text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold"
                                  >
                                    Call
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                  </div>
                </div>
              ) : (
                /* CHAT LOBBY SUBVIEW */
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 glass-card rounded-3xl p-6 fade-up" style={{ height: 'calc(100vh - 160px)' }}>
                  
                  {/* Left Column: Switcher */}
                  <div className="flex flex-col gap-4 border-r border-white/5 pr-4 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Active Conversations</h3>
                      <button 
                        onClick={() => setLobbySubView('connect')}
                        className="text-3xs text-indigo-400 hover:text-indigo-300 font-bold"
                      >
                        ← Exit Chat Lobby
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
                      {contacts.length === 0 ? (
                        <p className="text-3xs text-slate-600 text-center py-8">Add contacts to chat.</p>
                      ) : (
                        contacts.map(c => {
                          const isActive = activeChatContact?.id === c.id;
                          const unreadCount = unreadChatCounts[c.username] || 0;
                          return (
                            <div 
                              key={c.id}
                              onClick={() => {
                                setActiveChatContact(c);
                                setUnreadChatCounts(prev => ({ ...prev, [c.username]: 0 }));
                              }}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition ${isActive ? 'bg-[var(--nx-teal-soft)] border border-[var(--nx-primary)]/30' : 'border border-transparent hover:bg-white/2'}`}
                            >
                              <div className="relative">
                                {c.profilePic ? (
                                  <img src={c.profilePic} alt={c.username} className="w-8 h-8 rounded-xl object-cover" />
                                ) : (
                                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold bg-white/5">
                                    {c.username.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                {unreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 w-4.5 h-4.5 bg-rose-600 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg animate-pulse">
                                    {unreadCount}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-3xs font-semibold text-white truncate">{c.username}</p>
                                <p className="text-[10px] text-slate-500 truncate">{(lobbyChats[c.username] || []).slice(-1)[0]?.text || 'No messages yet'}</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Column: Chat Window */}
                  <div className="flex flex-col h-full overflow-hidden">
                    {activeChatContact ? (
                      <>
                        {/* Gorgeous WhatsApp-style Chat Header */}
                        <div className="flex items-center justify-between pb-3.5 border-b border-white/5 mb-4 mt-1">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              {activeChatContact.profilePic ? (
                                <img src={activeChatContact.profilePic} alt={activeChatContact.username} className="w-10 h-10 rounded-2xl object-cover border border-white/10 shadow-md" />
                              ) : (
                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold bg-white/5 border border-white/10 text-white shadow-md">
                                  {activeChatContact.username.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 shadow-sm ${
                                onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'bg-emerald-500' : 'bg-slate-600'
                              }`} />
                            </div>
                            <div className="text-left">
                              <h4 className="text-xs font-bold text-white leading-tight flex items-center gap-2">
                                @{activeChatContact.username}
                                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-sans font-semibold tracking-wider uppercase ${
                                  onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                }`}>
                                  {onlineUsers.has(activeChatContact.username.toLowerCase()) ? 'online' : 'offline'}
                                </span>
                              </h4>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">{activeChatContact.bio || 'Secure Contact'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setCallType('voice');
                                callContact(activeChatContact.username);
                              }}
                              className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-indigo-400 hover:text-white hover:bg-indigo-500/20 hover:border-indigo-500/30 transition shadow-md cursor-pointer"
                              title="Voice Call"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setCallType('video');
                                callContact(activeChatContact.username);
                              }}
                              className="w-8 h-8 rounded-xl bg-[var(--nx-primary-soft)] border border-[var(--nx-primary)]/20 flex items-center justify-center text-[var(--nx-primary)] hover:text-white hover:bg-[var(--nx-primary)]/20 hover:border-[var(--nx-primary)]/30 transition shadow-md cursor-pointer animate-pulse"
                              title="Video Call"
                            >
                              <Video className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 pb-3">
                          {/* Pending file requests from this user */}
                          {pendingFiles.filter(f => f.sender.toLowerCase() === activeChatContact.username.toLowerCase()).map(f => {
                            const isStale = f.created_at && (Date.now() - new Date(f.created_at).getTime() > 10 * 60 * 1000);
                            return (
                            <div 
                              key={f.id}
                              className="p-3.5 rounded-2xl border border-[var(--nx-primary)]/20 mb-3 flex flex-col gap-3 text-left"
                              style={{
                                background: 'linear-gradient(145deg, rgba(44, 37, 35, 0.95) 0%, rgba(28, 22, 20, 0.98) 100%)',
                                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-lg">
                                  📁
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-2xs font-bold text-white truncate">{f.file_name}</p>
                                  <p className="text-[10px]" style={{ color: 'rgba(255, 212, 172, 0.6)' }}>
                                    Incoming Secure File · {(f.file_size / (1024*1024)).toFixed(2)} MB
                                  </p>
                                </div>
                              </div>
                              {isStale && (
                                <p className="text-[10px] px-2 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(234, 179, 8, 0.08)', color: '#fbbf24', border: '1px solid rgba(234, 179, 8, 0.15)' }}>
                                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                  Sender may be offline — transfer might not start
                                </p>
                              )}
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => acceptFileTransfer(f)}
                                  className="flex-1 py-2 rounded-xl text-3xs font-bold text-white transition-all hover:brightness-110"
                                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
                                >
                                  ✅ Accept Transfer
                                </button>
                                <button 
                                  onClick={() => declineFileTransfer(f)}
                                  className="py-2 px-4 rounded-xl text-3xs font-bold transition hover:bg-white/5"
                                  style={{ border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}
                                >
                                  ❌ Decline
                                </button>
                              </div>
                            </div>
                            );
                          })}

                          {(lobbyChats[activeChatContact.username] || []).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center opacity-40">
                              <MessageSquare className="w-10 h-10 text-slate-500" />
                              <p className="text-3xs text-slate-400">Establish connection. Send a direct message.</p>
                            </div>
                          ) : (
                            (lobbyChats[activeChatContact.username] || []).map(m => (
                              <div key={m.id} className={`chat-bubble ${m.self ? 'self' : 'remote'}`}>
                                <span className="sender">{m.self ? 'You' : m.sender}</span>
                                <div className="bubble">{m.text}</div>
                                <span className="time">{m.time}</span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* File Transfer Progress Card */}
                        {fileTransferProgress && fileTransferProgress.status !== 'idle' && (
                          <div 
                            className="p-3.5 rounded-2xl border mb-3 flex flex-col gap-2 text-left"
                            style={{
                              background: 'rgba(44, 37, 35, 0.95)',
                              borderColor: fileTransferProgress.status === 'completed' ? 'rgba(16, 185, 129, 0.3)' :
                                           fileTransferProgress.status === 'failed' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 212, 172, 0.2)',
                              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">
                                  {fileTransferProgress.status === 'completed' ? '✅' :
                                   fileTransferProgress.status === 'failed' ? '❌' : '📥'}
                                </span>
                                <div>
                                  <p className="text-2xs font-bold text-white truncate max-w-xs">{fileTransferProgress.fileName}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {(fileTransferProgress.fileSize / (1024 * 1024)).toFixed(2)} MB · {fileTransferProgress.role === 'sender' ? 'Uploading (P2P)' : 'Downloading (P2P)'}
                                  </p>
                                </div>
                              </div>
                              <span className="text-3xs text-slate-500 font-mono">{fileTransferProgress.speed}</span>
                            </div>

                            {/* Progress bar */}
                            {fileTransferProgress.status !== 'failed' && (
                              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden border border-white/5">
                                <div 
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{ 
                                    width: `${fileTransferProgress.progress}%`,
                                    background: fileTransferProgress.status === 'completed' ? '#10b981' : '#FFD4AC' 
                                  }}
                                />
                              </div>
                            )}

                            <div className="flex justify-between items-center text-3xs">
                              <span className="font-semibold" style={{ 
                                color: fileTransferProgress.status === 'completed' ? '#34d399' :
                                       fileTransferProgress.status === 'failed' ? '#f87171' : '#FFD4AC'
                              }}>
                                {fileTransferProgress.status === 'connecting' && 'Negotiating direct channel...'}
                                {fileTransferProgress.status === 'transferring' && `Streaming... ${fileTransferProgress.progress}%`}
                                {fileTransferProgress.status === 'completed' && 'Completed'}
                                {fileTransferProgress.status === 'failed' && 'Transfer failed'}
                              </span>
                              {(fileTransferProgress.status === 'transferring' || fileTransferProgress.status === 'connecting') ? (
                                <button 
                                  onClick={() => cancelFileTransfer(activeChatContact?.username || '')}
                                  className="text-rose-400 hover:text-rose-300 font-bold transition px-2 py-0.5 rounded border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-4xs uppercase tracking-wider"
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button 
                                  onClick={() => setFileTransferProgress(null)}
                                  className="text-slate-400 hover:text-white font-semibold transition"
                                >
                                  Dismiss
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Message Input */}
                        <div className="flex gap-2 pt-2 border-t border-white/5 items-center">
                          <label className="nx-btn-icon cursor-pointer flex items-center justify-center px-3 py-2 bg-white/5 hover:bg-white/10 transition border border-white/10 rounded-xl" title="Send Secure File (P2P)">
                            <Paperclip className="w-4 h-4 text-slate-300" />
                            <input 
                              id="secure-file-input"
                              type="file" 
                              className="hidden" 
                              onChange={handleFileSelected} 
                            />
                          </label>
                          <input 
                            className="nx-input flex-1 text-xs" 
                            value={lobbyChatInput}
                            onChange={e => setLobbyChatInput(e.target.value)}
                            onKeyDown={e => { if (chatSettings.pressEnterToSend && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLobbyChat(); } }}
                            placeholder={`Message ${activeChatContact.username}...`} 
                          />
                          <button 
                            onClick={sendLobbyChat} 
                            disabled={!lobbyChatInput.trim()}
                            className="nx-btn-icon active px-4"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center opacity-45">
                        <User className="w-12 h-12 text-slate-500" />
                        <p className="text-3xs text-slate-400">Select a contact from the active conversations panel to begin messaging.</p>
                      </div>
                    )}
                  </div>
                  
                </div>
              )}
            </div>
                  )
      ) : (
        /* ════════════════════════════
           ACTIVE CALL VIEW
           ════════════════════════════ */
        <div className="flex-1 flex active-call-shell">

            {/* ── LEFT: VIDEO GRID ─── */}
            <div ref={callStageRef} className="flex-1 flex flex-col p-4 gap-4 call-stage">

              {/* Remote-control warning banner */}
              {controlledBy && (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl nx-alert"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <span className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
                    Remote control active — operator: <strong>{controlledBy}</strong>
                  </span>
                  <button onClick={triggerEmergencyKill}
                    className="nx-btn nx-btn-danger text-2xs py-1.5 px-3">
                    <Zap className="w-3 h-3" /> Kill Switch
                  </button>
                </div>
              )}

              {/* ── TOPBAR ── */}
              <div className="call-topbar flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-2xl">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-950 truncate">{roomName}</p>
                  <p className="text-3xs text-slate-500">{participants.length + 1} participants · {isConnected ? 'secure relay live' : 'reconnecting'}</p>
                </div>

                {/* ── Layout picker ── */}
                <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(44,37,35,0.06)', border: '1px solid rgba(44,37,35,0.09)' }}>
                  {([
                    { id: 'auto',       Icon: LayoutGrid,        tip: 'Auto Grid' },
                    { id: 'pip-remote', Icon: PictureInPicture2,  tip: 'Remote Focus (PiP)' },
                    { id: 'pip-local',  Icon: LayoutPanelLeft,    tip: 'Self Focus (PiP)' },
                    { id: 'equal',      Icon: Columns2,            tip: 'Side by Side' },
                    { id: 'horizontal', Icon: LayoutPanelTop,     tip: 'Horizontal Strip' },
                  ] as { id: typeof streamLayout; Icon: React.FC<{ className?: string }>; tip: string }[]).map(({ id, Icon, tip }) => (
                    <button
                      key={id}
                      title={tip}
                      onClick={() => setStreamLayout(id)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 nx-tooltip`}
                      data-tip={tip}
                      style={streamLayout === id
                        ? { background: 'var(--nx-primary)', color: '#fff', boxShadow: '0 2px 8px rgba(209,110,71,0.35)' }
                        : { color: 'var(--nx-muted)' }
                      }
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setFitMode(mode => mode === 'cover' ? 'contain' : 'cover')}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3">
                    <Scan className="w-3.5 h-3.5" /> {fitMode === 'cover' ? 'Fit' : 'Fill'}
                  </button>
                  <button onClick={() => openFullscreen()}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3">
                    <Maximize2 className="w-3.5 h-3.5" /> Full Screen
                  </button>
                  <button onClick={() => setHiddenTiles([])}
                    className="nx-btn nx-btn-ghost text-2xs py-2 px-3"
                    disabled={hiddenTiles.length === 0}>
                    <Eye className="w-3.5 h-3.5" /> Show All
                  </button>
                </div>
                <span className="text-3xs font-mono text-slate-500">
                  {orderedParticipants.length + (isSelfHidden ? 0 : 1)} visible · {hiddenTiles.length} hidden
                </span>
              </div>

              {/* Video grid */}
              {/* Layout styles:
                  auto        → 2-col grid, adapts to participant count
                  pip-remote  → single column full, self as floating PiP overlay
                  pip-local   → self full, remote as floating PiP overlay
                  equal       → always exactly 2 equal columns
                  horizontal  → row: self 40% | remotes 60% in column
              */}
              <div
                className={`flex-1 gap-4 overflow-y-auto ${
                  streamLayout === 'horizontal' ? 'flex flex-row'
                  : streamLayout === 'equal'    ? 'grid'
                  : streamLayout === 'pip-remote' || streamLayout === 'pip-local' ? 'relative'
                  : 'grid'
                } ${hasPinnedTile ? 'video-grid-pinned' : ''}`}
                style={{
                  minHeight: 280,
                  height: '100%',
                  ...(streamLayout === 'auto'
                    ? {
                        gridTemplateColumns: totalVisibleTiles <= 1 ? '1fr' : 'repeat(2, 1fr)',
                        gridTemplateRows: totalVisibleTiles <= 2 ? '1fr' : 'repeat(2, 1fr)',
                      }
                    : streamLayout === 'equal'
                    ? { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: '1fr' }
                    : streamLayout === 'horizontal'
                    ? {}   // flex-row handled by class
                    : {}   // pip modes: children positioned absolutely
                  ),
                }}>

                {/* Self tile */}
                {!isSelfHidden && (
                <div
                  id="tile-self"
                  className={`video-tile ${
                    controlledBy ? 'controlled' : ''
                  } ${pinnedTile === 'self' ? 'pinned' : ''} ${
                    streamLayout === 'pip-remote' ? 'layout-pip-self' : ''
                  } ${
                    streamLayout === 'pip-local' ? 'layout-pip-local-self' : ''
                  } ${
                    streamLayout === 'horizontal' ? 'layout-horizontal-self' : ''
                  }`}
                  style={{
                    height: (streamLayout === 'auto' || streamLayout === 'equal') ? '100%' : undefined,
                    minHeight: streamLayout === 'pip-remote' ? 0 : 220,
                    ...(streamLayout === 'pip-local' ? { flex: 1, minHeight: 220 } : {}),
                  }}>
                  {isSelfHidden && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/90 backdrop-blur-sm z-20">
                      <EyeOff className="w-6 h-6 text-slate-500" />
                      <p className="text-[10px] text-slate-500 font-semibold uppercase">Your Stream Hidden Locally</p>
                      <button onClick={() => toggleLocalHide('self')} className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold mt-1">Unhide Stream</button>
                    </div>
                  )}
                  <video ref={localVideoRef} autoPlay playsInline muted
                    className={`w-full h-full ${videoFitClass} ${videoEnabled ? '' : 'opacity-0'}`} style={{ transform: 'scaleX(-1)', minHeight: 220 }} />

                  {!videoEnabled && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
                      style={{ background: 'radial-gradient(circle at 50% 20%, rgba(99,102,241,0.18), rgba(6,10,24,0.96) 58%)' }}>
                      {profile.profilePic ? (
                        <img src={profile.profilePic} alt={userName}
                          className="w-24 h-24 rounded-full object-cover border-2 border-indigo-500/40 shadow-xl" />
                      ) : (
                        <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl border-2 border-indigo-500/30"
                          style={{ background: 'rgba(99,102,241,0.14)' }}>
                          {myAlias.avatar}
                        </div>
                      )}
                      <div>
                        <p className="text-lg font-bold text-white">{profile.username || myAlias.name}</p>
                      </div>
                    </div>
                  )}

                  <div className="video-nameplate">
                    <div className="flex items-center gap-2">
                      <span className="status-dot live" style={{ width: 6, height: 6 }} />
                      <span className="text-xs font-semibold text-white">{myAlias.name} (You)</span>
                    </div>
                    <div className="flex items-end gap-0.5 h-3.5">
                      <span className="audio-bar" />
                      <span className="audio-bar" />
                      <span className="audio-bar" />
                      <span className="audio-bar" />
                    </div>
                  </div>

                  <div className="tile-actions">
                    <button onClick={() => togglePinnedTile('self')} className="tile-action" title={pinnedTile === 'self' ? 'Unpin' : 'Pin'}>
                      {pinnedTile === 'self' ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => openFullscreen('tile-self')} className="tile-action" title="Fullscreen">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleLocalHide('self')} className="tile-action" title="Hide Locally">
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Muted / vid-off indicators */}
                  {!audioEnabled && (
                    <div className="absolute top-3 right-3">
                      <span className="nx-badge nx-badge-rose"><MicOff className="w-2.5 h-2.5" /></span>
                    </div>
                  )}
                  {!videoEnabled && (
                    <div className="absolute top-3 left-3">
                      <span className="nx-badge nx-badge-indigo"><VideoOff className="w-2.5 h-2.5" /> Profile</span>
                    </div>
                  )}
                </div>
                )}

                {/* Participants */}
                {orderedParticipants.length === 0 ? (
                  <div
                    className="video-tile flex flex-col items-center justify-center gap-4 p-8"
                    style={{
                      minHeight: 220,
                      ...(streamLayout === 'pip-remote' || streamLayout === 'pip-local'
                        ? { position: 'absolute', inset: 0, borderRadius: 'inherit' }
                        : streamLayout === 'horizontal'
                        ? { flex: 1 }
                        : {}),
                    }}>
                    <Radio className="w-8 h-8 text-[var(--nx-primary)]/40 animate-pulse" />
                    <div className="text-center">
                      <p className="text-xs text-slate-500">Waiting for peers…</p>
                      <p className="text-2xs text-slate-600 mt-1">Share room code to invite</p>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer hover:bg-[var(--nx-teal-soft)] transition"
                      style={{ border: '1px solid var(--nx-line-strong)', background: 'var(--nx-panel)' }}
                      onClick={() => copyInviteLink()}>
                      <Hash className="w-3 h-3 text-[var(--nx-primary)]" />
                      <span className="font-mono text-2xs text-[var(--nx-primary-dark)]">{roomName}</span>
                      <Copy className="w-3 h-3 text-[var(--nx-primary)]" />
                    </div>
                  </div>
                ) : (
                  orderedParticipants.map((peer, peerIdx) => (
                    <div
                      id={`tile-${peer.id}`}
                      key={peer.id}
                      className={`video-tile flex flex-col items-center justify-center gap-4 p-6 ${
                        pinnedTile === peer.id ? 'pinned' : ''
                      } ${
                        streamLayout === 'pip-remote' ? 'layout-pip-remote-peer' : ''
                      } ${
                        streamLayout === 'pip-local' ? 'layout-pip-local-peer' : ''
                      } ${
                        streamLayout === 'horizontal' ? 'layout-horizontal-peer' : ''
                      }`}
                      style={(() => {
                        if (streamLayout === 'pip-remote') {
                          return peerIdx === 0
                            ? { position: 'absolute' as const, inset: 0, zIndex: 1, borderRadius: 'inherit', minHeight: 0 }
                            : { position: 'absolute' as const, bottom: 16, left: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 };
                        }
                        if (streamLayout === 'pip-local') {
                          return peerIdx === 0
                            ? { position: 'absolute' as const, bottom: 16, right: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 }
                            : { position: 'absolute' as const, bottom: 16, left: 16, width: 140, height: 100, zIndex: 3, borderRadius: 12, minHeight: 0 };
                        }
                        if (streamLayout === 'horizontal') {
                          return { flex: peerIdx === 0 ? 1 : undefined, minHeight: peerIdx === 0 ? 220 : 120 };
                        }
                        return { minHeight: 220, height: (streamLayout === 'auto' || streamLayout === 'equal') ? '100%' : undefined };
                      })()}>
                      {locallyHiddenPeers.includes(peer.id) ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/90 backdrop-blur-sm z-20">
                          <EyeOff className="w-6 h-6 text-slate-500" />
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Stream Hidden Locally</p>
                          <button onClick={() => toggleLocalHide(peer.id)} className="text-[9px] text-[var(--nx-primary)] hover:text-[var(--nx-primary-dark)] font-bold mt-1">Unhide Stream</button>
                        </div>
                      ) : null}
                      
                      {peer.profilePic ? (
                        <img src={peer.profilePic} alt={peer.name}
                          className="w-20 h-20 rounded-full object-cover border-2 border-[var(--nx-primary)]/20 shadow-xl" />
                      ) : (
                        <div className="participant-avatar">{peer.avatar}</div>
                      )}
                      
                      {locallyMutedPeers.includes(peer.id) && (
                        <div className="absolute top-3 right-3 z-30">
                          <span className="nx-badge nx-badge-rose"><MicOff className="w-2.5 h-2.5" /> Locally Muted</span>
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-sm font-bold text-white">{peer.name}</p>
                        <p className="text-2xs text-slate-500 mt-1">
                          Control: <span className="text-[var(--nx-primary-dark)]">{peer.controlPermissionLevel}</span>
                        </p>
                      </div>
                      {peer.isSharingScreen && (
                        <button onClick={() => setRequestControlTarget({ id: peer.id, name: peer.name })}
                          className="nx-btn nx-btn-ghost text-2xs py-1.5 px-4">
                          <Zap className="w-3.5 h-3.5" /> Request Control
                        </button>
                      )}
                      <div className="tile-actions">
                        <button onClick={() => togglePinnedTile(peer.id)} className="tile-action" title={pinnedTile === peer.id ? 'Unpin' : 'Pin'}>
                          {pinnedTile === peer.id ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => openFullscreen(`tile-${peer.id}`)} className="tile-action" title="Fullscreen">
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleLocalHide(peer.id)} className="tile-action" title="Hide Locally">
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => {
                          setLocallyMutedPeers(prev => prev.includes(peer.id) ? prev.filter(id => id !== peer.id) : [...prev, peer.id]);
                        }} className={`tile-action ${locallyMutedPeers.includes(peer.id) ? 'text-rose-400' : ''}`} title="Mute Locally">
                          {locallyMutedPeers.includes(peer.id) ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {/* Screen share inside the grid! */}
                {screenStream && (
                  <div
                    id="tile-screen"
                    className={`video-tile ${pinnedTile === 'screen' ? 'pinned' : ''}`}
                    style={{
                      height: (streamLayout === 'auto' || streamLayout === 'equal') ? '100%' : undefined,
                      minHeight: 220
                    }}
                  >
                    <video ref={screenVideoRef} autoPlay playsInline
                      className={`w-full h-full ${fitMode === 'cover' ? 'object-cover' : 'object-contain'}`} />
                    <div className="absolute top-3 left-3">
                      <span className="nx-badge nx-badge-rose">
                        <Monitor className="w-2.5 h-2.5" /> Sharing Screen
                      </span>
                    </div>
                    <div className="tile-actions">
                      <button onClick={() => togglePinnedTile('screen')} className="tile-action" title={pinnedTile === 'screen' ? 'Unpin' : 'Pin'}>
                        {pinnedTile === 'screen' ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => openFullscreen('tile-screen')} className="tile-action" title="Fullscreen">
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              </div>

              <div className="stage-floating-controls" aria-label="Fullscreen call controls">
                <button onClick={toggleAudio}
                  className={`nx-btn-icon nx-tooltip ${!audioEnabled ? 'active-danger' : ''}`}
                  data-tip={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}>
                  {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button onClick={toggleVideo}
                  className={`nx-btn-icon nx-tooltip ${!videoEnabled ? 'active-danger' : ''}`}
                  data-tip={videoEnabled ? 'Stop Camera' : 'Start Camera'}>
                  {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
                <button onClick={toggleScreenShare}
                  className={`nx-btn-icon nx-tooltip ${screenStream ? 'active' : ''}`}
                  data-tip={screenStream ? 'Stop Sharing' : 'Share Screen'}>
                  {screenStream ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                </button>
                <button onClick={() => setFitMode(mode => mode === 'cover' ? 'contain' : 'cover')}
                  className="nx-btn-icon nx-tooltip"
                  data-tip={fitMode === 'cover' ? 'Fit to Screen' : 'Fill Screen'}>
                  <Scan className="w-4 h-4" />
                </button>
                <button onClick={() => setActiveTab('chat')}
                  className={`nx-btn-icon nx-tooltip ${activeTab === 'chat' ? 'active' : ''}`}
                  data-tip="Chat">
                  <MessageSquare className="w-4 h-4" />
                </button>
                <button onClick={() => setActiveTab('participants')}
                  className={`nx-btn-icon nx-tooltip ${activeTab === 'participants' ? 'active' : ''}`}
                  data-tip="Participants">
                  <Users className="w-4 h-4" />
                </button>
                <button onClick={handleDisconnectRoom}
                  className="nx-btn nx-btn-danger text-xs">
                  <PhoneOff className="w-4 h-4" />
                  Leave
                </button>
              </div>

              {/* Chaperone overlay */}
              {pendingControlRequestFrom && (
                <ChaperoneOverlay
                  requesterName={participants.find(p => p.id === pendingControlRequestFrom)?.name || 'Remote Peer'}
                  requesterId={pendingControlRequestFrom}
                  accessType={pendingControlRequestType}
                  onRespond={respondToControlRequest}
                />
              )}

              {/* Request Remote Control Granular Choice Modal */}
              {requestControlTarget && (
                <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300">
                  <div className="w-full max-w-sm glass-bright rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200 border-t border-white/10"
                       style={{ background: 'var(--nx-panel-solid)', color: 'var(--nx-ink)' }}>
                    
                    {/* Peach gradient glowing shapes */}
                    <div className="absolute -top-16 -right-16 w-32 h-32 rounded-full blur-3xl pointer-events-none"
                         style={{ background: 'rgba(227, 154, 122, 0.25)' }} />
                    <div className="absolute -bottom-16 -left-16 w-32 h-32 rounded-full blur-3xl pointer-events-none"
                         style={{ background: 'rgba(255, 182, 172, 0.25)' }} />

                    {/* Header */}
                    <div className="flex items-center space-x-3 mb-5">
                      <div className="p-2.5 rounded-2xl flex items-center justify-center"
                           style={{ background: 'rgba(209, 110, 71, 0.08)', border: '1px solid rgba(209, 110, 71, 0.15)', color: 'var(--nx-primary)' }}>
                        <Zap className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="text-md font-bold font-display" style={{ color: 'var(--nx-ink)' }}>
                          Request Remote Control
                        </h3>
                        <p className="text-3xs text-slate-500 leading-tight">
                          Select the target interaction permissions for <span className="font-semibold" style={{ color: 'var(--nx-primary)' }}>{requestControlTarget.name}</span>
                        </p>
                      </div>
                    </div>

                    {/* Choices */}
                    <div className="space-y-2 mb-6">
                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'mouse');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'rgba(255, 255, 255, 0.6)',
                          borderColor: 'rgba(209, 110, 71, 0.12)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-100 rounded-xl group-hover:bg-amber-100 transition-colors">
                            <MousePointer className="w-4 h-4 text-slate-600 group-hover:text-amber-600" />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-ink)' }}>Mouse Control Only</p>
                            <p className="text-4xs text-slate-500">Inject cursor clicks and hover inputs only</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(220, 177, 107, 0.12)', color: '#ac7b30' }}>
                          Mouse
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'keyboard');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'rgba(255, 255, 255, 0.6)',
                          borderColor: 'rgba(209, 110, 71, 0.12)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-100 rounded-xl group-hover:bg-indigo-100 transition-colors">
                            <Keyboard className="w-4 h-4 text-slate-600 group-hover:text-indigo-600" />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-ink)' }}>Keyboard Control Only</p>
                            <p className="text-4xs text-slate-500">Inject primary system-wide typing inputs only</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(129, 140, 248, 0.12)', color: '#4f46e5' }}>
                          Keys
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          requestRemoteControl(requestControlTarget.id, 'both');
                          setRequestControlTarget(null);
                        }}
                        className="w-full p-3.5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between group"
                        style={{
                          background: 'linear-gradient(135deg, rgba(209, 110, 71, 0.05), rgba(255, 182, 172, 0.1))',
                          borderColor: 'var(--nx-primary)',
                        }}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-xl" style={{ background: 'rgba(209, 110, 71, 0.1)' }}>
                            <Zap className="w-4 h-4" style={{ color: 'var(--nx-primary)' }} />
                          </div>
                          <div>
                            <p className="text-2xs font-bold" style={{ color: 'var(--nx-primary)' }}>Full Session Control</p>
                            <p className="text-4xs text-slate-600">Inject both mouse clicks and keystroke inputs</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white"
                              style={{ background: 'var(--nx-primary)' }}>
                          Full
                        </span>
                      </button>
                    </div>

                    {/* Footer Cancel */}
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => setRequestControlTarget(null)}
                        className="py-2.5 px-5 text-2xs font-bold rounded-xl transition-all duration-150 hover:bg-slate-100 active:scale-95"
                        style={{ border: '1px solid rgba(209, 110, 71, 0.15)', color: 'var(--nx-primary)' }}
                      >
                        Cancel
                      </button>
                    </div>

                  </div>
                </div>
              )}
            </div>

            {/* Draggable Resizer Handle */}
            <div
              className="w-1.5 hover:w-2 bg-slate-200/10 hover:bg-indigo-500/20 cursor-col-resize transition-all duration-150 relative z-30 self-stretch flex items-center justify-center border-l border-r border-white/5"
              onMouseDown={startResizing}
              title="Drag to resize sidebar"
            >
              <div className="w-0.5 h-8 rounded bg-slate-400 opacity-40 group-hover:opacity-100" />
            </div>

            {/* ── RIGHT: SIDEBAR ─── */}
            <aside className="flex flex-col overflow-hidden call-sidebar" style={{ width: sidebarWidth }}>

              {/* Tab bar */}
              <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {([
                  { id: 'audio',        icon: Headphones,    label: 'Voice' },
                  { id: 'chat',         icon: MessageSquare, label: 'Chat',  badge: unreadChat },
                  { id: 'whiteboard',   icon: Edit2,         label: 'Board' },
                  { id: 'participants', icon: Users,          label: 'Peers' },
                  { id: 'contacts',     icon: BookUser,       label: 'Book' },
                  { id: 'profile',      icon: Sliders,        label: 'Config' },
                  { id: 'control',      icon: Lock,          label: 'Ctrl' },
                ] as { id: Tab; icon: any; label: string; badge?: number }[]).map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className={`nx-tab ${activeTab === t.id ? 'active' : ''} relative`}>
                    <t.icon style={{ width: 13, height: 13 }} />
                    {t.label}
                    {t.badge !== undefined && t.badge > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 text-[9px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center">
                        {t.badge > 9 ? '9+' : t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className={`flex-1 p-4 ${activeTab === 'chat' ? 'overflow-hidden' : 'overflow-y-auto'}`}>

                {/* ── VOICE PANEL ── */}
                {activeTab === 'audio' && (
                  <div className="flex flex-col gap-5">

                    {/* Pipeline status */}
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--nx-teal-soft)', border: '1px solid var(--nx-line-strong)' }}>
                      <span className="text-2xs text-[var(--nx-primary-dark)] font-semibold flex items-center gap-2">
                        <Activity className="w-3 h-3 text-[var(--nx-primary)]" /> DSP Pipeline
                      </span>
                      <span className="nx-badge nx-badge-green">Active</span>
                    </div>

                    {/* Voice meter live */}
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-2xs text-slate-400 font-semibold">Input Level</span>
                        <span className="text-2xs font-mono text-[var(--nx-primary-dark)]">{Math.round(volPercent)}%</span>
                      </div>
                      <div className="voice-meter">
                        <div className="voice-meter-fill" style={{ width: `${volPercent}%` }} />
                      </div>
                    </div>

                    {/* Pitch shift */}
                    <div>
                      <p className="nx-section-header mb-3">Voice Morphing</p>
                      <div className="flex justify-between text-2xs mb-2">
                        <span className="text-slate-400">Pitch Shift</span>
                        <span className="font-mono text-[var(--nx-primary-dark)] font-bold">
                          {audioConfig.pitchShift > 0 ? `+${audioConfig.pitchShift}` : audioConfig.pitchShift} st
                        </span>
                      </div>
                      <input type="range" min="-12" max="12" value={audioConfig.pitchShift}
                        onChange={e => setAudioConfig(p => ({ ...p, pitchShift: parseInt(e.target.value) }))} />
                      <div className="flex justify-between text-3xs text-slate-600 mt-1">
                        <span>−12</span><span>0</span><span>+12</span>
                      </div>
                    </div>

                    {/* Toggles */}
                    <div>
                      <p className="nx-section-header mb-3">Filters</p>
                      <div className="flex flex-col gap-3">
                        {[
                          { key: 'whisperFilterEnabled', label: 'Whisper Filter', desc: 'Amplify sub-ambient inputs' },
                          { key: 'muteWithTranscription', label: 'Mute + Transcribe', desc: 'Capture text while silent' },
                        ].map(item => (
                          <label key={item.key} className="flex items-start gap-3 cursor-pointer group">
                            <label className="nx-toggle mt-0.5">
                              <input type="checkbox"
                                checked={(audioConfig as any)[item.key]}
                                onChange={e => setAudioConfig(p => ({ ...p, [item.key]: e.target.checked }))} />
                              <span className="nx-toggle-track" />
                              <span className="nx-toggle-thumb" />
                            </label>
                            <div>
                              <span className="text-2xs font-semibold text-slate-200 block">{item.label}</span>
                              <span className="text-3xs text-slate-500 block mt-0.5">{item.desc}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Hardware & Output Routing Selector */}
                    <div>
                      <p className="nx-section-header mb-3">Hardware & Output Routing</p>
                      <div className="flex flex-col gap-3.5 p-3.5 rounded-2xl bg-slate-950/40 border border-white/5 space-y-1">
                        <div className="flex flex-col gap-1 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Mic className="w-3 h-3 text-indigo-400" /> Microphone
                          </label>
                          <select 
                            value={selectedAudioInput}
                            onChange={e => {
                              setSelectedAudioInput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_mic', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {audioInputs.length === 0 ? (
                              <option value="default">Default Microphone</option>
                            ) : (
                              audioInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>

                        {callType === 'video' && (
                          <div className="flex flex-col gap-1 text-left">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Video className="w-3 h-3 text-indigo-400" /> Camera
                            </label>
                            <select 
                              value={selectedVideoInput}
                              onChange={e => {
                                setSelectedVideoInput(e.target.value);
                                sessionStorage.setItem('nexalink_selected_cam', e.target.value);
                              }}
                              className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                            >
                              {videoInputs.length === 0 ? (
                                <option value="default">Default Camera</option>
                              ) : (
                                videoInputs.map(d => (
                                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.slice(0, 5)})`}</option>
                                ))
                              )}
                            </select>
                          </div>
                        )}

                        <div className="flex flex-col gap-1 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Headphones className="w-3 h-3 text-indigo-400" /> Audio Output
                          </label>
                          <select 
                            value={selectedAudioOutput}
                            onChange={e => {
                              setSelectedAudioOutput(e.target.value);
                              sessionStorage.setItem('nexalink_selected_speaker', e.target.value);
                            }}
                            className="nx-input text-2xs py-1.5 bg-slate-950 border-white/10"
                          >
                            {audioOutputs.length === 0 ? (
                              <option value="default">Default Speakers</option>
                            ) : (
                              audioOutputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.slice(0, 5)})`}</option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* TTS */}
                    <div>
                      <p className="nx-section-header mb-3">Synthetic Voice (TTS)</p>
                      <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}
                        className="nx-input text-2xs mb-2" style={{ padding: '8px 12px' }}>
                        <option>XTTS-v2 Host Male</option>
                        <option>XTTS-v2 Host Female</option>
                        <option>Voice Clone 01</option>
                      </select>
                      <textarea value={ttsText} onChange={e => setTtsText(e.target.value)}
                        placeholder="Type synthetic message…"
                        className="nx-input text-2xs mb-2" rows={3}
                        style={{ resize: 'none', fontFamily: 'var(--font-sans)' }}
                        onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') queueTTS(); }} />
                      <button onClick={queueTTS} disabled={!ttsText.trim()}
                        className="nx-btn nx-btn-primary w-full text-2xs" style={{ padding: '9px' }}>
                        <Play className="w-3.5 h-3.5" /> Send Synthetic Transmission
                      </button>
                      {ttsQueue.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5 max-h-24 overflow-y-auto">
                          {ttsQueue.map((t, i) => (
                            <div key={i} className="px-3 py-2 rounded-lg text-3xs font-mono text-slate-400 flex items-center justify-between"
                              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <span className="truncate">{t}</span>
                              <button onClick={() => setTtsQueue(q => q.filter((_, j) => j !== i))}
                                className="ml-2 text-slate-600 hover:text-slate-400 flex-shrink-0"><X className="w-2.5 h-2.5" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── CHAT PANEL ── */}
                {activeTab === 'chat' && (
                  <div className="flex flex-col h-[calc(100vh-220px)] gap-3">
                    <div className="flex-1 overflow-y-auto pb-2 pr-1 space-y-2.5">
                      {chatMessages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                          <MessageSquare className="w-8 h-8 text-slate-700" />
                          <p className="text-2xs text-slate-600">No messages yet.<br />Be the first to break the silence.</p>
                        </div>
                      ) : (
                        chatMessages.map(m => (
                          <div key={m.id} className={`chat-bubble ${m.self ? 'self' : 'remote'}`}>
                            <span className="sender">{m.self ? 'You' : m.sender}</span>
                            <div className="bubble">{m.text}</div>
                            <span className="time">{m.time}</span>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="flex gap-2 mt-auto pt-2 border-t border-white/5">
                      <input className="nx-input flex-1 text-xs" value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (chatSettings.pressEnterToSend && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                        placeholder="Message…" />
                      <button onClick={sendChat} disabled={!chatInput.trim()}
                        className="nx-btn-icon active" style={{ padding: '10px 12px' }}>
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── WHITEBOARD PANEL ── */}
                {activeTab === 'whiteboard' && (
                  <Whiteboard socket={socket} roomName={roomName} />
                )}

                {/* ── PARTICIPANTS PANEL ── */}
                {activeTab === 'participants' && (
                  <div className="flex flex-col gap-4">
                    <p className="nx-section-header">
                      {participants.length + 1} in Room
                    </p>
 
                    {/* Self */}
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                      style={{ background: 'var(--nx-teal-soft)', border: '1px solid var(--nx-line-strong)' }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                        style={{ background: 'var(--nx-coral)' }}>
                        {myAlias.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{myAlias.name}</p>
                        <p className="text-3xs text-slate-500">You · Host</p>
                      </div>
                      <span className="status-dot live" />
                    </div>
 
                    {/* Others list wrapped in scroll container */}
                    <div className="max-h-80 overflow-y-auto pr-1 flex flex-col gap-2.5">
                      {participants.length === 0 ? (
                        <p className="text-2xs text-slate-600 text-center py-6">No peers connected yet.</p>
                      ) : (
                        participants.map(p => (
                          <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition hover:bg-white/2"
                            style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base"
                              style={{ background: 'rgba(255,255,255,0.05)' }}>
                              {p.avatar}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{p.name}</p>
                              <p className="text-3xs text-slate-500">{p.controlPermissionLevel}</p>
                            </div>
                            {p.isSharingScreen && (
                              <button onClick={() => setRequestControlTarget({ id: p.id, name: p.name })}
                                className="nx-btn-icon nx-tooltip" data-tip="Request Control"
                                style={{ padding: 7 }}>
                                <Zap className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'contacts' && (
                  <div className="flex flex-col gap-4">
                    <p className="nx-section-header"><BookUser className="w-3 h-3" /> Contacts</p>
                    <div className="flex gap-2">
                      <input className="nx-input flex-1 text-xs" value={newContact}
                        onChange={e => setNewContact(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addContact(); }}
                        placeholder="username" />
                      <button onClick={addContact} className="nx-btn-icon active">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
 
                    {/* Contacts list wrapped in scroll container */}
                    <div className="max-h-80 overflow-y-auto pr-1 flex flex-col gap-2.5">
                      {contacts.length === 0 ? (
                        <p className="text-2xs text-slate-600 text-center py-6">No contacts yet.</p>
                      ) : (
                        contacts.map(contact => (
                          <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                            style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.025)' }}>
                            {contact.profilePic ? (
                              <img src={contact.profilePic} alt={contact.username}
                                className="w-9 h-9 rounded-xl object-cover" />
                            ) : (
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                                style={{ background: 'var(--nx-teal-soft)' }}>
                                <User className="w-4 h-4 text-[var(--nx-primary)]" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{contact.username}</p>
                              <p className="text-3xs text-slate-500">Saved contact</p>
                            </div>
                            <button onClick={() => callContact(contact.username)}
                              className="nx-btn-icon nx-tooltip" data-tip="Direct Call" style={{ padding: 7 }}>
                              <PhoneCall className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setContacts(prev => prev.filter(c => c.id !== contact.id))}
                              className="nx-btn-icon nx-tooltip" data-tip="Remove" style={{ padding: 7 }}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'profile' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-1 border-b border-white/5 mb-1">
                      <p className="nx-section-header flex items-center gap-1.5 m-0"><Sliders className="w-3.5 h-3.5 text-[var(--nx-primary)]" /> System Config</p>
                    </div>
                    <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                      {renderSettingsArea()}
                    </div>
                  </div>
                )}

                {/* ── CONTROL LOG PANEL ── */}
                {activeTab === 'control' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <p className="nx-section-header">Tunnel Logs</p>
                      <span className="nx-badge nx-badge-indigo">{controlLogs.length}</span>
                    </div>

                    <div className="flex flex-col gap-1 overflow-y-auto"
                      style={{ maxHeight: 260, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: '10px 8px' }}>
                      {controlLogs.length === 0 ? (
                        <p className="text-3xs text-slate-700 p-2 font-mono">No tunnel events.</p>
                      ) : (
                        controlLogs.map((log, i) => (
                          <div key={i} className={`control-log-entry ${log.includes('EMERGENCY') ? 'emergency' : log.includes('Chaperone') ? 'chaperone' : 'default'}`}>
                            {log}
                          </div>
                        ))
                      )}
                    </div>

                    {controlledBy && (
                      <button onClick={triggerEmergencyKill}
                        className="nx-btn nx-btn-danger w-full text-xs">
                        <ShieldAlert className="w-4 h-4" /> Emergency Kill-Switch
                      </button>
                    )}

                    {/* Consent recorder */}
                    <div>
                      <p className="nx-section-header mb-3">Recording Consent</p>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const token = sessionStorage.getItem('nexalink_token') || '';
                            await fetch(`${API}/api/recordings/consent`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ room_name: roomName, participant_id: userName, consent_granted: true }),
                            });
                            showToast('Consent granted & recorded', 'success');
                          }}
                          className="nx-btn nx-btn-ghost flex-1 text-2xs py-2">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" /> Grant
                        </button>
                        <button
                          onClick={async () => {
                            const token = sessionStorage.getItem('nexalink_token') || '';
                            await fetch(`${API}/api/recordings/consent`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ room_name: roomName, participant_id: userName, consent_granted: false }),
                            });
                            showToast('Consent denied & recorded', 'info');
                          }}
                          className="nx-btn nx-btn-ghost flex-1 text-2xs py-2">
                          <X className="w-3 h-3 text-rose-400" /> Deny
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar footer */}
              <div className="px-4 py-3 border-t flex items-center justify-between"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span className="text-3xs font-mono text-slate-600">Secure Tunnel</span>
                <span className="text-3xs font-mono text-slate-600">{new Date().toISOString().slice(0, 10)}</span>
              </div>
            </aside>
          </div>
        )
      }
    </main>

      {/* ── FOOTER CONTROL BAR (in-call only) ─── */}
      {inRoom && (
        <footer className="relative z-10 nx-control-bar global-control-bar">

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`status-dot ${isConnected ? 'live' : 'error'}`} />
            <span className="text-2xs font-mono text-slate-400">
              {isConnected ? 'Relay Active' : 'Disconnected'}
            </span>
            <span className="text-3xs font-mono text-slate-600 hidden sm:inline">· {roomName}</span>
          </div>

          {/* Centre controls */}
          <div className="nx-control-group">

            <button onClick={toggleAudio}
              className={`nx-btn-icon nx-tooltip ${!audioEnabled ? 'active-danger' : ''}`}
              data-tip={audioEnabled ? 'Mute Mic' : 'Unmute Mic'}>
              {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            <button onClick={toggleVideo}
              className={`nx-btn-icon nx-tooltip ${!videoEnabled ? 'active-danger' : ''}`}
              data-tip={videoEnabled ? 'Stop Camera' : 'Start Camera'}>
              {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            <button onClick={toggleScreenShare}
              className={`nx-btn-icon nx-tooltip ${screenStream ? 'active' : ''}`}
              data-tip={screenStream ? 'Stop Sharing' : 'Share Screen'}>
              {screenStream ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>

            <div className="divider" />

            <button onClick={toggleAlias}
              className={`nx-btn-icon nx-tooltip ${isAliasEnabled ? 'active' : ''}`}
              data-tip={isAliasEnabled ? 'Disable Alias' : 'Enable Alias'}>
              {isAliasEnabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            <button onClick={() => setActiveTab('audio')}
              className={`nx-btn-icon nx-tooltip ${activeTab === 'audio' ? 'active' : ''}`}
              data-tip="Voice Settings">
              <Sliders className="w-4 h-4" />
            </button>

            <button onClick={() => { setActiveTab('chat'); }}
              className={`nx-btn-icon nx-tooltip relative ${activeTab === 'chat' ? 'active' : ''}`}
              data-tip="Chat">
              <MessageSquare className="w-4 h-4" />
              {unreadChat > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold shadow px-0.5" style={{ minWidth: '16px', height: '16px' }}>
                  {unreadChat > 9 ? '9+' : unreadChat}
                </span>
              )}
            </button>

            <button onClick={() => setActiveTab('participants')}
              className={`nx-btn-icon nx-tooltip ${activeTab === 'participants' ? 'active' : ''}`}
              data-tip={`${participants.length + 1} Participants`}>
              <Users className="w-4 h-4" />
            </button>

          </div>

          {/* Disconnect */}
          <button onClick={handleDisconnectRoom}
            className="nx-btn nx-btn-danger text-xs">
            <PhoneOff className="w-4 h-4" />
            Leave Room
          </button>
        </footer>
      )}
    </div>
  );
}
