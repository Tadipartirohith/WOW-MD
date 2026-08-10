# WOW World of Weddings, design blueprint

This document explains how the WOW platform is designed and why it is built the way it is. It is written in plain language so that anyone on the team can read it, and it uses only ordinary keyboard characters.

## Goals

WOW carries a couple through the whole wedding journey, which runs from discovering and matching with a partner, to connecting and chatting, to planning the wedding, to booking vendors, to running the ceremonies, to arranging the honeymoon, and finally to keeping the memories. The engineering goals are that the system should feel fast, that it should handle a large number of people at the same time, that it should be secure, and that it should be able to grow automatically when traffic rises.

## The main design principles

The first principle is that the whole backend is one well organised application rather than many separate services, but it is built from clear modules with firm boundaries so that any module can later be pulled out into its own service when the traffic actually demands it. This gives most of the benefit of a service based system without the heavy operational cost early on.

The second principle is that there is a single main database, which is PostgreSQL, and that flexible or document shaped data is stored in JSON columns inside it rather than in a separate document database. This keeps the data in one place, allows proper transactions, and avoids the fragmentation that comes from spreading the same records across several stores.

The third principle is that the application layer holds no state of its own. It writes nothing to local disk and keeps no session in memory, because everything shared lives in the database, in Redis, or in object storage. This is what allows many copies of the application to run at once and to be added or removed automatically.

The fourth principle is that every value an operator or a tester might want to change lives in configuration rather than in the code. This includes the database and cache connection details, the security settings, the matchmaking weights, and the choice of payment, storage, and AI provider.

The fifth principle is that work which does not need to happen inside a web request happens after it, through a reliable outbox, so that sending notifications, recomputing matches, and reacting to bookings never slows down the response to the user.

## How the pieces fit together

A person uses the web application or, in future, a mobile application. Their requests arrive at a load balancer or ingress that terminates the secure connection, applies rate limits, and forwards the traffic. Behind that sit several identical copies of the WOW backend. Each copy talks to PostgreSQL for its records, to Redis for caching and sessions and for delivering chat across copies, and to object storage with a content delivery network for photos and videos. Because the copies keep no state, the number of them can rise and fall with demand.

## The modules

The identity module handles registration, sign in, tokens, and profiles. The matchmaking module scores how compatible two people are, suggests partners, and records interest and acceptance. The chat module delivers real time messages between people who have matched. The vendors module runs the marketplace with search, reviews, and administrator approval. The planner module builds a wedding timeline automatically from the wedding date. The bookings module manages the booking life cycle and holds payment in escrow. The events module manages the individual ceremonies with guest lists, invitations, responses, and seating. The travel module offers destinations, packages, and itineraries. The media module stores albums and shares them through public links. The admin module offers approvals, dispute handling, and simple analytics. The AI module, called WOW Genie, offers budget guidance and answers planning questions. A shared platform layer provides configuration, health checks, the database and cache connections, the event bus and outbox, and the security guards.

Each module owns its own tables and speaks to other modules only through defined interfaces and through domain events, never by reaching directly into another module's tables. This is the discipline that makes it possible to extract a module into its own service later without a rewrite.

## The data model

The main records are users and their profiles, the interests that connect people, the conversations and messages between matched people, the vendors and their reviews, the wedding plans and their tasks, the bookings and their payments, the events with their guests and invitations, the travel destinations and packages and itineraries, the albums and their media items, the notifications, the disputes, and the outbox of domain events. Every foreign key is indexed, and every column that is used to filter or to sort has an index, so that common queries stay fast. The schema is created and changed only through versioned migrations, and the automatic schema synchronisation feature is turned off in every environment because it is unsafe.

## Matchmaking

Compatibility is scored from zero to one hundred across several dimensions, which are age closeness, location, religion or community, education, lifestyle, and stated preferences. The weight of each dimension comes from configuration, so the product team can retune the behaviour without changing the code or redeploying. Suggestions are filtered by hard rules such as gender preference and privacy, then scored, then sorted, then cached in Redis for a short time, and finally returned in pages. There is also an optional graph database, Neo4j, which can rank suggestions using the network of who is interested in whom, and when it is switched off the system simply uses the Postgres scoring instead.

## Real time and background work

Chat runs over web sockets, and it uses a Redis backed adapter so that a message reaches the right person no matter which copy of the backend they are connected to. Background work uses the outbox pattern, where a record of each domain event is written in the same database transaction as the change that caused it, and a separate worker then reads those records and acts on them. This guarantees that the change and its follow up effects never disagree. When the optional Kafka integration is turned on, the same events are also published to Kafka so that other services can consume them.

## Configuration

All settings are read from environment variables in one place, checked when the application starts, and read through a typed accessor rather than directly from the environment. If a required setting is missing or clearly wrong, the application refuses to start, which means a mistake is caught immediately. The file named dot env dot example in the backend folder lists every setting with a short explanation, and the same names are used in the Kubernetes configuration so there is no difference between environments other than the values.

## Security

The system issues short lived access tokens together with longer lived refresh tokens, and it stores only a hashed form of the refresh token. Passwords are hashed with a strong algorithm whose cost comes from configuration. Access to routes is controlled by role. Standard security headers are applied, and there is rate limiting across the whole application with tighter limits on the sign in and registration routes. Secrets come from a secret manager rather than from the code, traffic is encrypted in transit, and data is encrypted at rest through the managed database. Administrator actions are recorded for audit, and the design follows the Indian data protection expectations together with the European rules.

## Infrastructure and scaling

For production the application is packaged as a small layered image that runs as an unprivileged user and reports its own health. It is deployed on Kubernetes with a deployment, a service, an ingress, automatic horizontal scaling based on processor use and on request rate, health probes, a disruption budget, and resource limits. The database, cache, and object storage are managed cloud services rather than containers the team runs by hand. The cloud foundation is described in Terraform, and a continuous integration pipeline lints, type checks, tests, and builds the image on every change.

## Testing

There are unit tests for the core logic that run quickly without any infrastructure, functional tests that drive the real application against a real database and cache, and a load test that checks the response times stay within target under pressure. The functional and load tests were run against a live database and cache during development, and running them live even uncovered real defects that were then fixed.

## Delivery so far

The foundation, the full set of features, the optional graph and streaming integrations, the real payment, storage, and AI providers, the web application, and the deployment setup are all in place. The payment, storage, and AI parts ship with a built in mock version chosen by configuration, so the whole platform runs from end to end on a local machine, and you switch to the real Razorpay, S3, and language model providers by changing configuration. The only work deliberately left for later is the extraction of the busiest modules into separate services, which the design says to do only when the traffic makes it worthwhile.
