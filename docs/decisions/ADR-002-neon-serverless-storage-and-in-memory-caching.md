# ADR-002: Neon PostgreSQL Persistence with Read-Through / Write-Through In-Memory Caching

## Status
Accepted

## Date
2026-09-14

## Context
DentAI is deployed to modern serverless cloud infrastructure (e.g. Vercel, Cloudflare, AWS Lambda) to maintain near-zero idle infrastructure costs and handle spiky clinical usage patterns without dedicated DevOps personnel.

Serverless hosting platforms introduce two fundamental technical constraints:
1. **Stateless Ephemeral Containers:** Serverless runtimes spin up and terminate compute instances on demand. In-memory session stores (such as JavaScript `Map` or `Record<string, string>`) lose state when subsequent HTTP requests are routed to different container instances, triggering random `401/403 Session Expired` errors.
2. **Read-Only Local Filesystems:** The execution runtime environment has a strictly read-only local filesystem. Attempting to write mutable state directly to disk (e.g., `fs.writeFileSync('data/db.json')`) throws fatal write permission errors (`EROFS`).

Furthermore, during local development and testing, Vitest executes test suites in parallel by default, which can cause file write collisions and race conditions if multiple workers interact concurrently with shared local filesystem JSON files.

## Decision
We implement a hybrid, resilient persistence architecture combining **Neon Serverless PostgreSQL** as the durable cloud database with an **in-memory read-through/write-through caching layer** and **stateless signed authentication tokens**:

1. **Neon Serverless PostgreSQL Primary:**
   - Durable entities (`users`, `schedules`, `consultations`, `note_jobs`, `telemetry`) are persisted in Neon PostgreSQL via `@neondatabase/serverless` using pooled HTTP connections (`neon(databaseUrl)`), eliminating connection-exhaustion issues common with traditional Postgres connection pools in serverless lambdas.
   - Schemas include explicit compound indices (e.g. `(dentist_id, date)` for schedules) to ensure O(1) query performance.
2. **Read-Through / Write-Through In-Memory Caching Layer:**
   - All filesystem operations are wrapped in a memory-first caching layer (`dbCache`).
   - Writes update the in-memory cache first. If a filesystem write to `data/db.json` throws an `EROFS` or write-permission error, the server intercepts the exception, logs a warning, maintains the updated state in memory, and returns HTTP 200/201 success to the client.
3. **Stateless HMAC-Signed Tokens:**
   - User authentication and operatory sessions utilize cryptographically signed tokens containing tenant metadata (`dentist_id`, `clinic_id`, `exp`). Any serverless container instance can independently verify session validity in-memory without cross-container network trips or shared memory locks.
4. **Test Concurrency Isolation:**
   - Vitest configuration enforces `--fileParallelism=false` to serialize database access across test suites.
   - Test hooks (`beforeAll` / `afterAll`) backup and restore database files, and invoke `invalidateDbCache()` to ensure fresh fixtures across test runs.

## Alternatives Considered

### 1. Pure Local JSON File Storage (`data/db.json`)
- **Pros:** Extremely simple for local development; zero external dependencies.
- **Cons:** Fails immediately on serverless read-only platforms (`EROFS`); does not support multi-container horizontal scale; prone to file write race conditions.
- **Rejected:** Unviable for production cloud deployments.

### 2. Traditional Managed PostgreSQL (AWS RDS / GCP Cloud SQL)
- **Pros:** Established, mature SQL database.
- **Cons:** Expensive idle costs ($30-$80/mo minimum even when surgeries are closed at night); traditional TCP connection pools choke under serverless concurrency spikes unless paired with an external connection pooler (PgBouncer).
- **Rejected:** Excessive operational complexity and cost for a solo founder.

### 3. Redis / Memcached Shared Cache
- **Pros:** Fast shared in-memory key-value store.
- **Cons:** Introduces another billable service and operational dependency to monitor and maintain.
- **Rejected:** Neon serverless HTTP queries + local container cache provides sufficient performance without added infrastructure.

## Consequences
- **Zero-DevOps Maintenance:** Neon scales compute to zero when operatories are dormant overnight, reducing database hosting costs to near zero.
- **Serverless Resilience:** The application operates seamlessly in read-only container environments without throwing `EROFS` exceptions.
- **High Concurrency:** Pooled serverless SQL connections prevent connection-limit throttling during morning rush hours (8:30 AM).
- **Offline Fallback:** When internet connectivity to Neon drops, the system continues operating locally via the in-memory/JSON fallback cache.
