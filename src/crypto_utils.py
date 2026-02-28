import os
from cryptography.fernet import Fernet

def get_fernet_key() -> bytes:
    key = os.environ.get("ENCRYPTION_KEY")
    if not key:
        raise ValueError("ENCRYPTION_KEY string is missing from environment variables.")
    return key.encode()

def encrypt_password(password: str) -> str:
    f = Fernet(get_fernet_key())
    return f.encrypt(password.encode()).decode()

def decrypt_password(encrypted_password: str) -> str:
    f = Fernet(get_fernet_key())
    return f.decrypt(encrypted_password.encode()).decode()
