# 智境网关 Docker Image

智境网关 is an AI API Gateway Platform for distributing and managing AI product subscription API quotas.

## Quick Start

```bash
docker run -d \
  --name zhijing-gateway \
  -p 127.0.0.1:8080:8080 \
  -e DATABASE_URL="postgres://user:pass@host:5432/sub2api" \
  -e REDIS_URL="redis://host:6379" \
  ghcr.io/daniei-chen/zhijing-gateway:latest
```

## Docker Compose

The examples publish the container on `127.0.0.1:8080`, so the gateway answers
only on the Docker host. Serve production traffic through a reverse proxy
(nginx/Caddy) on that host; to publish the port directly instead, map
`-p 8080:8080` and restrict the port in the host firewall. The Compose files in
`deploy/` take the address from `BIND_HOST`, which defaults to `127.0.0.1` and
must be set to `0.0.0.0` to expose the port. A deployment that relied on the
previous `0.0.0.0` default keeps direct access only after setting it
explicitly.

```yaml
version: '3.8'

services:
  zhijing-gateway:
    image: ghcr.io/daniei-chen/zhijing-gateway:latest
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/sub2api?sslmode=disable
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=sub2api
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Startup and Database Recovery

智境网关 runs database migrations while starting. PostgreSQL may still be
recovering briefly after a host or Docker daemon restart. The application
retries transient PostgreSQL startup and connection errors with bounded
exponential backoff, then continues startup when the database is ready.
Permanent errors such as invalid credentials, migration checksum mismatches,
SQL errors, and incompatible data fail immediately.

The Compose deployment also checks PostgreSQL readiness with both `pg_isready`
and a simple SQL query. `depends_on: condition: service_healthy` helps order a
fresh Compose start, but application-level retries are still required when
Docker restores existing containers after a host restart.

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `PORT` | Server port | No | `8080` |
| `GIN_MODE` | Gin framework mode (`debug`/`release`) | No | `release` |

## Supported Architectures

- `linux/amd64`
- `linux/arm64`

## Tags

- `latest` - Latest stable release
- `x.y.z` - Specific version
- `x.y` - Latest patch of minor version
- `x` - Latest minor of major version

## Links

- [GitHub Repository](https://github.com/daniei-chen/zhijing-gateway)
- [Documentation](https://github.com/daniei-chen/zhijing-gateway#readme)
