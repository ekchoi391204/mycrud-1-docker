# React + FastAPI CRUD - Docker 실행 가이드

React, FastAPI, MySQL, Redis를 각각 Docker 이미지로 빌드하고 하나의 Docker
네트워크에서 실행하는 프로젝트입니다.

## 서비스 구성

| 서비스 | 디렉터리 | 이미지 | 컨테이너 포트 | 호스트 포트 |
| --- | --- | --- | --- | --- |
| DB | `db/` | `hifrodo/mycrud-1-db:1.0` | `3306` | 공개하지 않음 |
| Redis | `redis/` | `hifrodo/mycrud-1-redis:1.0` | `6379` | 공개하지 않음 |
| API | `app/` | `hifrodo/mycrud-1-api:1.0` | `8000` | `8000` |
| Front | `frontend/` | `hifrodo/mycrud-1-front:1.0` | `80` | `80` |

`hifrodo`는 이 프로젝트에서 사용하는 Docker Hub 계정명입니다. 따라서
`hifrodo/이미지명:태그` 형식으로 빌드한 이미지는 `hifrodo` 계정의 Docker
Hub 저장소에 push됩니다.

컨테이너는 `mynet` 네트워크에서 다음 별칭으로 통신합니다.

```text
db.cloud.local     MySQL
redis.cloud.local  Redis
api.cloud.local    FastAPI
```

Front 컨테이너의 Nginx는 `/api`, `/health`, `/docs`, `/openapi.json` 요청을
`api.cloud.local:8000`으로 전달합니다.

## 프로젝트 구조

```text
crud-4-1-docker/
├── app/
│   ├── Dockerfile
│   ├── .env
│   ├── .env.example
│   └── requirements.txt
├── db/
│   ├── Dockerfile
│   └── init.sql
├── redis/
│   ├── Dockerfile
│   └── redis.conf
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── work/
│   └── docker-compose.yml
└── README.md
```

## 사전 준비

- Docker가 설치되어 있고 실행 중이어야 합니다.
- 모든 명령은 프로젝트 루트인 `crud-4-1-docker`에서 실행합니다.
- DB와 API 실행 명령의 `MYSQL_PASSWORD`는 같은 값으로 설정해야 합니다.
- 실행 명령에 있는 `CHANGE_ME_*` 값을 실제 운영 비밀번호로 변경합니다.

## 1. Docker 이미지 빌드

DB, Redis, API, Front 이미지를 각각 빌드합니다.

```bash
docker build -t hifrodo/mycrud-1-db:1.0 ./db
docker build -t hifrodo/mycrud-1-redis:1.0 ./redis
docker build -t hifrodo/mycrud-1-api:1.0 ./app
docker build -t hifrodo/mycrud-1-front:1.0 ./frontend
```

빌드 결과를 확인합니다.

```bash
docker image ls hifrodo/mycrud-1-db:1.0
docker image ls hifrodo/mycrud-1-redis:1.0
docker image ls hifrodo/mycrud-1-api:1.0
docker image ls hifrodo/mycrud-1-front:1.0
```

## 2. Docker Hub에 이미지 Push

Docker Hub의 `hifrodo` 계정으로 로그인합니다.

```bash
docker login -u hifrodo
```

명령을 실행한 후 Docker Hub 비밀번호 또는 Personal Access Token을
입력합니다. 로그인에 성공하면 빌드한 이미지 네 개를 push합니다.

```bash
docker push hifrodo/mycrud-1-db:1.0
docker push hifrodo/mycrud-1-redis:1.0
docker push hifrodo/mycrud-1-api:1.0
docker push hifrodo/mycrud-1-front:1.0
```

다른 서버에서는 다음 명령으로 이미지를 받을 수 있습니다.

```bash
docker pull hifrodo/mycrud-1-db:1.0
docker pull hifrodo/mycrud-1-redis:1.0
docker pull hifrodo/mycrud-1-api:1.0
docker pull hifrodo/mycrud-1-front:1.0
```

Docker Hub 저장소가 비공개라면 이미지를 pull할 서버에서도 먼저
`docker login -u hifrodo`를 실행해야 합니다.

## 3. Docker 네트워크 생성

서비스가 서로 통신할 수 있도록 `mynet` 네트워크를 생성합니다. 최초 한 번만
실행하면 됩니다.

```bash
docker network create mynet
```

이미 존재하는지 확인하려면 다음 명령을 사용합니다.

```bash
docker network inspect mynet
```

## 4. DB 실행

DB를 가장 먼저 실행합니다. MySQL 환경변수는 `-e` 옵션으로 직접 전달하며,
DB 데이터는 `mycrud-1-db-data` 볼륨에 저장됩니다. 아래의
`CHANGE_ME_MYSQL_ROOT_PASSWORD`와 `CHANGE_ME_MYSQL_APP_PASSWORD`를 실제
비밀번호로 변경해서 실행합니다.

```bash
docker run -d --name mycrud-db --restart unless-stopped --network mynet --network-alias db.cloud.local -e MYSQL_ROOT_PASSWORD=CHANGE_ME_MYSQL_ROOT_PASSWORD -e MYSQL_DATABASE=frodo -e MYSQL_USER=frodo -e MYSQL_PASSWORD=CHANGE_ME_MYSQL_APP_PASSWORD -v mycrud-1-db-data:/var/lib/mysql hifrodo/mycrud-1-db:1.0
```

빈 DB 볼륨으로 최초 실행하면 MySQL 이미지가 전달된 환경변수로 `frodo`
데이터베이스와 사용자를 생성합니다. 이후 `db/init.sql`이 자동 실행되어
다음 항목을 생성합니다.

- `accounts`, `people` 테이블
- `people` 초기 데이터

DB 로그를 확인합니다.

```bash
docker logs -f mycrud-db
```

로그에 `ready for connections`가 표시되면 준비된 것입니다. `Ctrl+C`는 로그
보기만 종료하며 컨테이너는 계속 실행됩니다.

## 5. Redis 실행

DB가 준비된 다음 Redis를 실행합니다. Redis 데이터는
`mycrud-1-redis-data` 볼륨에 저장됩니다.

```bash
docker run -d --name mycrud-redis --restart unless-stopped --network mynet --network-alias redis.cloud.local -v mycrud-1-redis-data:/data hifrodo/mycrud-1-redis:1.0
```

연결 상태를 확인합니다. 결과가 `PONG`이면 정상입니다.

```bash
docker exec mycrud-redis redis-cli ping
```

## 6. API 실행

DB와 Redis가 준비된 다음 API를 실행합니다. API 환경변수는 `-e` 옵션으로
직접 전달하며 `db.cloud.local`, `redis.cloud.local`로 내부 서비스에
연결합니다. `CHANGE_ME_ADMIN_PASSWORD`와
`CHANGE_ME_MYSQL_APP_PASSWORD`를 실제 비밀번호로 변경해서 실행합니다.

```bash
docker run -d --name mycrud-api --restart unless-stopped --network mynet --network-alias api.cloud.local -e SERVER_NAME=api.cloud.local -e CORS_ORIGINS=http://localhost -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD -e MYSQL_HOST=db.cloud.local -e MYSQL_PORT=3306 -e MYSQL_DATABASE=frodo -e MYSQL_USER=frodo -e MYSQL_PASSWORD=CHANGE_ME_MYSQL_APP_PASSWORD -e REDIS_HOST=redis.cloud.local -e REDIS_PORT=6379 -e REDIS_DATABASE=0 -p 8000:8000 hifrodo/mycrud-1-api:1.0
```

API 로그와 상태를 확인합니다.

```bash
docker logs -f mycrud-api
curl http://localhost:8000/health
```

API 문서는 `http://localhost:8000/docs`에서 확인할 수 있습니다.

## 7. Front 실행

API가 준비된 다음 Front를 실행합니다. 호스트의 `80` 포트를 Front
컨테이너의 `80` 포트에 연결합니다.

```bash
docker run -d --name mycrud-front --restart unless-stopped --network mynet -p 80:80 hifrodo/mycrud-1-front:1.0
```

브라우저에서 다음 주소로 접속합니다.

```text
http://localhost
```

## 8. Docker Compose로 배포

개별 `docker run` 명령으로 실행한 기존 컨테이너를 제거한 뒤
`work/docker-compose.yml`로 전체 서비스를 배포할 수 있습니다.

### 기존 컨테이너 제거

다음 명령은 현재 Docker 호스트에서 실행 중인 **모든 컨테이너를 강제로
삭제**합니다. 이 프로젝트 외의 컨테이너도 삭제되므로 전용 EC2 또는 삭제
대상을 확인한 환경에서만 실행합니다.

```bash
docker ps
docker rm -f $(docker ps -q)
```

중지된 컨테이너까지 포함하여 호스트의 모든 컨테이너를 삭제하려면 다음
명령을 사용합니다.

```bash
docker rm -f $(docker ps -aq)
```

다른 컨테이너를 유지하고 이 프로젝트의 기존 컨테이너만 삭제하려면 다음
명령을 사용합니다.

```bash
docker rm -f mycrud-front mycrud-api mycrud-redis mycrud-db
```

컨테이너를 삭제해도 `mycrud-1-db-data`, `mycrud-1-redis-data` named volume은
삭제되지 않으므로 기존 데이터는 유지됩니다.

### Compose 실행

프로젝트 루트에서 `app/.env`의 운영 환경 값을 확인한 뒤 `work` 디렉터리로
이동합니다.

```bash
cd work
```

Docker Hub에서 최신 이미지를 받은 뒤 서비스를 백그라운드로 실행합니다.

```bash
docker-compose.exe pull
docker-compose.exe up -d
```

Compose는 별도의 `mycrud-network` 네트워크를 자동 생성하고 DB와 Redis의
헬스체크가 통과한 뒤 API, Front 순으로 시작합니다.

실행 상태와 로그를 확인합니다.

```bash
docker-compose.exe ps
docker-compose.exe logs -f
```

브라우저에서 `http://localhost` 또는 EC2의 공인 IP로 접속합니다.

Compose 서비스를 중지하고 컨테이너 및 `mycrud-network`를 제거하려면 다음
명령을 실행합니다. named volume의 데이터는 유지됩니다.

```bash
docker-compose.exe down
```

## 실행 상태와 로그 확인

전체 컨테이너의 실행 상태를 확인합니다.

```bash
docker ps
```

서비스별 로그를 확인합니다.

```bash
docker logs mycrud-db
docker logs mycrud-redis
docker logs mycrud-api
docker logs mycrud-front
```

## 컨테이너 중지 및 재시작

중지할 때는 Front부터 역순으로 중지합니다.

```bash
docker stop mycrud-front
docker stop mycrud-api
docker stop mycrud-redis
docker stop mycrud-db
```

다시 시작할 때는 DB부터 순서대로 시작합니다.

```bash
docker start mycrud-db
docker start mycrud-redis
docker start mycrud-api
docker start mycrud-front
```

## 이미지 변경 후 컨테이너 재생성

소스나 Dockerfile을 변경한 경우 해당 이미지를 다시 빌드한 뒤 기존
컨테이너를 삭제하고 같은 `docker run` 명령으로 재생성합니다. 예를 들어
API를 변경한 경우 다음과 같이 실행합니다.

```bash
docker build -t hifrodo/mycrud-1-api:1.0 ./app
docker stop mycrud-api
docker rm mycrud-api
docker run -d --name mycrud-api --restart unless-stopped --network mynet --network-alias api.cloud.local -e SERVER_NAME=api.cloud.local -e CORS_ORIGINS=http://localhost -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD -e MYSQL_HOST=db.cloud.local -e MYSQL_PORT=3306 -e MYSQL_DATABASE=frodo -e MYSQL_USER=frodo -e MYSQL_PASSWORD=CHANGE_ME_MYSQL_APP_PASSWORD -e REDIS_HOST=redis.cloud.local -e REDIS_PORT=6379 -e REDIS_DATABASE=0 -p 8000:8000 hifrodo/mycrud-1-api:1.0
```

## 데이터 보존

DB와 Redis는 다음 named volume을 사용합니다.

```text
mycrud-1-db-data
mycrud-1-redis-data
```

컨테이너를 삭제하고 재생성해도 이 볼륨의 데이터는 유지됩니다. 또한 기존
DB 볼륨이 있으면 MySQL 초기화 과정과 `db/init.sql`은 다시 실행되지
않습니다.
