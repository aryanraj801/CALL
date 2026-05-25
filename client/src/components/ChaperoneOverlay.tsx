import { useState, useEffect, useRef } from 'react';
import { Check, X, ShieldAlert as ShieldIcon, MousePointer, Keyboard, Eye, Sliders, Shield } from 'lucide-react';

interface ChaperoneOverlayProps {
  requesterName: string;
  requesterId: string;
  accessType: 'mouse' | 'keyboard' | 'both';
  onRespond: (requesterId: string, approved: boolean, level: 'none' | 'view' | 'interact' | 'full') => void;
}

export default function ChaperoneOverlay({ requesterName, requesterId, accessType, onRespond }: ChaperoneOverlayProps) {
  const [timeLeft, setTimeLeft] = useState(10); // 10 seconds timeout auto-deny
  const [permissionLevel, setPermissionLevel] = useState<'view' | 'interact' | 'full'>(
    accessType === 'both' ? 'full' : 'interact'
  );
  const [allowClicks, setAllowClicks] = useState(accessType === 'mouse' || accessType === 'both');
  const [allowKeystrokes, setAllowKeystrokes] = useState(accessType === 'keyboard' || accessType === 'both');

  useEffect(() => {
    setAllowClicks(accessType === 'mouse' || accessType === 'both');
    setAllowKeystrokes(accessType === 'keyboard' || accessType === 'both');
    setPermissionLevel(accessType === 'both' ? 'full' : 'interact');
  }, [accessType]);

  // BUG FIX #12: Storing onRespond in a ref means the countdown effect only
  // depends on [timeLeft, requesterId] — a new onRespond reference from a
  // parent re-render no longer resets the countdown to 10 seconds mid-flight.
  const onRespondRef = useRef(onRespond);
  useEffect(() => {
    onRespondRef.current = onRespond;
  }, [onRespond]);

  // Timer loop for auto-denial
  useEffect(() => {
    if (timeLeft <= 0) {
      onRespondRef.current(requesterId, false, 'none');
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
    // Only depend on timeLeft and requesterId — NOT on onRespond directly
  }, [timeLeft, requesterId]);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-all duration-300">
      
      {/* Premium Outer Card with Glow Container */}
      <div className="w-full max-w-md glass-bright rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-300 border-indigo-500/20">
        
        {/* Futuristic glowing shapes */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        
        {/* Decorative scanning line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50 animate-pulse" />

        {/* Header Area */}
        <div className="flex items-start space-x-4 relative z-10">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl text-indigo-400 shadow-lg shadow-indigo-500/5 animate-pulse">
            <ShieldIcon className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                Security clearance
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
            </div>
            <h3 className="text-xl font-bold text-white tracking-wide font-display">
              Chaperone Access Query
            </h3>
            <p className="text-2xs text-slate-400 leading-relaxed">
              Participant <span className="text-indigo-300 font-semibold">{requesterName}</span> demands remote{' '}
              <span className="text-indigo-200 font-semibold">
                {accessType === 'mouse' ? 'Mouse Click Only' : accessType === 'keyboard' ? 'Keyboard Input Only' : 'Mouse & Keyboard'}
              </span>{' '}
              control over your session.
            </p>
          </div>
        </div>

        {/* Auto-Deny Countdown progress indicator */}
        <div className="space-y-2 mt-6 relative z-10 bg-slate-950/40 border border-white/5 p-3 rounded-2xl">
          <div className="flex justify-between items-center text-[10px] font-mono">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span className="status-dot warning" /> Auto-Deny Active
            </span>
            <span className="text-rose-400 font-bold tracking-wider">{timeLeft}s remaining</span>
          </div>
          <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden p-[1px]">
            <div 
              className="h-full bg-gradient-to-r from-rose-500 to-indigo-500 rounded-full transition-all duration-1000 ease-linear shadow-lg shadow-rose-500/50" 
              style={{ width: `${(timeLeft / 10) * 100}%` }} 
            />
          </div>
        </div>

        {/* Configurations Pane */}
        <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-4 mt-4 space-y-4 relative z-10">
          
          {/* Permissions selection header */}
          <div className="flex flex-col space-y-2">
            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" /> Control Privilege Level
            </label>
            
            <div className="grid grid-cols-3 gap-2">
              <button 
                type="button"
                onClick={() => setPermissionLevel('view')}
                className={`py-2 px-1 rounded-xl border text-[11px] font-semibold transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                  permissionLevel === 'view' 
                    ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300 shadow-md shadow-indigo-500/5' 
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Only</span>
              </button>
              
              <button 
                type="button"
                onClick={() => setPermissionLevel('interact')}
                className={`py-2 px-1 rounded-xl border text-[11px] font-semibold transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                  permissionLevel === 'interact' 
                    ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-500/10' 
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Interact</span>
              </button>
              
              <button 
                type="button"
                onClick={() => setPermissionLevel('full')}
                className={`py-2 px-1 rounded-xl border text-[11px] font-semibold transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                  permissionLevel === 'full' 
                    ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-md shadow-rose-500/10' 
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-rose-400 hover:bg-slate-900/80'
                }`}
              >
                <ShieldIcon className="w-3.5 h-3.5" />
                <span>Full Control</span>
              </button>
            </div>
          </div>

          {/* Granular Permission Swtiches */}
          <div className="space-y-3 pt-3 border-t border-white/5">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 bg-slate-900 rounded-lg text-slate-400">
                  <MousePointer className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-2xs font-semibold text-slate-200">Mouse Clicks</span>
                  <span className="text-[9px] text-slate-500">Inject primary click interactions</span>
                </div>
              </div>
              <label className="nx-toggle">
                <input 
                  type="checkbox" 
                  checked={allowClicks} 
                  onChange={(e) => setAllowClicks(e.target.checked)} 
                />
                <span className="nx-toggle-track" />
                <span className="nx-toggle-thumb" />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 bg-slate-900 rounded-lg text-slate-400">
                  <Keyboard className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-2xs font-semibold text-slate-200">Keyboard Input</span>
                  <span className="text-[9px] text-slate-500">Inject system-wide keystrokes</span>
                </div>
              </div>
              <label className="nx-toggle">
                <input 
                  type="checkbox" 
                  checked={allowKeystrokes} 
                  onChange={(e) => setAllowKeystrokes(e.target.checked)} 
                />
                <span className="nx-toggle-track" />
                <span className="nx-toggle-thumb" />
              </label>
            </div>

          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-3 text-xs font-bold pt-4 mt-2 relative z-10">
          <button 
            type="button"
            onClick={() => onRespond(requesterId, false, 'none')}
            className="flex-1 py-3 bg-slate-950 hover:bg-slate-900 border border-white/5 hover:border-white/10 text-slate-300 rounded-xl transition-all duration-200 flex items-center justify-center space-x-2"
          >
            <X className="w-4 h-4 text-rose-500" />
            <span>Refuse Tunnel</span>
          </button>
          
          <button 
            type="button"
            onClick={() => onRespond(requesterId, true, permissionLevel)}
            className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/35 transition-all duration-200 flex items-center justify-center space-x-2 border-t border-white/10"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Authorize Control</span>
          </button>
        </div>

      </div>
    </div>
  );
}
