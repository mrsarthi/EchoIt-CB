# Echo (formerly DecentraChat)

**A decentralized, local-first, end-to-end encrypted messaging application where you own your identity and your conversations.**

---

## Table of Contents
1. [What is Echo?](#what-is-echo)
2. [Key Features](#key-features)
3. [How It Works (For Users)](#how-it-works-for-users)
4. [Developer Guide](#developer-guide)
   - [Prerequisites](#prerequisites)
   - [Environment Configuration](#environment-configuration)
   - [Running the Signalling Server](#running-the-signalling-server)
   - [Running the Web Client](#running-the-web-client)
   - [Running & Building the Desktop App (Electron)](#running--building-the-desktop-app-electron)
   - [Building the Mobile App (Capacitor Android)](#building-the-mobile-app-capacitor-android)

---

## What is Echo?
Echo is a secure messaging application that gives you full ownership over your accounts and data. Unlike traditional messaging platforms (like WhatsApp, Telegram, or Signal) that rely on centralized databases and server-side authentication, Echo operates on a **decentralized, local-first architecture**. 

Your identity is verified using cryptographic signatures, your databases run locally on your device, and messages are encrypted before they ever leave your machine.

---

## Key Features

*   **Self-Sovereign Identity**: No phone numbers, email addresses, or personal info required. Your identity is your Ethereum wallet address, authenticated securely using a digital signature.
*   **Immutable Usernames**: Choose a custom username when registering. Usernames are immutably tied to your wallet address on the signalling directory.
*   **End-to-End Encryption (E2EE)**: All communications are encrypted using a double-ratchet key exchange protocol. No one—not even the relay nodes—can read your messages.
*   **Local-First Database**: Messages and sessions are stored in a local, encrypted SQLite/IndexedDB database on your device. You have 100% data ownership.
*   **Real-Time Presence & Bouncing Indicators**: Live online indicators track active users. WhatsApp-style bouncing-dot typing indicators show when peers are typing.
*   **Optimized Group Read Receipts**: Read receipts are routed *only* to the sender of the message to save bandwidth and E2EE packet overhead. Active reader profile avatars are displayed under messages.
*   **Media Sharing**: Share images securely, fully encrypted in transit.

---

## How It Works (For Users)

1.  **Register your Identity**: 
    Log in using your MetaMask wallet. Sign the digital signature request to verify ownership of your address, and choose an immutable username.
2.  **Add Contacts**: 
    Copy your wallet address from the profile menu and share it with friends. Search your friends' usernames or addresses to start a chat.
3.  **Chat Privately**: 
    Start a conversation! All 1-1 chats, group chats, and shared media are fully end-to-end encrypted.
4.  **Create Groups**: 
    Invite multiple contacts to a secure group chat to message together.

---

## Developer Guide

### Prerequisites
Make sure you have the following installed on your machine:
*   [Node.js](https://nodejs.org/) (v18.x or higher)
*   [npm](https://www.npmjs.com/) (v9.x or higher)
*   [PostgreSQL](https://www.postgresql.org/) (running locally or hosted on Neon/AWS)
*   [Android Studio & Android SDK](https://developer.android.com/studio) (only if compiling the Android app)

---

### Environment Configuration

#### 1. Backend Signalling Server (`server/.env`)
Create a `.env` file inside the `server/` directory:
```env
PORT=3009
DATABASE_URL=postgresql://username:password@localhost:5432/decentrachat
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,decentrachat://app,decentrachat://
```

#### 2. Frontend Client (`.env`)
Create a `.env` file in the root directory:
```env
VITE_RELAY_URL=http://localhost:3009
```

---

### Running the Signalling Server
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
4. Start the server in development mode (with hot-reloading):
   ```bash
   npm run dev
   ```
   *The server will start listening on port `3009`.*

---

### Running the Web Client
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

### Running & Building the Desktop App (Electron)
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

### Building the Mobile App (Capacitor Android)
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
