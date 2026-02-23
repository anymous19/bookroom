# Deployment Guide

This application is a full-stack Node.js application with a React frontend and SQLite database.

## Prerequisites

- Node.js 20+
- Docker (optional, but recommended)
- A cloud provider (Render, Railway, Fly.io, DigitalOcean, etc.)

## Environment Variables

Create a `.env` file based on `.env.example`.
For production, set:
- `NODE_ENV=production`
- `PORT=3000` (or whatever port your host provides)

## Deployment Options

### Option 1: Docker (Recommended)

1. Build the image:
   ```bash
   docker build -t room-booking-app .
   ```

2. Run the container:
   ```bash
   docker run -p 3000:3000 -v $(pwd)/data:/app/data room-booking-app
   ```
   *Note: We mount a volume to persist the SQLite database.*

### Option 2: Render.com

1. Create a new Web Service on Render.
2. Connect your GitHub repository.
3. Use the following settings:
   - **Runtime:** Docker
   - **Build Command:** (leave empty, uses Dockerfile)
   - **Start Command:** (leave empty, uses Dockerfile)
4. Add a Disk (Persistent Storage):
   - **Mount Path:** `/app/data` (You may need to update the database path in `server.ts` to use this path if you want persistence)
   - **Size:** 1GB (sufficient for SQLite)

### Option 3: Railway.app

1. Create a new project on Railway.
2. Deploy from GitHub repo.
3. Add a Volume:
   - **Mount Path:** `/app` (or specific data directory)
4. Railway automatically detects the `Dockerfile` and builds it.

### Option 4: Manual VPS (Ubuntu/Debian)

1. Install Node.js 20+:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. Clone the repo and install dependencies:
   ```bash
   git clone <your-repo-url>
   cd <your-repo-dir>
   npm install
   ```

3. Build the frontend:
   ```bash
   npm run build
   ```

4. Start the server (using PM2 for process management):
   ```bash
   sudo npm install -g pm2
   pm2 start npm --name "room-booking" -- start
   ```

## Database Persistence

The application uses SQLite (`booking.db`).
- In development, it's stored in the project root.
- In production, ensure the file is stored on a persistent volume if using a container platform (Render, Railway, Fly.io).
- If using a VPS, the file is stored on the disk automatically.

To change the database location, update `server.ts`:
```typescript
const dbPath = process.env.DB_PATH || 'booking.db';
const db = new Database(dbPath);
```
Then set `DB_PATH=/app/data/booking.db` in your environment variables.
