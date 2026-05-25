from passlib.context import CryptContext

# Set up CryptContext with bcrypt backend
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Returns the one-way bcrypt hash of the raw password."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies that the plain password matches the secure hashed password."""
    return pwd_context.verify(plain_password, hashed_password)
