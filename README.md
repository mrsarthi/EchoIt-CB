# Echo Developer Guide

This guide provides technical instructions for setting up, running, and building the Echo signalling server, web client, desktop application, and mobile application.

---

## Prerequisites
Ensure the following tools are installed on your machine:
*   [Node.js](https://nodejs.org/) (v18.x or higher)
*   [npm](https://www.npmjs.com/) (v9.x or higher)
*   [PostgreSQL](https://www.postgresql.org/) (running locally or hosted database)
*   [Android Studio & Android SDK](https://developer.android.com/studio) (required only for mobile builds)

---

## Environment Configuration

### 1. Backend Signalling Server (`server/.env`)
Create a `.env` file inside the `server/` directory:
```env
PORT=3009
DATABASE_URL=postgresql://username:password@localhost:5432/echo_db
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,decentrachat://app,decentrachat://
```
*(Note: `decentrachat://` is the internal custom protocol scheme used by the Electron packaging system).*

### 2. Frontend Client (`.env`)
Create a `.env` file in the root directory:
```env
VITE_RELAY_URL=http://localhost:3009
```

---

## Running the Signalling Server
The signalling server handles username routing, key bundle delivery, offline queues, and presence synchronization.

1. Navigate to the server folder:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run database migrations:
   ```bash
   npm run migrate
   ```
4. Start the server in development mode (nodemon hot-reloading):
   ```bash
   npm run dev
   ```
   *The server will start listening on port `3009`.*

---

## Running the Web Client
The web client runs inside standard modern browsers.

1. Navigate to the root directory:
   ```bash
   cd ..
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *Open [http://localhost:5173](http://localhost:5173) in your browser.*

---

## Running & Building the Desktop App (Electron)
The desktop application is built with Electron.

*   **Run Desktop App in Development Mode**:
    ```bash
    npm run electron:dev
    ```
*   **Build Production Installer (Windows/Mac/Linux)**:
    ```bash
    npm run electron:build
    ```
    *The built binaries and installer setup executables will be output to the `release/` directory.*

---

## Building the Mobile App (Capacitor Android)
The mobile app compiles using Capacitor.

1. Build the production web bundle and sync assets:
   ```bash
   npm run android:build
   ```
2. Open the project in Android Studio to build and run the APK:
   ```bash
   npm run cap:open
   ```
   *From Android Studio, click **Run** to deploy to a connected device or emulator.*
