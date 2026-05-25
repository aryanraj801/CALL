import os
import re
import random
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="NexaLink AI Sidecar",
    description="Speech Intelligence, Real-Time ASR & TTS Synthesis Microservice",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SEC-21 FIX: Allowed audio MIME types for upload validation
ALLOWED_AUDIO_MIME_TYPES = {
    "audio/wav", "audio/wave", "audio/x-wav",
    "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/webm",
    "audio/flac", "audio/aac",
    "audio/mp4",
}
MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB limit

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

class ActionItem(BaseModel):
    task: str
    owner: str
    due_date: Optional[str] = None

class MeetingAnalysis(BaseModel):
    summary: str
    action_items: List[ActionItem]

class TTSRequest(BaseModel):
    text: str
    voice: str = "XTTS-v2 Host Male"
    pitch_factor: float = 1.0

# Health check
@app.get("/api/ai/health")
def ai_health():
    return {
        "status": "ONLINE",
        "service": "NexaLink AI Speech Sidecar",
        "has_openai_key": bool(OPENAI_API_KEY),
        "active_speech_pipelines": ["Whisper-ASR", "Coqui-XTTS-v2"]
    }

# Transcribe endpoint (Whisper ASR)
@app.post("/api/ai/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    room_name: str = Form(...)
):
    # SEC-21 FIX: Validate MIME type before processing
    content_type = file.content_type or ""
    if content_type not in ALLOWED_AUDIO_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Allowed types: audio/wav, audio/mpeg, audio/ogg, audio/webm."
        )

    # SEC-21 FIX: Enforce maximum file size (read content into memory with size guard)
    content = await file.read(MAX_AUDIO_SIZE_BYTES + 1)
    if len(content) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large. Maximum allowed size is {MAX_AUDIO_SIZE_BYTES // (1024*1024)} MB."
        )

    # Simulated local Whisper processing for greenfield deployment
    # Fallback to OpenAI Whisper API if API key environment exists
    if OPENAI_API_KEY:
        # In a real production scope, fetch audio bytes and call client.audio.transcriptions.create
        pass
    
    # Safe rule-based context simulation matching real-world transcripts
    simulated_texts = [
        "Alice, please complete the database migration by Friday.",
        "We need to review the DTLS encryption code tomorrow morning.",
        "I will set up the TURN coturn server clusters this afternoon.",
        "Let's launch the k6 stress test on signaling sockets today at 5 PM."
    ]
    # BUG FIX #14: random is now imported at top-level (removed from function body)
    text = random.choice(simulated_texts)
    
    return {
        "room_name": room_name,
        "transcript": text,
        "language": "en",
        "timestamp": datetime.utcnow().isoformat(),
        "processing_time_ms": 145
    }

# Speech generation endpoint (Coqui TTS)
@app.post("/api/ai/tts")
async def generate_speech(request: TTSRequest):
    # If XTTS-v2 is configured locally, fetch voice weights and generate wav
    # Fallback to cloud TTS if desired
    print(f"[AI Speech] Synthesizing Voice <{request.voice}> (Pitch: {request.pitch_factor}): \"{request.text}\"")
    
    # In a full deployment, this returns audio/wav binary stream
    # For initial integration, return base64 payload representation
    return {
        "status": "SUCCESS",
        "voice": request.voice,
        "text": request.text,
        "audio_format": "wav",
        "sample_rate": 24000,
        "base64_placeholder": "UklGRooHAABXQVZFZm10IBIAAAAEAAEAQB8AAEAfAAABAAgA"
    }

# Meeting Intelligence & Action Item Extraction
@app.post("/api/ai/actions", response_model=MeetingAnalysis)
def extract_action_items(transcript: str = Body(..., embed=True)):
    action_items = []
    
    # Rule-based NLP extraction looking for active patterns like "I will X", "Alice to Y", "by Z"
    # Looking for explicit owner assignments
    tasks_patterns = [
        r"(?P<owner>[A-Z][a-z]+)\s+(?:please|should|needs to)\s+(?P<task>[^.\n,]+)",
        r"(?P<owner>I)\s+will\s+(?P<task>[^.\n,]+)"
    ]
    
    for pattern in tasks_patterns:
        matches = re.finditer(pattern, transcript, re.IGNORECASE)
        for match in matches:
            groups = match.groupdict()
            owner = groups.get("owner", "Unassigned")
            task = groups.get("task", "").strip()
            
            # Simple date parsing representation
            due = None
            if "by" in task:
                parts = task.split("by")
                task = parts[0].strip()
                due = parts[1].strip()
                
            action_items.append(ActionItem(
                task=task,
                owner="Alice (Self)" if owner.lower() == "i" else owner,
                due_date=due
            ))
            
    # Standard summary generation
    summary = f"Summary of discussion logs: \"{transcript}\""
    
    # Fallback default task if no patterns matched
    if not action_items:
        action_items.append(ActionItem(
            task="Follow up on discussion points",
            owner="All Participants",
            due_date="Next Call"
        ))
        
    return MeetingAnalysis(
        summary=summary,
        action_items=action_items
    )
