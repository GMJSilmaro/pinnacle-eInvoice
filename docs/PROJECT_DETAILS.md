# Project Summary: Pixelcare-e-Invoice-Middleware for LHDN - EXCEL VARIANT

## Overview
The **Pixelcare-e-Invoice-Middleware** is a specialized middleware solution designed to integrate business applications with LHDN's (Lembaga Hasil Dalam Negeri) e-Invoicing system. This middleware facilitates seamless invoice data exchange while ensuring compliance with Malaysian tax regulations. Key features include direct integration with LHDN's APIs, automated tax compliance checks, and support for major ERP and accounting systems.

## Languages, Frameworks, and Main Libraries Used
- **Languages**: JavaScript (Node.js)
- **Frameworks**: Express.js
- **Main Libraries**:
  - `axios`: For making HTTP requests
  - `express`: Web framework for Node.js
  - `sequelize`: ORM for database interaction
  - `dotenv`: For environment variable management
  - `jsonwebtoken`: For handling JSON Web Tokens
  - `jest`: For testing
  - `nodemon`: For automatic server restarts during development
  - `tailwindcss`: For utility-first CSS styling
  - `jsreport`: For reporting and document generation

## Purpose of the Project
The purpose of the project is to serve as a middleware that automates the submission and verification of electronic invoices in accordance with Malaysian tax requirements, ensuring compliance with the LHDN's technical specifications and providing a secure and efficient way to manage invoice data.

## Build and Configuration Files
- **Dockerfile**: `/Dockerfile`
- **Docker Compose Development**: `/docker-compose.dev.yml`
- **Docker Compose Production**: `/docker-compose.prod.yml`
- **Docker Compose Staging**: `/docker-compose.staging.yml`
- **Ecosystem Configuration**: `/ecosystem.config.js`
- **PostCSS Configuration**: `/postcss.config.js`
- **Tailwind Configuration**: `/tailwind.config.js`
- **Package Configuration**: `/package.json`

## Source Files Location
- Source files can primarily be found in the following directories:
  - `/src`
  - `/routes`
  - `/middleware`
  - `/services`
  - `/models`
  - `/utils`
  - `/views`

## Documentation Files Location
Documentation files are located in the `/docs` directory, which includes:
- `DETAILED_WORKFLOW.md`
- `GIT_WORKFLOW.md`
- `PROJECT_EXAMPLES.md`
- `PULL_REQUEST_TEMPLATE.md`
- `QUICKSTART.md`

## Summary
The Pixelcare-e-Invoice-Middleware project is a comprehensive solution for integrating with LHDN's e-invoicing system, built using Node.js and Express.js, and leveraging various libraries for functionality and styling. The project includes extensive documentation to assist developers in setting up and contributing to the middleware.