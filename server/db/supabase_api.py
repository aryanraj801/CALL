import os
import json
import urllib.request
import urllib.parse
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# SEC-02 FIX: Load Supabase credentials from environment variables.
# Never hardcode API keys or project URLs in source code.
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://uejwhikwtjikrsbnaabo.supabase.co")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

if not SUPABASE_ANON_KEY:
    raise RuntimeError(
        "[Security] SUPABASE_ANON_KEY environment variable is not set. "
        "Set it in your .env file. Never hardcode API keys in source."
    )


def _headers(use_bearer=True):
    h = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    }
    if use_bearer:
        h["Authorization"] = f"Bearer {SUPABASE_ANON_KEY}"
        h["Prefer"] = "return=representation"
    return h


def _http_request(url, method="GET", data=None, use_bearer=True):
    req_data = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(
        url,
        data=req_data,
        headers=_headers(use_bearer),
        method=method
    )
    try:
        with urllib.request.urlopen(req) as response:
            res_content = response.read().decode('utf-8')
            if res_content:
                return json.loads(res_content)
            return []
    except urllib.error.HTTPError as e:
        error_content = e.read().decode('utf-8')
        # SEC-13 FIX: Log full error server-side only, don't expose internals to caller
        print(f"[Supabase HTTPError] URL: {url}, Code: {e.code}, Content: {error_content}")
        try:
            err_json = json.loads(error_content)
            msg = err_json.get("error_description") or err_json.get("msg") or err_json.get("message") or "Database operation failed"
            raise Exception(msg)
        except json.JSONDecodeError:
            raise Exception("Database operation failed")
    except Exception as e:
        print(f"[Supabase Connection Error] URL: {url}, Error: {e}")
        raise


# --- Native Supabase Auth via GoTrue ---

def signup_supabase_user(username, email, password):
    url = f"{SUPABASE_URL}/auth/v1/signup"
    payload = {
        "email": email,
        "password": password,
        "data": {
            "username": username
        }
    }
    # Do not use Bearer auth for public signups, just apikey header
    return _http_request(url, "POST", payload, use_bearer=False)


def login_supabase_user(email_or_username, password):
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    email = email_or_username
    if "@" not in email_or_username:
        # SEC-05 FIX: URL-encode the username before injecting into query string
        # to prevent PostgREST filter injection attacks.
        safe_username = urllib.parse.quote(email_or_username, safe='')
        query_url = f"{SUPABASE_URL}/rest/v1/user_profiles?username=eq.{safe_username}&select=email"
        profiles = _http_request(query_url, "GET")
        if profiles:
            email = profiles[0]["email"]

    payload = {
        "email": email,
        "password": password
    }
    return _http_request(url, "POST", payload, use_bearer=False)


# --- Core Database Methods ---

# 1. Create Room Session
def create_room_db(room_id, room_name, ephemeral_mode=True, metadata_stripping=True, data_residency_region="US"):
    url = f"{SUPABASE_URL}/rest/v1/rooms"
    payload = {
        "id": room_id,
        "room_name": room_name,
        "ephemeral_mode": ephemeral_mode,
        "metadata_stripping": metadata_stripping,
        "data_residency_region": data_residency_region,
        "created_at": datetime.utcnow().isoformat()
    }
    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 2. Log Join event (Tracks who called)
def log_call_join_db(room_id, room_name, username):
    url = f"{SUPABASE_URL}/rest/v1/call_logs"
    payload = {
        "room_id": room_id,
        "room_name": room_name,
        "username": username,
        "joined_at": datetime.utcnow().isoformat()
    }
    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 3. Log Leave event
def log_call_leave_db(room_id, username):
    # SEC-05 FIX: URL-encode both room_id and username to prevent filter injection
    safe_room_id = urllib.parse.quote(str(room_id), safe='')
    safe_username = urllib.parse.quote(str(username), safe='')
    query_url = f"{SUPABASE_URL}/rest/v1/call_logs?room_id=eq.{safe_room_id}&username=eq.{safe_username}&left_at=is.null&order=joined_at.desc&limit=1"
    logs = _http_request(query_url, "GET")

    if not logs:
        print(f"[Warn] No active call session found for room {room_id}, user {username}")
        return None

    log_id = logs[0]["id"]
    safe_log_id = urllib.parse.quote(str(log_id), safe='')
    update_url = f"{SUPABASE_URL}/rest/v1/call_logs?id=eq.{safe_log_id}"
    payload = {
        "left_at": datetime.utcnow().isoformat()
    }
    res = _http_request(update_url, "PATCH", payload)
    return res[0] if res else payload


# 4. Get Call History
def get_call_history_db(room_name=None):
    url = f"{SUPABASE_URL}/rest/v1/call_logs?order=joined_at.desc"
    if room_name:
        # SEC-05 FIX: URL-encode room_name filter value
        safe_room_name = urllib.parse.quote(str(room_name), safe='')
        url += f"&room_name=eq.{safe_room_name}"
    return _http_request(url, "GET")


# 5. Save Selective Consent
def submit_recording_consent_db(room_name, participant_id, consent_granted):
    url = f"{SUPABASE_URL}/rest/v1/recording_consents"
    payload = {
        "room_name": room_name,
        "participant_id": participant_id,
        "consent_granted": consent_granted,
        "timestamp": datetime.utcnow().isoformat()
    }
    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 6. Save Meeting Summaries and Action Items
def save_meeting_summary_db(room_name, transcript, summary, action_items, embedding=None):
    url = f"{SUPABASE_URL}/rest/v1/meeting_summaries"
    payload = {
        "room_name": room_name,
        "transcript": transcript,
        "summary": summary,
        "action_items": action_items,
        "created_at": datetime.utcnow().isoformat()
    }
    if embedding is not None:
        payload["transcript_embedding"] = embedding

    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 7. Get Room Summaries
def get_room_summaries_db(room_name):
    # SEC-05 FIX: URL-encode room_name
    safe_room_name = urllib.parse.quote(str(room_name), safe='')
    url = f"{SUPABASE_URL}/rest/v1/meeting_summaries?room_name=eq.{safe_room_name}&order=created_at.desc"
    return _http_request(url, "GET")


# 8. Semantic Search RPC Call
def search_meeting_summaries_db(query_embedding, match_threshold=0.3, match_count=5):
    url = f"{SUPABASE_URL}/rest/v1/rpc/search_meeting_summaries"
    payload = {
        "query_embedding": query_embedding,
        "match_threshold": float(match_threshold),
        "match_count": int(match_count)
    }
    return _http_request(url, "POST", payload)


# 9. Save Whiteboard Snapshot metadata
def save_whiteboard_snapshot_db(room_name, url, username):
    api_url = f"{SUPABASE_URL}/rest/v1/whiteboard_saves"
    payload = {
        "room_name": room_name,
        "url": url,
        "saved_by": username,
        "created_at": datetime.utcnow().isoformat()
    }
    res = _http_request(api_url, "POST", payload)
    return res[0] if res else payload


# 10. Get Whiteboard Snapshots history in room
def get_whiteboard_snapshots_db(room_name):
    # SEC-05 FIX: URL-encode room_name
    safe_room_name = urllib.parse.quote(str(room_name), safe='')
    api_url = f"{SUPABASE_URL}/rest/v1/whiteboard_saves?room_name=eq.{safe_room_name}&order=created_at.desc"
    return _http_request(api_url, "GET")


# 11. Save or Update User Profile
def save_user_profile_db(username, bio, profile_pic):
    safe_username = urllib.parse.quote(str(username), safe='')
    query_url = f"{SUPABASE_URL}/rest/v1/user_profiles?username=eq.{safe_username}"
    existing = _http_request(query_url, "GET")
    
    payload = {
        "username": username,
        "bio": bio,
        "profile_pic": profile_pic,
        "updated_at": datetime.utcnow().isoformat()
    }
    
    if existing:
        update_url = f"{SUPABASE_URL}/rest/v1/user_profiles?username=eq.{safe_username}"
        res = _http_request(update_url, "PATCH", payload)
    else:
        url = f"{SUPABASE_URL}/rest/v1/user_profiles"
        res = _http_request(url, "POST", payload)
        
    return res[0] if res else payload


# 12. Get User Profile
def get_user_profile_db(username):
    safe_username = urllib.parse.quote(str(username), safe='')
    query_url = f"{SUPABASE_URL}/rest/v1/user_profiles?username=eq.{safe_username}"
    res = _http_request(query_url, "GET")
    return res[0] if res else None


# ── DIRECT MESSAGES ────────────────────────────────────────────────────────────

def _convo_key(user_a: str, user_b: str) -> str:
    """Deterministic conversation key — always sorted so A→B == B→A."""
    return "|".join(sorted([user_a.lower().strip(), user_b.lower().strip()]))


# 13. Send (persist) a direct message
def send_direct_message_db(sender: str, recipient: str, text: str):
    url = f"{SUPABASE_URL}/rest/v1/direct_messages"
    payload = {
        "conversation_key": _convo_key(sender, recipient),
        "sender":    sender,
        "recipient": recipient,
        "text":      text[:4000],
        "sent_at":   datetime.utcnow().isoformat(),
        "read":      False,
    }
    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 14. Fetch conversation history (newest-first, paginated)
def get_direct_messages_db(user_a: str, user_b: str, limit: int = 100, offset: int = 0):
    safe_key = urllib.parse.quote(_convo_key(user_a, user_b), safe='')
    url = (
        f"{SUPABASE_URL}/rest/v1/direct_messages"
        f"?conversation_key=eq.{safe_key}"
        f"&order=sent_at.asc"
        f"&limit={int(limit)}&offset={int(offset)}"
    )
    return _http_request(url, "GET")


# 15. Mark all messages in a conversation as read (for the recipient)
def mark_messages_read_db(reader: str, other: str):
    safe_key  = urllib.parse.quote(_convo_key(reader, other), safe='')
    safe_user = urllib.parse.quote(reader.lower(), safe='')
    # Mark messages where the recipient is the reader (i.e., sent by the other party)
    url = (
        f"{SUPABASE_URL}/rest/v1/direct_messages"
        f"?conversation_key=eq.{safe_key}"
        f"&recipient=eq.{safe_user}"
        f"&read=eq.false"
    )
    _http_request(url, "PATCH", {"read": True})


# ── DIRECT CALL LOGS ──────────────────────────────────────────────────────────

# 16. Log a direct call attempt (status starts as 'missed')
def log_direct_call_db(caller: str, callee: str, call_type: str = "video", room_name: str = ""):
    url = f"{SUPABASE_URL}/rest/v1/direct_call_logs"
    payload = {
        "conversation_key": _convo_key(caller, callee),
        "caller":      caller,
        "callee":      callee,
        "call_type":   call_type if call_type in ("video", "voice") else "video",
        "status":      "missed",
        "room_name":   room_name[:120],
        "started_at":  datetime.utcnow().isoformat(),
    }
    res = _http_request(url, "POST", payload)
    return res[0] if res else payload


# 17. Update call status (accepted / declined / ended) and optionally set ended_at
def update_direct_call_status_db(call_id: int, status: str, ended: bool = False):
    safe_id = urllib.parse.quote(str(call_id), safe='')
    url = f"{SUPABASE_URL}/rest/v1/direct_call_logs?id=eq.{safe_id}"
    payload: dict = {"status": status if status in ("accepted", "declined", "missed") else "missed"}
    if ended:
        payload["ended_at"] = datetime.utcnow().isoformat()
    res = _http_request(url, "PATCH", payload)
    return res[0] if res else payload


# 18. Get call log for a conversation (newest first)
def get_direct_call_logs_db(user_a: str, user_b: str, limit: int = 50):
    safe_key = urllib.parse.quote(_convo_key(user_a, user_b), safe='')
    url = (
        f"{SUPABASE_URL}/rest/v1/direct_call_logs"
        f"?conversation_key=eq.{safe_key}"
        f"&order=started_at.desc"
        f"&limit={int(limit)}"
    )
    return _http_request(url, "GET")
