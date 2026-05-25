import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from sqlalchemy.pool import NullPool

# Configured for standard PostgreSQL connection string, fallback to SQLite for local development
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "sqlite:///./nexalink_local.db"
)

# Connect to database.
# For SQLite, allow multi-threading for development.
# For Supabase connection pooler on port 6543, disable client-side pooling to prevent connection leaks.
connect_args = {}
poolclass = None

if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif "pooler.supabase.com" in DATABASE_URL or ":6543" in DATABASE_URL:
    poolclass = NullPool
    # Set statement timeout and disable prepared statements if any driver overrides exist
    connect_args = {"options": "-c statement_timeout=30000"}

engine = create_engine(
    DATABASE_URL, 
    connect_args=connect_args,
    **(dict(poolclass=poolclass) if poolclass else {})
)

SessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=engine
)

Base = declarative_base()

# Dependency wrapper to fetch database sessions dynamically in router scopes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
