# PRK Live Rates Backend

Spring Boot service for exposing the `Retail 995` gold rate over HTTP.

## Production checklist

- Set `AIB_TOKEN` before starting the application.
- Set `APP_CORS_ALLOWED_ORIGINS` to your real frontend domain.
- Use the health endpoint at `/actuator/health`.
- Do not keep development origins in production environment variables.

## Run locally

```bash
./mvnw spring-boot:run
```

## Build and run with Docker

```bash
docker build -t prk-live-rates-backend .
docker run --rm -p 10000:10000 \
  -e SERVER_PORT=10000 \
  -e AIB_TOKEN=your-token \
  -e APP_CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com \
  prk-live-rates-backend
```

Then test locally:

```bash
curl http://localhost:10000/actuator/health
curl http://localhost:10000/api/prk/gold/retail-995
```

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

## Important environment variables

- `AIB_TOKEN`: required upstream cookie value.
- `APP_CORS_ALLOWED_ORIGINS`: comma-separated allowed frontend origins.
- `AIB_CACHE_TTL_SECONDS`: short cache to avoid scraping the upstream page on every request.
- `AIB_STALE_IF_ERROR_SECONDS`: how long a recent cached value may still be served if the upstream site is temporarily down.
- `AIB_TIMEOUT_SECONDS`: upstream read timeout in seconds.
- `AIB_CONNECT_TIMEOUT_MILLIS`: upstream connection timeout.
