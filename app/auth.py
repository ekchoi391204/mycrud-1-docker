import secrets

import redis
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Account

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
redis_client = redis.Redis(
    host=settings.redis_host,
    port=settings.redis_port,
    db=settings.redis_database,
    password=settings.redis_password,
    decode_responses=True,
    socket_connect_timeout=3,
    socket_timeout=3,
)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_session(account: Account) -> str:
    token = secrets.token_urlsafe(48)
    redis_client.setex(
        f"{settings.redis_session_prefix}{token}",
        settings.access_token_expire_minutes * 60,
        str(account.id),
    )
    return token


def delete_session(token: str) -> None:
    redis_client.delete(f"{settings.redis_session_prefix}{token}")


def current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Account:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="로그인이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        account_id_value = redis_client.get(
            f"{settings.redis_session_prefix}{credentials.credentials}"
        )
        account_id = int(account_id_value) if account_id_value else None
    except (redis.RedisError, TypeError, ValueError):
        raise unauthorized
    if account_id is None:
        raise unauthorized
    account = db.scalar(select(Account).where(Account.id == account_id))
    if not account:
        raise unauthorized
    return account
