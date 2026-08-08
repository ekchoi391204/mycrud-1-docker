import socket
import time
from contextlib import asynccontextmanager

import redis
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from auth import (
    bearer_scheme,
    create_session,
    current_account,
    delete_session,
    hash_password,
    redis_client,
    verify_password,
)
from config import settings
from database import Base, SessionLocal, engine, get_db
from models import Account, Person
from schemas import LoginRequest, PersonCreate, PersonList, PersonResponse, PersonUpdate, RegisterRequest


def initialize_database() -> None:
    last_error: Exception | None = None
    for _ in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            with SessionLocal() as db:
                db.execute(text("UPDATE people SET gender = 'Female' WHERE gender NOT IN ('Male', 'Female')"))
                if not db.scalar(select(Account).where(Account.username == settings.admin_username)):
                    db.add(Account(username=settings.admin_username, password_hash=hash_password(settings.admin_password)))
                if (db.scalar(select(func.count(Person.id))) or 0) == 0:
                    db.add_all([
                        Person(name="홍길동", gender="Male", age=25),
                        Person(name="김철수", gender="Male", age=32),
                        Person(name="이영희", gender="Female", age=28),
                        Person(name="박지민", gender="Female", age=40),
                    ])
                db.commit()
            return
        except OperationalError as exc:
            last_error = exc
            time.sleep(2)
    raise RuntimeError("MySQL에 연결할 수 없습니다.") from last_error


def initialize_redis() -> None:
    last_error: Exception | None = None
    for _ in range(30):
        try:
            redis_client.ping()
            return
        except redis.RedisError as exc:
            last_error = exc
            time.sleep(2)
    raise RuntimeError("Redis에 연결할 수 없습니다.") from last_error


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    initialize_redis()
    yield
    redis_client.close()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": settings.app_version, "docs": "/docs", "health": "/health"}


@app.get("/health", response_class=JSONResponse)
def health() -> JSONResponse:
    database_status = "ok"
    redis_status = "ok"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        database_status = "error"
    try:
        redis_client.ping()
    except redis.RedisError:
        redis_status = "error"
    if database_status != "ok" or redis_status != "ok":
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "http_status": "503 Service Unavailable", "app": "ok", "database": database_status, "redis": redis_status, "version": settings.app_version},
        )
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": "ok", "http_status": "200 OK", "app": "ok", "database": "ok", "redis": "ok", "version": settings.app_version},
    )


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict[str, str | int]:
    account = db.scalar(select(Account).where(Account.username == payload.username))
    if not account or not verify_password(payload.password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    return {
        "access_token": create_session(account),
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "username": account.username,
    }


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, str | int]:
    username = payload.username.strip()
    if db.scalar(select(Account).where(Account.username == username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디입니다.")
    account = Account(username=username, password_hash=hash_password(payload.password))
    db.add(account)
    try:
        db.commit()
        db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디입니다.")
    return {
        "id": account.id,
        "access_token": create_session(account),
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "username": account.username,
    }


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> None:
    if credentials and credentials.scheme.lower() == "bearer":
        delete_session(credentials.credentials)


@app.get("/api/auth/me")
def me(account: Account = Depends(current_account)) -> dict[str, str | int]:
    return {"id": account.id, "username": account.username}


@app.get("/api/people", response_model=PersonList, include_in_schema=False)
@app.get("/api/members", response_model=PersonList)
def list_people(
    q: str = Query(default="", max_length=100),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> PersonList:
    del account
    statement = select(Person)
    count_statement = select(func.count(Person.id))
    if q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.where(Person.name.like(pattern))
        count_statement = count_statement.where(Person.name.like(pattern))
    people = db.scalars(statement.order_by(Person.id.desc())).all()
    return PersonList(items=list(people), total=db.scalar(count_statement) or 0)


@app.post("/api/people", response_model=PersonResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
@app.post("/api/members", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
def create_person(payload: PersonCreate, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> Person:
    del account
    person = Person(**payload.model_dump())
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


def get_person_or_404(person_id: int, db: Session) -> Person:
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return person


@app.put("/api/people/{person_id}", response_model=PersonResponse, include_in_schema=False)
@app.put("/api/members/{person_id}", response_model=PersonResponse)
def update_person(person_id: int, payload: PersonUpdate, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> Person:
    del account
    person = get_person_or_404(person_id, db)
    for key, value in payload.model_dump().items():
        setattr(person, key, value)
    db.commit()
    db.refresh(person)
    return person


@app.delete("/api/people/{person_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
@app.delete("/api/members/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(person_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> None:
    del account
    person = get_person_or_404(person_id, db)
    db.delete(person)
    db.commit()


@app.get("/api/system/meta")
def system_meta(request: Request, account: Account = Depends(current_account)) -> dict[str, str]:
    del account
    try:
        detected_server_ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        detected_server_ip = "-"
    return {
        "server_name": socket.gethostname(),
        "server_ip": settings.server_ip or detected_server_ip,
        "version": settings.app_version,
        "ip": request.client.host if request.client else "-",
        "xff": request.headers.get("x-forwarded-for", "-"),
    }
