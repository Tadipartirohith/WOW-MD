# WOW, World of Weddings

WOW is a full stack platform that carries a couple through the whole wedding journey. People discover and match with a partner, connect and chat once both sides agree, plan the wedding with an automatic timeline, book vendors with money held safely in escrow, run the individual ceremonies with guest lists and seating, arrange the honeymoon, and finally keep their photos and videos in shareable albums.

The backend is a single well organised NestJS application written in TypeScript. It stores everything in PostgreSQL and uses Redis for caching, sessions, rate limiting and real time chat delivery. The frontend is a React application built with Vite and styled with Tailwind. The whole system is packaged to run with Docker, to scale on Kubernetes, and to be provisioned on AWS with Terraform.

## What is inside this repository

The backend folder holds the API, the database migrations, the shared platform code such as configuration and health checks, and the tests. The frontend folder holds the React single page application. The docker folder holds the images and the compose files for running everything locally. The k8s folder holds the Kubernetes manifests for a production deployment. The terraform folder holds the cloud infrastructure. The docs folder holds the design blueprint and the setup and testing guide.

## The main features

A person can register and sign in, and the system issues short lived access tokens together with longer lived refresh tokens. Each person builds a profile with their details and preferences. The matchmaking engine scores how compatible two people are and suggests the best options, and every weight in that scoring lives in configuration so the product team can retune it without touching the code. Once two people accept each other they can chat in real time, and chat is delivered reliably even when several copies of the backend are running because the messages travel through Redis.

On the marketplace side, vendors list their services and couples search and review them, and an administrator approves vendors before they appear. Bookings move through a clear set of states from requested to paid to confirmed to completed, and the payment is held in escrow until the event is done. The planner creates a wedding timeline automatically from the wedding date. Couples manage several ceremonies with guest lists, invitations, responses and seating. They can browse honeymoon destinations and build an itinerary. They can create photo albums and share them through a public link. A helper called WOW Genie offers budget guidance and answers planning questions, and an administrator has a panel for approvals, disputes and simple analytics.

## Running it locally

The easiest way is with Docker. From the project folder run the script called deploy dash local, and it will start the database, the cache, the backend and the frontend, wait until everything is healthy, and print the web addresses. The command is written out in the setup guide inside the docs folder.

If you would rather not use Docker there is a second script that uses Homebrew to install PostgreSQL and Redis and then runs the backend directly with Node. The setup guide explains both paths step by step, along with how to run the automated tests.

Once everything is up you can open the application in your browser at the frontend address, read the API documentation at the Swagger address, and check that the service is healthy at the health address. All of these are listed in the setup guide.

## Configuration

Every value that an operator or a tester might want to change lives in environment variables rather than in the code. This includes the database and cache connection details, the security settings such as token lifetimes and rate limits, the matchmaking weights, and the choice of payment, storage and AI providers. The file called dot env dot example in the backend folder documents every setting, and the application checks these values when it starts so a mistake is caught immediately rather than later.

## Testing

The project ships with unit tests for the core logic, functional tests that exercise the real API against a real database and cache, and a load test that checks the response time under pressure. The setup guide in the docs folder explains how to run each of them.
