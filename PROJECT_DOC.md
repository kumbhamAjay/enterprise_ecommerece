# Enterprise E-commerce Platform

## Project Context, Scope, Architecture & Learning Objectives

**Project Name:** Enterprise E-commerce Platform  
**Repository:** `enterprise_ecommerce`  
**Project Type:** Full-Stack Enterprise Application  
**Primary Purpose:** Practical Software Engineering Learning & Interview Preparation  
**Target Experience Level:** 2.5 Years  
**Architecture:** Modular Monolith  
**Development Approach:** Backend-first, database-driven, production-oriented  
**Status:** Initial backend setup and Supabase connection completed; initial user registration implementation in progress.

---

# 1. Project Overview

We are building a production-style Enterprise E-commerce and Order Management Platform from scratch.

This is not intended to be another basic CRUD application or a simple product listing website.

The primary objective is to build a realistic enterprise application that covers the technical concepts, architectural patterns, database engineering principles, backend development practices, and system design knowledge expected from a software engineer with approximately 2.5 years of professional experience.

The project should simulate the engineering challenges encountered in real-world e-commerce platforms.

We will implement the application module by module, understanding the internal working of every important concept rather than blindly using libraries or frameworks.

The project should eventually support:

- User registration, authentication and authorization.
- Product and category management.
- Manufacturer management.
- Product search, filtering, sorting and pagination.
- Inventory and stock management.
- Shopping cart management.
- Order creation and order lifecycle management.
- Payment processing simulation.
- Email notifications.
- Background job processing.
- Redis caching.
- Admin management.
- Analytics and reporting.
- Logging, monitoring and error handling.
- Testing, performance optimization and deployment.

# 2. Why Are We Building This Project?

The main motivation is to bridge the gap between frontend-focused development experience and complete full-stack engineering knowledge.

A developer with 2.5 years of experience should be able to do more than implement React components and connect APIs.

They should understand:

1. How a backend application is architected.
2. How databases store and retrieve information.
3. How concurrent requests are handled.
4. How database consistency is maintained.
5. How transactions prevent partial updates.
6. How APIs are secured and optimized.
7. How caching and background processing work.
8. How applications handle failures.
9. How large datasets are processed efficiently.
10. How to design systems that can scale.

This project is designed to develop those skills through actual implementation.

## Learning philosophy

Every feature must have two outcomes:

**Outcome 1 — Working functionality**

Build a working feature that can be demonstrated in a real application.

**Outcome 2 — Engineering understanding**

Understand:

- Why the feature is required.
- What problem it solves.
- How it works internally.
- What happens behind the scenes.
- What alternatives exist.
- What trade-offs are involved.
- What can go wrong.
- How to debug and optimize it.
- How it can be asked in technical interviews.

The focus is not just completing the project. The focus is becoming capable of independently designing and implementing similar systems.

# 3. Technology Stack

## Frontend

- React
- Next.js
- TypeScript
- Tailwind CSS
- React Hooks
- Context API where appropriate
- React Query / TanStack Query for server-state management

Learning objectives:

- Component architecture.
- State management.
- Server-side rendering and client-side rendering.
- React Server Components.
- Data fetching and caching.
- Performance optimization.
- Memory leaks.
- Large dataset handling.
- Pagination and infinite scrolling.
- Error boundaries.
- API integration.

## Backend

- Node.js
- Express.js
- TypeScript
- REST API architecture
- Zod for request validation
- bcrypt for password hashing
- JSON Web Tokens for authentication
- pg for PostgreSQL connectivity

Learning objectives:

- Node.js event loop.
- Asynchronous programming.
- Promises and async/await.
- Event-driven architecture.
- Middleware.
- Request lifecycle.
- Layered architecture.
- Dependency management.
- Authentication and authorization.
- Error handling.
- API security.
- Rate limiting.
- Concurrency.
- Performance optimization.

## Database

- Supabase PostgreSQL
- Raw SQL using the pg driver initially.
- Prisma or Drizzle ORM in a later phase.

Important: PostgreSQL concepts should initially be learned using raw SQL. ORM abstractions should be introduced only after understanding the underlying database operations.

Learning objectives:

- Database design.
- Normalization and denormalization.
- Relationships.
- Primary and foreign keys.
- Unique and check constraints.
- Indexing.
- Composite indexes.
- Partial indexes.
- Query optimization.
- Transactions.
- ACID properties.
- Isolation levels.
- MVCC.
- Row-level locking.
- Optimistic and pessimistic locking.
- Deadlocks.
- Query execution plans.
- Connection pooling.
- CTEs.
- Recursive CTEs.
- Window functions.
- JSONB.
- Stored procedures and triggers.

## Caching and Background Processing

- Redis through Upstash or a local Redis instance.
- BullMQ.
- Bull Board.

Learning objectives:

- Redis data structures.
- Caching strategies.
- Cache invalidation.
- TTL.
- Cache-aside pattern.
- Cache consistency.
- Rate limiting using Redis.
- Job queues.
- Workers.
- Job retries.
- Exponential backoff.
- Failed jobs.
- Dead-letter handling.
- Idempotent job processing.
- Queue monitoring.

## External Services

- DummyJSON for initial product data.
- Brevo or Resend for email notifications.
- Supabase Storage for product images and documents.
- Sentry for error monitoring.

These services should be integrated through proper adapters or service layers so that business logic is not tightly coupled to a particular provider.

## Development and Testing

- Git and GitHub.
- Docker and Docker Compose.
- Postman.
- Swagger / OpenAPI.
- Jest or Vitest.
- Supertest.
- k6 for load testing.
- Winston or Pino for logging.

# 4. Application Architecture

We will start with a **Modular Monolith**, not microservices.

The reason is to understand application architecture, module boundaries, transactions and internal communication before introducing distributed-system complexity.

The backend will contain independent business modules inside a single deployable application.

## High-level architecture

Frontend (Next.js)
|
| HTTP / REST APIs
|
Backend (Node.js + Express)
|
|--------------------------------|
| | |
PostgreSQL Redis External APIs
| |
Persistent data BullMQ queues
|
Workers
|
Email Notifications

## Backend layered architecture

Each module should follow this structure:

modules/
products/
product.routes.ts
product.controller.ts
product.service.ts
product.repository.ts
product.types.ts
product.schema.ts

Responsibilities:

**Routes**

- Define API endpoints.
- Attach middleware.
- Connect endpoints to controllers.

**Controllers**

- Read HTTP request data.
- Validate incoming data.
- Call services.
- Return HTTP responses.

**Services**

- Implement business logic.
- Coordinate repositories and external services.
- Handle business rules.

**Repositories**

- Execute database queries.
- Encapsulate SQL operations.
- Handle database-level operations.

**Schemas**

- Validate request parameters and payloads using Zod.

The architecture should be consistent across all modules.

# 5. Functional Project Scope

## Module 1: Authentication and User Management

Features:

- User registration.
- Login and logout.
- Password hashing.
- JWT access tokens.
- Refresh tokens.
- Refresh token rotation.
- Password reset.
- Email verification.
- Role-based access control.
- Protected APIs.
- User profile.
- Address management.

Concepts:

- Authentication vs authorization.
- Hashing vs encryption.
- JWT internals.
- Access and refresh token lifecycle.
- Cookie security.
- CSRF and XSS.
- SQL injection.
- Password security.
- RBAC.
- Middleware.
- Token revocation.
- Session management.

## Module 2: Product and Category Management

Features:

- Product CRUD.
- Category CRUD.
- Manufacturer CRUD.
- Product-category relationships.
- Product images.
- External API product import.
- Bulk product import.
- Search.
- Filtering.
- Sorting.
- Pagination.

Concepts:

- Database relationships.
- Joins.
- One-to-many and many-to-many relationships.
- Bulk inserts.
- UPSERT.
- ON CONFLICT.
- External API integration.
- API pagination.
- Cursor-based pagination.
- Search optimization.
- Indexes.
- Full-text search.
- Data validation.
- Data transformation.

## Module 3: Inventory Management

Features:

- Stock tracking.
- Stock reservations.
- Stock adjustments.
- Inventory history.
- Low-stock notifications.
- Preventing overselling.

Concepts:

- ACID transactions.
- Race conditions.
- Concurrent database updates.
- Atomic operations.
- SELECT FOR UPDATE.
- Row-level locking.
- MVCC.
- Optimistic locking.
- Pessimistic locking.
- Deadlocks.
- Isolation levels.
- Retry strategies.

Important practical scenario:

Suppose only one product unit is available, but two customers attempt to purchase it simultaneously.

The system must ensure that only one customer successfully purchases that unit.

We must implement and test this scenario instead of simply learning the definition of race conditions.

## Module 4: Shopping Cart

Features:

- Add items.
- Remove items.
- Update quantities.
- Retrieve cart.
- Calculate subtotal.
- Validate inventory.
- Persist cart for logged-in users.

Concepts:

- Relational database design.
- State management.
- Data consistency.
- Transactions.
- Aggregation.
- Redis caching.
- Guest vs authenticated carts.
- Cart merging.
- Concurrent updates.

## Module 5: Checkout and Order Management

Features:

- Checkout.
- Billing and shipping addresses.
- Order creation.
- Order items.
- Order status management.
- Order history.
- Cancellation.
- Refund simulation.
- Order status tracking.

Concepts:

- Database transactions.
- Idempotency keys.
- Atomic operations.
- Transaction boundaries.
- Payment failures.
- Distributed transactions.
- Saga pattern.
- Event-driven architecture.
- Webhooks.
- Reconciliation.
- Order lifecycle management.

Important practical scenario:

A payment succeeds with the payment provider, but the backend fails while updating the order.

Understand how to handle this inconsistency using webhooks, retries, idempotency and reconciliation.

## Module 6: Payment Integration

Features:

- Simulated payment provider initially.
- Payment authorization.
- Payment success and failure.
- Payment status tracking.
- Webhook handling.
- Refund simulation.

Concepts:

- Payment lifecycle.
- Idempotency.
- Webhook signature verification.
- Duplicate webhook events.
- Retry handling.
- Payment reconciliation.
- Security.
- PCI-related responsibilities.

We must never store raw card numbers or CVV values in our database.

## Module 7: Redis and Caching

Features:

- Cache frequently accessed products.
- Cache category information.
- Cache search results where appropriate.
- Rate limiting.
- Session or token-related storage where appropriate.

Concepts:

- Redis strings, hashes, sets and sorted sets.
- Cache-aside pattern.
- Write-through and write-behind concepts.
- TTL.
- Cache invalidation.
- Cache stampede.
- Distributed locking and its limitations.
- Redis persistence.
- Cache consistency.

## Module 8: Background Jobs and Email Notifications

Features:

- Order confirmation emails.
- Registration verification emails.
- Password reset emails.
- Shipping notifications.
- Low-stock notifications.
- Scheduled cleanup jobs.

Architecture:

API Request
|
Create Order in PostgreSQL
|
Enqueue Notification Job
|
BullMQ / Redis
|
Background Worker
|
Email Provider
|
Bull Board Monitoring

Concepts:

- Asynchronous processing.
- Message queues.
- Producer and consumer.
- Workers.
- Retries.
- Exponential backoff.
- Job priorities.
- Failed jobs.
- Idempotent consumers.
- At-least-once delivery.
- Eventual consistency.

## Module 9: Search and Performance

Features:

- Product search.
- Filters.
- Sorting.
- Pagination.
- Large product dataset handling.

Concepts:

- B-tree indexes.
- Composite indexes.
- Partial indexes.
- PostgreSQL full-text search.
- EXPLAIN.
- EXPLAIN ANALYZE.
- Sequential scans.
- Index scans.
- Query planning.
- Connection pooling.
- N+1 query problem.
- Cursor pagination.
- Redis caching.

## Module 10: Admin Dashboard and Analytics

Features:

- Admin product management.
- Order management.
- Inventory monitoring.
- User management.
- Sales summaries.
- Revenue reports.
- Best-selling products.

Concepts:

- Aggregation.
- GROUP BY.
- HAVING.
- Window functions.
- CTEs.
- Views.
- Materialized views.
- Role-based authorization.
- Efficient reporting queries.

# 6. Database Engineering Scope

Database engineering is one of the most important objectives of this project.

We must not treat PostgreSQL as just a place to store JSON data.

We should understand how the database works internally.

Topics to implement and experiment with:

### Database fundamentals

- Database schemas.
- Tables and columns.
- Data types.
- Constraints.
- Primary keys.
- Foreign keys.
- Relationships.
- Normalization (1NF, 2NF, 3NF).
- Denormalization.

### Query engineering

- SELECT, INSERT, UPDATE and DELETE.
- INNER, LEFT, RIGHT and CROSS JOIN.
- Subqueries.
- CTEs.
- Recursive CTEs.
- Window functions.
- Aggregations.
- JSONB queries.

### Indexing and optimization

- B-tree indexes.
- Composite indexes.
- Partial indexes.
- Unique indexes.
- Index selectivity.
- EXPLAIN ANALYZE.
- Query planning.
- Slow-query analysis.

### Transactions and concurrency

- ACID.
- Transaction boundaries.
- COMMIT and ROLLBACK.
- Isolation levels.
- READ COMMITTED.
- REPEATABLE READ.
- SERIALIZABLE.
- MVCC.
- Row-level locks.
- Table-level locks.
- Shared and exclusive locks.
- Optimistic and pessimistic locking.
- Deadlocks.
- Lock timeouts.

### Advanced database engineering

- Connection pooling.
- Prepared statements.
- Database migrations.
- Backup and recovery.
- Replication concepts.
- Read replicas.
- Sharding concepts.
- Partitioning.
- Database scalability.

For each important database topic, we should write actual SQL, run experiments and inspect the results.

# 7. System Design Concepts to Cover

The application should be used as a practical foundation for learning system design.

Topics:

### Architecture

- Monolith vs modular monolith vs microservices.
- Layered architecture.
- Clean architecture principles.
- Domain-driven design fundamentals.
- Separation of concerns.
- SOLID principles.
- Design patterns.

### Scalability

- Vertical vs horizontal scaling.
- Load balancing.
- Stateless services.
- Database connection pools.
- Read replicas.
- Database sharding.
- Partitioning.
- Caching.
- CDN concepts.

### Distributed systems

- CAP theorem.
- Consistency models.
- Strong vs eventual consistency.
- Idempotency.
- Retries.
- Timeouts.
- Circuit breakers.
- Distributed locking.
- Message queues.
- Event-driven architecture.
- Saga pattern.

### Reliability

- Fault tolerance.
- Graceful degradation.
- Retry strategies.
- Dead-letter queues.
- Health checks.
- Monitoring.
- Observability.

# 8. Node.js and Backend Internals

We should explicitly cover Node.js internals rather than treating Express as the entire backend.

Topics:

- V8 engine fundamentals.
- Call stack.
- Heap memory.
- Event loop.
- Event loop phases.
- Microtask queue.
- Macrotasks.
- Promises.
- Async/await.
- libuv.
- Thread pool.
- Blocking vs non-blocking operations.
- Streams.
- Buffers.
- EventEmitter.
- Worker threads.
- Child processes.
- Memory leaks.
- Garbage collection.
- Connection pooling.
- Concurrent request handling.

Practical experiments:

- Simulate thousands of requests.
- Observe event-loop blocking.
- Process large datasets using streams.
- Monitor memory usage.
- Compare sequential and parallel API operations.
- Implement rate limiting.
- Test worker threads for CPU-heavy operations.

# 9. Frontend Engineering Scope

Although backend and database engineering are major priorities, frontend development must also be implemented professionally.

Topics:

- React component architecture.
- React Hooks.
- useState, useEffect, useMemo and useCallback internals.
- Context API.
- Server state vs client state.
- React Query.
- Next.js App Router.
- Server Components.
- Client Components.
- SSR, CSR and SSG.
- API integration.
- Authentication.
- Route protection.
- Pagination.
- Infinite scrolling.
- Debouncing and throttling.
- Virtualization.
- Lazy loading.
- Code splitting.
- Memory leak prevention.
- Performance optimization.
- Error boundaries.

The frontend should demonstrate a real e-commerce user journey, not just isolated pages.

# 10. Testing and Quality Engineering

We must not consider a feature complete merely because its happy path works.

Every important module should have tests.

### Unit testing

- Service tests.
- Utility tests.
- Validation tests.
- Business logic tests.

### Integration testing

- API endpoints.
- PostgreSQL interactions.
- Authentication flows.
- Transaction behavior.
- Repository operations.

### Concurrency testing

- Multiple users purchasing the same stock.
- Duplicate checkout requests.
- Concurrent inventory updates.
- Simultaneous cart updates.

### Performance testing

- Large product datasets.
- High request volumes.
- Slow database queries.
- Redis cache performance.
- Background job throughput.

Tools:

- Jest or Vitest.
- Supertest.
- k6.

# 11. DevOps and Deployment

Topics:

- Git workflows.
- Branching strategies.
- Pull requests.
- Environment management.
- Docker.
- Docker Compose.
- Dockerfile optimization.
- Container networking.
- CI/CD.
- GitHub Actions.
- Deployment.
- Logging.
- Monitoring.
- Environment secrets.
- Production configuration.

The application should eventually be containerized and deployed.

# 12. Recommended Database Schema

The following tables will be introduced gradually as features are implemented.

### User management

- users
- roles
- user_roles
- addresses
- refresh_tokens

### Product management

- categories
- manufacturers
- products
- product_images

### Inventory

- inventory
- inventory_transactions
- stock_reservations

### Cart

- carts
- cart_items

### Orders

- orders
- order_items
- order_status_history

### Payments

- payments
- payment_events
- refunds

### Background processing

- notification_logs
- idempotency_keys (where appropriate for API request deduplication)

Additional tables can be introduced when justified by actual business requirements.

# 13. Eight-Week Learning and Implementation Roadmap

### Week 1: Backend fundamentals

- Node.js and Express setup.
- TypeScript.
- Modular architecture.
- Supabase PostgreSQL.
- Authentication.
- Registration and login.
- Password hashing.
- JWT.
- Middleware.
- Validation and error handling.

### Week 2: Database engineering

- Schema design.
- Normalization.
- Relationships.
- Joins.
- Constraints.
- Indexes.
- Pagination.
- Query optimization.
- EXPLAIN ANALYZE.

### Week 3: Product and inventory engineering

- Product APIs.
- External product API integration.
- Bulk import.
- Search and filtering.
- Inventory.
- Transactions.
- Row-level locking.
- Concurrent stock updates.

### Week 4: Cart, checkout and order management

- Cart management.
- Checkout.
- Order creation.
- Order items.
- Payment simulation.
- Idempotency.
- Rollbacks.
- Payment failure handling.

### Week 5: Advanced backend

- Redis.
- Caching.
- Rate limiting.
- BullMQ.
- Bull Board.
- Background workers.
- Email notifications.
- Retry strategies.

### Week 6: Frontend

- Next.js setup.
- Authentication.
- Product listing.
- Search and filters.
- Product details.
- Cart.
- Checkout.
- Admin screens.

### Week 7: Testing and scalability

- Unit testing.
- Integration testing.
- Load testing.
- Concurrency testing.
- Memory optimization.
- Logging.
- Monitoring.
- Performance improvements.

### Week 8: DevOps and production readiness

- Docker.
- Docker Compose.
- CI/CD.
- Deployment.
- Security review.
- Documentation.
- Production configuration.

This is a target roadmap, not a deadline. We should spend more time on topics that need deeper understanding rather than rushing to finish all modules.

# 14. Important Practical Engineering Scenarios

These scenarios must be implemented and tested during the project.

1. Two customers try to purchase the last available product simultaneously.
2. A customer clicks the checkout button multiple times.
3. Payment succeeds, but the order update fails.
4. A background email job fails repeatedly.
5. Redis becomes unavailable.
6. The database receives thousands of simultaneous requests.
7. A product search query becomes slow with one million records.
8. A database transaction creates a deadlock.
9. An API receives malformed or malicious input.
10. A user attempts to access an admin-only endpoint.
11. A worker processes the same job more than once.
12. A frontend page continuously receives large WebSocket messages.
13. A product update invalidates cached product data.
14. An external product API becomes unavailable during bulk import.

For every scenario, understand:

- The problem.
- The root cause.
- How to reproduce it.
- How to detect it.
- Possible solutions.
- Trade-offs between solutions.
- How the final implementation handles it.

# 15. Mandatory Learning Instructions for Claude

Claude should act as a senior full-stack engineer, backend mentor, database engineer and system design interviewer.

The objective is to teach the developer, not just generate code.

Follow these instructions throughout the project:

### A. Teach before implementing

Before introducing an important feature, explain:

- What it is.
- Why we need it.
- What problem it solves.
- How it works internally.
- How it is used in real-world applications.

### B. Explain internal working

Avoid superficial explanations.

For example, when teaching database transactions, explain:

- What happens when BEGIN executes.
- How PostgreSQL manages transaction state.
- What happens during COMMIT.
- What ROLLBACK does.
- How concurrent transactions interact.
- How locks are acquired and released.
- How isolation levels affect visibility.

Similarly, when teaching Redis, BullMQ, JWT, Node.js event loop or React hooks, explain their internal working and practical implications.

### C. Implement features step by step

For every feature:

1. Explain the architecture.
2. Explain the database requirements.
3. Design the API contract.
4. Create the folder structure.
5. Implement the repository.
6. Implement the service.
7. Implement the controller.
8. Implement routes and middleware.
9. Test using Postman.
10. Write automated tests.
11. Discuss performance and security.
12. Explain relevant interview questions.

Do not dump an entire application's code at once.

### D. Preserve project consistency

Before suggesting changes, consider the existing architecture, files, naming conventions, dependencies and implementation.

Prefer minimal changes that preserve existing functionality.

Do not unnecessarily rewrite working code.

Use TypeScript and appropriate types. Avoid `any` unless there is a clear reason.

Use parameterized SQL queries.

Never expose credentials, tokens, password hashes or secrets in API responses or logs.

### E. Include real-world scenarios

For every important topic, provide at least one practical scenario from our e-commerce application.

For example:

- Transactions: order creation.
- Row-level locks: stock reservation.
- Redis: product caching.
- BullMQ: order confirmation emails.
- Idempotency: duplicate checkout requests.
- Webhooks: payment status updates.
- Indexes: product filtering.
- Pagination: large product catalogs.

### F. Explain trade-offs

Never present one solution as universally correct.

Compare alternatives when appropriate.

Examples:

- Offset pagination vs cursor pagination.
- Redis vs in-memory caching.
- Optimistic vs pessimistic locking.
- Monolith vs microservices.
- JWT vs session authentication.
- Raw SQL vs ORM.
- Synchronous vs asynchronous processing.

### G. Interview preparation

After completing each major feature, provide:

- Basic interview questions.
- Intermediate interview questions.
- Scenario-based interview questions.
- Follow-up questions an interviewer might ask.
- Strong sample answers.

The difficulty should target a developer with approximately 2.5 years of experience.

### H. Do not skip database engineering

Database concepts must be treated as a core learning objective, not an afterthought.

Whenever a feature uses PostgreSQL:

- Explain the SQL.
- Explain relationships and constraints.
- Explain indexes where relevant.
- Explain transaction boundaries.
- Explain potential concurrency issues.
- Explain how to optimize the query.

### I. Encourage independent problem-solving

Don't immediately provide every answer.

For suitable tasks:

1. Explain the requirement.
2. Give the developer an implementation assignment.
3. Let the developer attempt it.
4. Review the implementation.
5. Explain mistakes and improvements.
6. Provide a production-oriented solution.

However, when the developer explicitly requests a complete example, provide the complete working implementation and explain it.

# 16. Definition of Project Completion

The project will be considered complete when:

- The full e-commerce user journey works.
- Authentication and authorization are implemented securely.
- Product and inventory operations are reliable.
- Concurrent stock updates cannot cause overselling.
- Checkout supports idempotency.
- Payment failures and webhook retries are handled.
- Redis caching works with appropriate invalidation.
- BullMQ processes background jobs.
- Bull Board monitors queue activity.
- Email notifications work.
- Database queries are optimized.
- Important modules have automated tests.
- The application is containerized.
- Logging and monitoring are implemented.
- The application is deployed.
- API documentation is available.
- The developer can explain the architecture and major engineering decisions.

# 17. Final Learning Outcome

At the end of this project, the developer should be comfortable with:

**Frontend engineering:** Building performant React and Next.js applications.

**Backend engineering:** Designing and implementing modular Node.js applications and secure REST APIs.

**Database engineering:** Designing relational schemas, writing optimized SQL, understanding transactions, locking, isolation and concurrency.

**System design:** Understanding scalability, caching, queues, consistency, reliability and distributed-system fundamentals.

**Production engineering:** Testing, debugging, monitoring, containerization and deployment.

Most importantly, the developer should be capable of independently explaining and implementing the engineering concepts in technical interviews and real-world projects.

---

**Core principle: Build to learn, understand to implement, and implement to demonstrate engineering ability.**
