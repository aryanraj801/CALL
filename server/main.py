import os
import time
import logging
from typing import List, Optional
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()
from fastapi import FastAPI, HTTPException, status, Body, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, EmailStr
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import jwt

# Import REST-based Supabase database API wrapper
from db.supabase_api import (
    signup_supabase_user,
    login_supabase_user,
    create_room_db,
    log_call_join_db,
    log_call_leave_db,
    get_call_history_db,
    submit_recording_consent_db,
    save_meeting_summary_db,
    get_room_summaries_db,
    search_meeting_summaries_db,
    save_whiteboard_snapshot_db,
    get_whiteboard_snapshots_db,
    save_user_profile_db,
    get_user_profile_db,
    send_direct_message_db,
    get_direct_messages_db,
    mark_messages_read_db,
    get_direct_call_logs_db,
    log_direct_call_db,
    update_direct_call_status_db,
    add_contact_db,
    get_contacts_db,
    remove_contact_db,
    get_all_direct_call_logs_db,
    get_unread_messages_db,
    create_file_transfer_db,
    get_pending_file_transfers_db,
    update_file_transfer_status_db,
    edit_direct_message_db,
    delete_direct_message_db,
    delete_direct_call_log_db,
    clear_all_direct_call_logs_db,
    get_notification_logs_db,
)

# --- Configuration ---
ENV = os.getenv("ENV", "development")
IS_PRODUCTION = ENV == "production"

# SEC-03 FIX: Load JWT secret from environment — fail fast if missing
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    raise RuntimeError("[Security] JWT_SECRET_KEY environment variable is not set.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_MINUTES = 60

# Configure structured logging (suppress raw tracebacks from HTTP layer)
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("nexalink")

# --- Rate Limiter (SEC-10) ---
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="NexaLink Core API Gateway",
    description="E2E Encrypted Real-Time Communication Platform API",
    version="1.0.0",
    # SEC-13 FIX: Disable automatic exception detail exposure in production
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# SEC-06 FIX: Restrict CORS to explicit allowed origins from environment variable.
# Wildcard (*) is never acceptable for authenticated APIs.
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


# SEC-12 FIX: Inject security headers on every response
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' https://*.supabase.co wss://localhost:8000; "
            "img-src 'self' https://*.supabase.co data:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "script-src 'self'"
        )
    return response


# --- JWT Auth Helpers (SEC-04) ---

def create_access_token(data: dict) -> str:
    """Create a signed JWT with expiry."""
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=JWT_EXPIRY_MINUTES)
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(request: Request) -> dict:
    """
    SEC-04 FIX: Dependency that validates the Bearer JWT token on every
    protected endpoint. Raises 401 if token is missing, expired, or invalid.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def _safe_error(e: Exception, public_msg: str = "An internal error occurred.") -> HTTPException:
    """
    SEC-13 FIX: Log the real error server-side but return a generic message
    to the client so internal architecture details are never leaked.
    """
    logger.error(f"[Internal Error] {type(e).__name__}: {e}")
    return HTTPException(status_code=500, detail=public_msg)


# --- Pydantic Schemas ---

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    username: str


class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r'^[a-zA-Z0-9_\-]+$')
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserLogin(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)


class RoomCreate(BaseModel):
    room_name: str = Field(..., min_length=1, max_length=100)
    ephemeral_mode: bool = True
    metadata_stripping: bool = True
    data_residency_region: str = Field(default="US", pattern=r'^(US|EU|AP)$')


class CallJoinRequest(BaseModel):
    room_id: str = Field(..., min_length=1, max_length=60)
    room_name: str = Field(..., min_length=1, max_length=100)
    username: str = Field(..., min_length=1, max_length=50)


class CallLeaveRequest(BaseModel):
    room_id: str = Field(..., min_length=1, max_length=60)
    username: str = Field(..., min_length=1, max_length=50)


class RecordingConsentSchema(BaseModel):
    room_name: str = Field(..., max_length=100)
    participant_id: str = Field(..., max_length=100)
    consent_granted: bool


class MeetingSummaryCreate(BaseModel):
    room_name: str = Field(..., max_length=100)
    transcript: str = Field(..., max_length=50_000)
    summary: str = Field(..., max_length=10_000)
    action_items: List[dict]
    transcript_embedding: Optional[List[float]] = None


class SemanticSearchQuery(BaseModel):
    query_embedding: List[float] = Field(..., min_length=1, max_length=384)
    match_threshold: Optional[float] = Field(default=0.3, ge=0.0, le=1.0)
    match_count: Optional[int] = Field(default=5, ge=1, le=50)


class WhiteboardSaveSchema(BaseModel):
    room_name: str = Field(..., max_length=100)
    url: str = Field(..., max_length=2048)
    username: str = Field(..., max_length=50)


class ProfileSaveSchema(BaseModel):
    username: str = Field(..., max_length=50)
    bio: str = Field(default="", max_length=240)
    profile_pic: str = Field(default="", max_length=1200000)
    theme: Optional[str] = Field(default=None)
    chat_settings: Optional[dict] = Field(default=None)
    notif_settings: Optional[dict] = Field(default=None)


class DirectMessageSend(BaseModel):
    recipient: str = Field(..., min_length=1, max_length=50)
    text: str = Field(..., min_length=1, max_length=4000)


class DirectMessageEdit(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class DirectCallLog(BaseModel):
    callee: str = Field(..., min_length=1, max_length=50)
    call_type: str = Field(default="video", pattern=r'^(video|voice)$')
    room_name: str = Field(default="", max_length=120)


class DirectCallUpdate(BaseModel):
    call_id: int
    status: str = Field(..., pattern=r'^(accepted|declined|missed)$')
    ended: bool = False


class FileTransferInitiate(BaseModel):
    recipient: str = Field(..., min_length=1, max_length=50)
    file_name: str = Field(..., min_length=1, max_length=500)
    file_size: int = Field(..., ge=0)
    file_type: str = Field(..., min_length=1, max_length=100)


class FileTransferResponse(BaseModel):
    status: str = Field(..., pattern=r'^(accepted|declined)$')


# --- Public Endpoints (no auth required) ---

# REST Endpoint: Health check
@app.get("/api/health")
def read_health():
    return {
        "status": "ONLINE",
        "service": "NexaLink Core API Gateway",
        "timestamp": datetime.utcnow().isoformat(),
    }


# REST Endpoint: Secure User Registration via Supabase Auth
# SEC-10 FIX: Rate limited to 5 requests per minute per IP
@app.post("/api/auth/register")
@limiter.limit("5/minute")
def register_user(request: Request, user_data: UserRegister):
    try:
        res = signup_supabase_user(user_data.username, user_data.email, user_data.password)
        confirmation_required = not bool(res.get("session") or res.get("access_token"))
        return {
            "status": "SUCCESS",
            "username": user_data.username,
            "message": (
                "Account created. Please confirm your email before signing in."
                if confirmation_required
                else "User registered successfully."
            ),
            "confirmation_required": confirmation_required,
            "id": res.get("id") or res.get("user", {}).get("id")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# REST Endpoint: User Login via Supabase Auth
# SEC-10 FIX: Rate limited to 5 requests per minute per IP (brute force protection)
@app.post("/api/auth/token", response_model=TokenResponse)
@limiter.limit("5/minute")
def login_for_access_token(request: Request, login_data: UserLogin):
    try:
        res = login_supabase_user(login_data.username, login_data.password)
        access_token = res.get("access_token")
        expires_in = res.get("expires_in", 3600)

        user_meta = res.get("user", {})
        username = user_meta.get("user_metadata", {}).get("username", login_data.username)
        user_id = user_meta.get("id", "")

        # Create our own signed token with user_id and username claims
        internal_token = create_access_token({"sub": user_id, "username": username})

        return {
            "access_token": internal_token,
            "token_type": "bearer",
            "expires_in": JWT_EXPIRY_MINUTES * 60,
            "username": username
        }
    except Exception as e:
        logger.warning(f"[Auth] Login failed for user '{login_data.username}': {e}")
        if "email not confirmed" in str(e).lower():
            raise HTTPException(
                status_code=403,
                detail="Email not confirmed. Please open the confirmation email from Supabase, then sign in again.",
            )
        # SEC-13: Don't reveal whether the username or password was wrong
        raise HTTPException(status_code=401, detail="Invalid credentials.")


# --- Protected Endpoints (SEC-04: JWT required) ---

# REST Endpoint: Room creation & registration in database
@app.post("/api/rooms/create")
def create_room(room_data: RoomCreate, current_user: dict = Depends(get_current_user)):
    room_id = f"nl-{int(time.time())}-{os.urandom(3).hex()}"
    try:
        res = create_room_db(
            room_id=room_id,
            room_name=room_data.room_name,
            ephemeral_mode=room_data.ephemeral_mode,
            metadata_stripping=room_data.metadata_stripping,
            data_residency_region=room_data.data_residency_region
        )
        return {
            "room_id": room_id,
            "room_name": res.get("room_name"),
            "ephemeral_mode": res.get("ephemeral_mode"),
            "created_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise _safe_error(e, "Failed to create room.")


# REST Endpoint: Log Call Join Event
@app.post("/api/call/join")
def log_call_join(request: CallJoinRequest, current_user: dict = Depends(get_current_user)):
    try:
        res = log_call_join_db(request.room_id, request.room_name, request.username)
        return {
            "status": "SUCCESS",
            "log_id": res.get("id"),
            "joined_at": res.get("joined_at", datetime.utcnow().isoformat())
        }
    except Exception as e:
        raise _safe_error(e, "Failed to log call join.")


# REST Endpoint: Log Call Leave Event
@app.post("/api/call/leave")
def log_call_leave(request: CallLeaveRequest, current_user: dict = Depends(get_current_user)):
    try:
        res = log_call_leave_db(request.room_id, request.username)
        if not res:
            raise HTTPException(status_code=404, detail="No active call session found.")
        return {
            "status": "SUCCESS",
            "left_at": res.get("left_at", datetime.utcnow().isoformat())
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise _safe_error(e, "Failed to log call leave.")


# REST Endpoint: Retrieve Call History
@app.get("/api/compliance/call_history")
def get_call_history(room_name: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    try:
        logs = get_call_history_db(room_name)
        return logs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve call history.")


# REST Endpoint: Save Selective Consent (DEACTIVATED)
@app.post("/api/recordings/consent")
def submit_recording_consent(consent: RecordingConsentSchema, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410, 
        detail="Recording and consent tracking features have been permanently deactivated."
    )


# REST Endpoint: High-Performance pgvector Semantic Search (DEACTIVATED)
# ROUTE ORDER FIX (SEC-15): Must be BEFORE /{room_name} route
@app.post("/api/ai/summaries/search")
def search_summaries(query_data: SemanticSearchQuery, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410, 
        detail="Meeting transcription and search features have been permanently deactivated."
    )


# REST Endpoint: Save Meeting Summaries and Action Items (DEACTIVATED)
@app.post("/api/ai/summaries")
def save_meeting_summary(summary_data: MeetingSummaryCreate, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410, 
        detail="Meeting summarization and recording features have been permanently deactivated."
    )


# REST Endpoint: Retrieve Meeting Summaries History (DEACTIVATED)
@app.get("/api/ai/summaries/{room_name}")
def get_room_summaries(room_name: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410, 
        detail="Meeting summarization and recording features have been permanently deactivated."
    )


# REST Endpoint: Save Whiteboard Cloud Snapshot reference
@app.post("/api/whiteboard/save")
def save_whiteboard_snapshot(data: WhiteboardSaveSchema, current_user: dict = Depends(get_current_user)):
    # SEC-09 FIX: Use the authenticated user's identity from JWT, not the
    # client-supplied username which can be spoofed via localStorage manipulation.
    authenticated_username = current_user.get("username", data.username)
    try:
        res = save_whiteboard_snapshot_db(
            room_name=data.room_name,
            url=data.url,
            username=authenticated_username
        )
        return {"status": "SUCCESS", "snapshot_id": res.get("id")}
    except Exception as e:
        raise _safe_error(e, "Failed to save whiteboard snapshot.")


# REST Endpoint: Retrieve Whiteboard Cloud Snapshots history in room
@app.get("/api/whiteboard/list/{room_name}")
def get_whiteboard_snapshots(room_name: str, current_user: dict = Depends(get_current_user)):
    try:
        snapshots = get_whiteboard_snapshots_db(room_name)
        return snapshots
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve whiteboard snapshots.")


# REST Endpoint: Save User Profile
@app.post("/api/profile/save")
def save_user_profile(data: ProfileSaveSchema, current_user: dict = Depends(get_current_user)):
    authenticated_username = current_user.get("username", data.username)
    try:
        res = save_user_profile_db(
            username=authenticated_username,
            bio=data.bio,
            profile_pic=data.profile_pic,
            theme=data.theme,
            chat_settings=data.chat_settings,
            notif_settings=data.notif_settings
        )
        return {"status": "SUCCESS", "profile": res}
    except Exception as e:
        raise _safe_error(e, "Failed to save user profile.")


# REST Endpoint: Retrieve User Profile
@app.get("/api/profile/{username}")
def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
    try:
        profile = get_user_profile_db(username)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found.")
        return profile
    except HTTPException as he:
        raise he
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve user profile.")


# ════════════════════════════════════════════════════════════════════════════
# DIRECT MESSAGES
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/dm/send")
def send_direct_message(data: DirectMessageSend, current_user: dict = Depends(get_current_user)):
    """Persist a direct message from authenticated user to recipient."""
    sender = current_user.get("username", "")
    if not sender:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        msg = send_direct_message_db(sender=sender, recipient=data.recipient, text=data.text)
        return {"status": "SUCCESS", "message": msg}
    except Exception as e:
        raise _safe_error(e, "Failed to send message.")


@app.get("/api/dm/history/{other_user}")
def get_dm_history(
    other_user: str,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user)
):
    """Retrieve full conversation history between authenticated user and other_user."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        msgs = get_direct_messages_db(user_a=me, user_b=other_user, limit=min(limit, 200), offset=max(offset, 0))
        return msgs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve messages.")


@app.get("/api/dm/unread")
def get_unread_messages(current_user: dict = Depends(get_current_user)):
    """Retrieve all pending unread direct messages for the authenticated user."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        msgs = get_unread_messages_db(username)
        return msgs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve unread messages.")


@app.put("/api/dm/read/{other_user}")
def mark_dm_read(other_user: str, current_user: dict = Depends(get_current_user)):
    """Mark all messages from other_user as read."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        mark_messages_read_db(reader=me, other=other_user)
        return {"status": "SUCCESS"}
    except Exception as e:
        raise _safe_error(e, "Failed to mark messages as read.")


# ════════════════════════════════════════════════════════════════════════════
# DIRECT CALL LOGS
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/calls/log")
def log_direct_call(data: DirectCallLog, current_user: dict = Depends(get_current_user)):
    """Log an outgoing call attempt from authenticated user."""
    caller = current_user.get("username", "")
    if not caller:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        log = log_direct_call_db(
            caller=caller,
            callee=data.callee,
            call_type=data.call_type,
            room_name=data.room_name,
        )
        return {"status": "SUCCESS", "call_id": log.get("id"), "log": log}
    except Exception as e:
        raise _safe_error(e, "Failed to log call.")


@app.patch("/api/calls/update")
def update_call_status(data: DirectCallUpdate, current_user: dict = Depends(get_current_user)):
    """Update call status (accepted/declined/missed) and optionally mark it ended."""
    try:
        log = update_direct_call_status_db(
            call_id=data.call_id,
            status=data.status,
            ended=data.ended,
        )
        return {"status": "SUCCESS", "log": log}
    except Exception as e:
        raise _safe_error(e, "Failed to update call status.")


@app.get("/api/calls/history/{other_user}")
def get_call_history_with_user(
    other_user: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get call log between authenticated user and other_user."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        logs = get_direct_call_logs_db(user_a=me, user_b=other_user, limit=min(limit, 100))
        return logs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve call history.")


class ContactAddSchema(BaseModel):
    contact_username: str = Field(..., min_length=1, max_length=50)


@app.post("/api/contacts/add")
def add_contact(data: ContactAddSchema, current_user: dict = Depends(get_current_user)):
    """Add a contact bidirectionally."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        res = add_contact_db(username=me, contact_username=data.contact_username)
        return {"status": "SUCCESS", "contacts": res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/contacts/list")
def get_contacts_list(current_user: dict = Depends(get_current_user)):
    """Retrieve saved contacts list with profiles."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        contacts = get_contacts_db(username=me)
        return contacts
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve contacts list.")


@app.delete("/api/contacts/remove/{contact_username}")
def remove_contact(contact_username: str, current_user: dict = Depends(get_current_user)):
    """Remove bidirectional contact relationship."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        res = remove_contact_db(username=me, contact_username=contact_username)
        return res
    except Exception as e:
        raise _safe_error(e, "Failed to remove contact.")


@app.get("/api/calls/all")
def get_all_call_history(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get all call logs (incoming and outgoing) for the authenticated user."""
    me = current_user.get("username", "")
    if not me:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        logs = get_all_direct_call_logs_db(username=me, limit=min(limit, 100))
        return logs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve call history.")


# ════════════════════════════════════════════════════════════════════════════
# SECURE FILE TRANSFERS
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/files/initiate")
def initiate_file_transfer(data: FileTransferInitiate, current_user: dict = Depends(get_current_user)):
    """Initiate a secure file transfer request and persist its metadata."""
    sender = current_user.get("username", "")
    if not sender:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        res = create_file_transfer_db(
            sender=sender,
            recipient=data.recipient,
            file_name=data.file_name,
            file_size=data.file_size,
            file_type=data.file_type
        )
        transfer = res[0] if isinstance(res, list) and len(res) > 0 else res
        return {"status": "SUCCESS", "transfer_id": transfer.get("id"), "transfer": transfer}
    except Exception as e:
        raise _safe_error(e, "Failed to initiate file transfer.")


@app.get("/api/files/pending")
def get_pending_transfers(current_user: dict = Depends(get_current_user)):
    """Retrieve all pending unread file transfer requests for the authenticated user."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        transfers = get_pending_file_transfers_db(username)
        return transfers
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve pending file transfers.")


@app.put("/api/files/respond/{transfer_id}")
def respond_to_file_transfer(transfer_id: int, data: FileTransferResponse, current_user: dict = Depends(get_current_user)):
    """Respond to a pending file transfer request (accept or decline)."""
    try:
        res = update_file_transfer_status_db(transfer_id=transfer_id, status=data.status)
        transfer = res[0] if isinstance(res, list) and len(res) > 0 else res
        return {"status": "SUCCESS", "transfer": transfer}
    except Exception as e:
        raise _safe_error(e, "Failed to respond to file transfer.")


# ════════════════════════════════════════════════════════════════════════════
# MESSAGES EDIT AND DELETE ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@app.put("/api/dm/edit/{message_id}")
def edit_direct_message(message_id: int, data: DirectMessageEdit, current_user: dict = Depends(get_current_user)):
    """Edit a direct message text (only the sender is permitted)."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        msg = edit_direct_message_db(message_id=message_id, username=username, new_text=data.text)
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found or you are not the sender.")
        return {"status": "SUCCESS", "message": msg}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise _safe_error(e, "Failed to edit message.")


@app.delete("/api/dm/delete/{message_id}")
def delete_direct_message(message_id: int, current_user: dict = Depends(get_current_user)):
    """Delete a direct message row (only the sender is permitted)."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        delete_direct_message_db(message_id=message_id, username=username)
        return {"status": "SUCCESS"}
    except Exception as e:
        raise _safe_error(e, "Failed to delete message.")


# ════════════════════════════════════════════════════════════════════════════
# CALL HISTORY DELETION ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@app.delete("/api/calls/delete/{call_id}")
def delete_call_log(call_id: int, current_user: dict = Depends(get_current_user)):
    """Delete a specific call history log (only if caller or callee)."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        delete_direct_call_log_db(call_id=call_id, username=username)
        return {"status": "SUCCESS"}
    except Exception as e:
        raise _safe_error(e, "Failed to delete call log.")


@app.delete("/api/calls/clear")
def clear_all_call_logs(current_user: dict = Depends(get_current_user)):
    """Clear all direct call history logs where the user was caller or callee."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        clear_all_direct_call_logs_db(username=username)
        return {"status": "SUCCESS"}
    except Exception as e:
        raise _safe_error(e, "Failed to clear call history.")


# ════════════════════════════════════════════════════════════════════════════
# NOTIFICATION AUDIT AND MONITORING ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/compliance/notification_logs")
def get_notification_logs(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Retrieve push notification diagnostic logs for compliance monitoring."""
    username = current_user.get("username", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        logs = get_notification_logs_db(username=username, limit=min(limit, 100))
        return logs
    except Exception as e:
        raise _safe_error(e, "Failed to retrieve notification logs.")


