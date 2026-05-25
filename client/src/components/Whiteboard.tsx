import React, { useRef, useState, useEffect } from 'react';
import { 
  Trash2, RotateCcw, RotateCw, Download, PenTool, Eraser, 
  FolderOpen, UploadCloud, Palette, Sliders, CloudLightning,
  Sparkles, Check, AlertCircle, RefreshCw, Type
} from 'lucide-react';
import { Socket } from 'socket.io-client';

interface WhiteboardProps {
  socket: Socket | null;
  roomName: string;
}

interface Stroke {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  color: string;
  size: number;
  isEraser: boolean;
}

export default function Whiteboard({ socket, roomName }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#6366f1');
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'text'>('pen');
  const [annotationText, setAnnotationText] = useState('Annotation');
  const [fontSize, setFontSize] = useState(16);
  
  // History Stacks for Local Undo/Redo
  const [history, setHistory] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const lastPos = useRef({ x: 0, y: 0 });

  // Cloud Whiteboard Storage States
  const [cloudSnapshots, setCloudSnapshots] = useState<{ id: string; url: string; saved_by: string; created_at: string }[]>([]);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [showSnapshotsList, setShowSnapshotsList] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // SEC-15 FIX: Load API base URL from env variables instead of hardcoding localhost
  const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8001';

  // SEC-08 FIX: Validate that a URL belongs to our trusted Supabase storage domain
  // before loading it into the canvas. Prevents SSRF and malicious image injection
  // from compromised peers emitting remote_load events with arbitrary URLs.
  const isAllowedSnapshotUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'uejwhikwtjikrsbnaabo.supabase.co' ||
         parsed.hostname.endsWith('.supabase.co'))
      );
    } catch {
      return false; // invalid URL format
    }
  };

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch past whiteboard snapshots from Supabase DB via our backend API
  const fetchCloudSnapshots = async () => {
    setIsLoadingCloud(true);
    try {
      const token = sessionStorage.getItem('nexalink_token');
      const res = await fetch(`${API_BASE}/api/whiteboard/list/${roomName}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setCloudSnapshots(data);
      }
    } catch (e) {
      console.error("Failed to fetch cloud snapshots:", e);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    fetchCloudSnapshots();
  }, [roomName]);

  // Load a whiteboard snapshot from a URL
  const loadWhiteboardFromUrl = (url: string, broadcast = true) => {
    // SEC-08 FIX: Validate URL before loading into canvas to prevent SSRF
    // and arbitrary content injection from malicious peers via remote_load events.
    if (!isAllowedSnapshotUrl(url)) {
      console.error('[Security] Blocked whiteboard load from untrusted URL:', url);
      showToast("Security: Blocked untrusted URL injection", "error");
      return;
    }

    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    saveState();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      showToast("Snapshot loaded into viewport", "success");
    };
    img.onerror = () => {
      console.error('[Whiteboard] Failed to load image from URL:', url);
      showToast("Failed to load snapshot from cloud", "error");
    };

    if (broadcast && socket) {
      socket.emit('load_whiteboard', { roomName, url });
    }
  };

  // Upload canvas PNG to Supabase Storage
  const cloudSaveBoard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSavingCloud(true);
    try {
      // 1. Get Blob from Canvas
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Failed to get image blob from canvas");

      // 2. Generate unique filename
      const filename = `drawing-${roomName}-${Date.now()}.png`;

      // 3. Upload to Supabase Storage using client-side library
      const { supabase } = await import('../lib/supabaseClient.ts');
      const { error } = await supabase.storage
        .from('nexalink-drawings')
        .upload(filename, blob, { contentType: 'image/png', upsert: true });

      if (error) throw error;

      // 4. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('nexalink-drawings')
        .getPublicUrl(filename);

      // 5. Save metadata in backend API (SEC-09: token sent so server uses JWT identity)
      const token = sessionStorage.getItem('nexalink_token');
      const saveRes = await fetch(`${API_BASE}/api/whiteboard/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          room_name: roomName,
          url: publicUrl,
          username: sessionStorage.getItem('nexalink_username') || 'anonymous'
        })
      });

      if (!saveRes.ok) throw new Error("Failed to save snapshot metadata");

      showToast("Whiteboard snapshot saved to Supabase!", "success");
      fetchCloudSnapshots();
    } catch (e: any) {
      console.error(e);
      showToast(`Cloud Save failed: ${e.message || e}`, "error");
    } finally {
      setIsSavingCloud(false);
    }
  };

  const getCanvasContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  };

  // Push current canvas state to history stack
  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataURL = canvas.toDataURL();
    setHistory(prev => [...prev, dataURL]);
    setRedoStack([]); // Clear redo stack on new action
  };

  const handleStartDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    saveState();
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    if (tool === 'text') {
      const textToDraw = annotationText.trim();
      if (!textToDraw) {
        showToast("Type text in the annotation input field first", "error");
        return;
      }
      const ctx = getCanvasContext();
      if (ctx) {
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(textToDraw, x, y);
        
        // Sync text drawing with peers over custom text_event
        if (socket) {
          socket.emit('text_event', {
            roomName,
            textData: {
              x,
              y,
              text: textToDraw,
              color,
              fontSize
            }
          });
        }
        showToast("Text annotation placed", "success");
      }
      return;
    }
    
    lastPos.current = { x, y };
    setIsDrawing(true);
  };

  const handleDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool === 'text') return;
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(x, y);
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; // Reset
    } else {
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // Emit drawing events to peers over Socket.IO signaling plane
    if (socket) {
      const strokeData: Stroke = {
        x,
        y,
        lastX: lastPos.current.x,
        lastY: lastPos.current.y,
        color: color,
        size: brushSize,
        isEraser: tool === 'eraser'
      };
      socket.emit('draw_event', { roomName, strokeData });
    }

    lastPos.current = { x, y };
  };

  const handleStopDraw = () => {
    setIsDrawing(false);
  };

  // Undo action
  const triggerUndo = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || history.length === 0) return;

    const currentData = canvas.toDataURL();
    setRedoStack(prev => [...prev, currentData]);

    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));

    const img = new Image();
    img.src = previousState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  // Redo action
  const triggerRedo = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx || redoStack.length === 0) return;

    const currentData = canvas.toDataURL();
    setHistory(prev => [...prev, currentData]);

    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    const img = new Image();
    img.src = nextState;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  const clearBoard = () => {
    saveState();
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (socket) {
      socket.emit('clear_whiteboard', { roomName });
    }
    showToast("Whiteboard canvas cleared", "success");
  };

  // Export board as PNG
  const exportBoard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `nexalink-whiteboard-${roomName}.png`;
    link.href = canvas.toDataURL();
    link.click();
    showToast("Whiteboard exported as PNG", "success");
  };

  // Setup Remote drawing listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('remote_draw', (stroke: Stroke) => {
      const ctx = getCanvasContext();
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(stroke.lastX, stroke.lastY);
      ctx.lineTo(stroke.x, stroke.y);
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      
      if (stroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = stroke.color;
        ctx.stroke();
      }
    });

    socket.on('remote_clear', () => {
      const canvas = canvasRef.current;
      const ctx = getCanvasContext();
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    socket.on('remote_load', ({ url }: { url: string }) => {
      loadWhiteboardFromUrl(url, false);
    });

    socket.on('remote_text', (textData: { x: number; y: number; text: string; color: string; fontSize: number }) => {
      const ctx = getCanvasContext();
      if (!ctx) return;
      ctx.font = `${textData.fontSize}px sans-serif`;
      ctx.fillStyle = textData.color;
      ctx.fillText(textData.text, textData.x, textData.y);
    });

    return () => {
      socket.off('remote_draw');
      socket.off('remote_clear');
      socket.off('remote_load');
      socket.off('remote_text');
    };
  }, [socket]);

  return (
    <div className="space-y-4 relative">
      
      {/* Toast Alert Indicator */}
      {toastMessage && (
        <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-[100] px-3.5 py-2 rounded-xl border text-2xs font-semibold backdrop-blur-xl flex items-center gap-2 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-200 ${
          toastMessage.type === 'success' 
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' 
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        }`}>
          {toastMessage.type === 'success' ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Modern High-Fidelity Tool Board */}
      <div className="flex flex-wrap items-center justify-between bg-slate-950/60 p-3 rounded-2xl border border-white/5 gap-3 shadow-xl backdrop-blur-md">
        
        {/* Draw Tools Selection */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900/60 p-1 rounded-xl border border-white/5">
            <button 
              type="button"
              onClick={() => setTool('pen')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'pen' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Interactive Pen Tool"
            >
              <PenTool className="w-4 h-4" />
            </button>
            
            <button 
              type="button"
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'eraser' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Eraser Tool"
            >
              <Eraser className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => setTool('text')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                tool === 'text' 
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Text Annotation Tool"
            >
              <Type className="w-4 h-4" />
            </button>
          </div>

          <div className="h-6 w-px bg-white/10" />

          {/* Color Palette selectors */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/40 px-2 py-1.5 rounded-xl border border-white/5">
            <Palette className="w-3.5 h-3.5 text-slate-500 mr-1" />
            {['#6366f1', '#f43f5e', '#10b981', '#ffffff', '#eab308'].map(c => (
              <button 
                type="button"
                key={c}
                onClick={() => { setColor(c); }}
                className="w-4 h-4 rounded-full border transition-all duration-200 hover:scale-125 focus:outline-none flex items-center justify-center relative group" 
                style={{ backgroundColor: c, borderColor: 'rgba(255,255,255,0.15)' }} 
              >
                {color === c && (tool === 'pen' || tool === 'text') && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-950 absolute" />
                )}
                {/* Tooltip */}
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-1.5 py-0.5 rounded text-[8px] bg-slate-950 border border-white/10 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {c}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        {/* Global canvas actions */}
        <div className="flex flex-wrap items-center gap-1">
          
          <div className="flex gap-0.5 bg-slate-900/60 p-1 rounded-xl border border-white/5">
            <button 
              type="button"
              onClick={triggerUndo} 
              disabled={history.length === 0}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-white/5 transition-colors"
              title="Undo Action"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            
            <button 
              type="button"
              onClick={triggerRedo} 
              disabled={redoStack.length === 0}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-white/5 transition-colors"
              title="Redo Action"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex gap-1 pl-1">
            <button 
              type="button"
              onClick={exportBoard}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5 transition-all duration-200"
              title="Export Canvas to PNG"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Cloud Storage Operations */}
            <button 
              type="button"
              onClick={cloudSaveBoard}
              disabled={isSavingCloud}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                isSavingCloud 
                  ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/5 animate-pulse' 
                  : 'border-indigo-500/10 text-indigo-400 hover:text-indigo-200 hover:bg-indigo-500/10 hover:border-indigo-500/35'
              }`}
              title="Save snapshot to Supabase Cloud"
            >
              <UploadCloud className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={() => { fetchCloudSnapshots(); setShowSnapshotsList(prev => !prev); }}
              className={`p-2 rounded-xl border transition-all duration-200 ${
                showSnapshotsList 
                  ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-500/15' 
                  : 'border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Load saved snapshots"
            >
              <FolderOpen className="w-4 h-4" />
            </button>

            <button 
              type="button"
              onClick={clearBoard}
              className="p-2 rounded-xl border border-rose-500/10 text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all duration-200"
              title="Clear Canvas Board"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {/* Cloud Snapshots Shelf with Soft Animation */}
      {showSnapshotsList && (
        <div className="bg-slate-950/90 border border-white/10 p-4 rounded-2xl shadow-2xl space-y-3 relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 z-20 max-h-[220px] overflow-y-auto">
          
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

          <div className="flex justify-between items-center pb-2 border-b border-white/5">
            <div className="flex items-center gap-1.5">
              <CloudLightning className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold font-display">
                Cloud Snapshot Registry
              </span>
            </div>
            <button 
              type="button"
              onClick={fetchCloudSnapshots} 
              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition"
              title="Refresh Snapshots"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingCloud ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoadingCloud ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-2">
              <span className="h-5 w-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
              <span className="text-[10px] text-slate-500 font-mono">Syncing cloud drawings...</span>
            </div>
          ) : cloudSnapshots.length === 0 ? (
            <div className="text-center py-6 text-[10px] text-slate-500 italic bg-white/1 rounded-xl border border-white/5">
              No cloud snapshots archived for this room yet. Click Cloud Save to make one!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {cloudSnapshots.map(s => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => { loadWhiteboardFromUrl(s.url); setShowSnapshotsList(false); }}
                  className="flex items-center space-x-3 p-2 rounded-xl border border-white/5 bg-slate-900/40 hover:bg-indigo-600/5 hover:border-indigo-500/30 text-left transition-all duration-200 group"
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-950 border border-white/10 flex-shrink-0">
                    <img 
                      src={s.url} 
                      alt="drawing snapshot" 
                      className="w-full h-full object-cover transition duration-300 group-hover:scale-110" 
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-indigo-950/20 group-hover:bg-transparent transition duration-200" />
                  </div>
                  
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-[9px] text-slate-200 font-bold truncate flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-indigo-400 group-hover:animate-bounce" />
                      <span>By {s.saved_by}</span>
                    </div>
                    <div className="text-[8px] text-slate-500 truncate font-mono">
                      {new Date(s.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Text Tool Settings Drawer */}
      {tool === 'text' && (
        <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Annotation Text:</span>
          <input 
            type="text" 
            value={annotationText} 
            onChange={e => setAnnotationText(e.target.value)} 
            placeholder="Type text here, then click on the canvas to place it..."
            className="flex-1 min-w-[200px] bg-slate-900/80 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50" 
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Size:</span>
            <input 
              type="number" 
              value={fontSize} 
              onChange={e => setFontSize(Math.max(8, Math.min(64, parseInt(e.target.value) || 12)))} 
              className="w-14 bg-slate-900/80 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white text-center focus:outline-none" 
            />
            <span className="text-2xs text-slate-500">px</span>
          </div>
        </div>
      )}

      {/* Main Drawing Canvas Board with Cyberpunk Shell Frame */}
      <div className="border border-white/5 rounded-3xl overflow-hidden bg-[#060a18] shadow-2xl relative group">
        
        {/* Glow corner decorations */}
        <div className="absolute -top-12 -right-12 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-indigo-500/10 transition-all duration-300" />
        <div className="absolute -bottom-12 -left-12 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-rose-500/10 transition-all duration-300" />

        {/* Dynamic canvas node */}
        <canvas 
          ref={canvasRef}
          width="500" // Increased internal coordinate resolution for crisper drawings
          height="320"
          onMouseDown={handleStartDraw}
          onMouseMove={handleDraw}
          onMouseUp={handleStopDraw}
          onMouseLeave={handleStopDraw}
          className="block w-full cursor-crosshair relative z-10"
        />

        {/* Subtle coordinate overlay indicator */}
        <div className="absolute bottom-2 right-3 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-[8px] font-mono text-slate-500 uppercase tracking-widest">
          Active Room Plane • {roomName}
        </div>
      </div>
      
      {/* Footer details with Custom Premium Slider */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 bg-slate-950/40 p-3 rounded-2xl border border-white/5 shadow-inner gap-2">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold">Brush weight</span>
          <span className="font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 text-indigo-300">{brushSize}px</span>
        </div>
        
        <div className="flex items-center gap-2 flex-1 min-w-[120px] justify-end">
          <span className="text-[9px] text-slate-600 font-mono">Fine</span>
          <input 
            type="range" 
            min="2" 
            max="16" 
            value={brushSize} 
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            className="flex-1 min-w-[60px] accent-indigo-500"
          />
          <span className="text-[9px] text-slate-600 font-mono">Bold</span>
        </div>
      </div>

    </div>
  );
}
