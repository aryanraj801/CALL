from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON, ForeignKey
from datetime import datetime
from db.session import Base
from pgvector.sqlalchemy import Vector

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Room(Base):
    __tablename__ = "rooms"

    id = Column(String(50), primary_key=True, index=True)
    room_name = Column(String(100), nullable=False)
    ephemeral_mode = Column(Boolean, default=True)
    metadata_stripping = Column(Boolean, default=True)
    data_residency_region = Column(String(10), default="US")
    created_at = Column(DateTime, default=datetime.utcnow)
    concluded_at = Column(DateTime, nullable=True)

class CallLog(Base):
    __tablename__ = "call_logs"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(String(50), ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    room_name = Column(String(100), nullable=False)
    username = Column(String(50), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)

class RecordingConsent(Base):
    __tablename__ = "recording_consents"

    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String(100), nullable=False)
    participant_id = Column(String(100), nullable=False)
    consent_granted = Column(Boolean, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

class MeetingSummary(Base):
    __tablename__ = "meeting_summaries"

    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String(100), nullable=False)
    transcript = Column(String, nullable=False)
    summary = Column(String, nullable=False)
    action_items = Column(JSON, nullable=False)
    transcript_embedding = Column(Vector(384), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class DataComplianceAuditLog(Base):
    __tablename__ = "data_compliance_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String(100), nullable=False)
    region = Column(String(10), nullable=False)
    audit_status = Column(String(50), nullable=False)  # 'COMPLIANT', 'OVERRIDE_WARNING'
    checked_at = Column(DateTime, default=datetime.utcnow)

