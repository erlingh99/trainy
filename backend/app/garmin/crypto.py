import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet() -> Fernet:
    key = os.environ.get("GARMIN_SECRET_KEY", "")
    if not key:
        raise RuntimeError(
            "GARMIN_SECRET_KEY is not set. "
            "Generate one with: python -c "
            "\"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(key.encode())


def encrypt_password(password: str) -> str:
    return _fernet().encrypt(password.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception) as e:
        raise RuntimeError(
            f"Failed to decrypt Garmin password — check that GARMIN_SECRET_KEY matches the key used when credentials were stored: {e}"
        ) from e
