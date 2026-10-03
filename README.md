# Ucompiler 🚀

**Ucompiler** is a blazing-fast, serverless, web-based C Compiler designed and built by **UditNath Singh**. 

It provides an authentic, real-time terminal experience mirroring desktop editors like VS Code, straight from your web browser. Ucompiler handles dynamic C inputs (like `scanf`), streams process outputs concurrently, and prevents CPU overload using a robust zero-cost serverless architecture.

## 🌟 Features
- **Real-Time Interactive Terminal**: Powered by `XTerm.js`, inputs and outputs stream to the user seamlessly just like a native bash/zsh shell.
- **Dynamic C Execution**: Fully supports complex C programs requesting intermediate keyboard input from the user (completely bypassing standard pipe-buffering issues).
- **Secure Google Authentication**: Firebase Auth prevents bot abuse, locking code execution firmly behind secure Google identity verification.
- **Bulletproof Architecture**: Auto-kills hung scripts or infinite loops after 60 seconds. Generates dedicated isolated temp directories per execution.
- **Scale-to-Zero Deployment**: Dockerized container scales dynamically to handle concurrency and scales to $0 at idle.

## 🛠️ Tech Stack
### Frontend (UI)
* **HTML5 / Vanilla JS** — Lightweight and ultra-fast.
* **Tailwind CSS** — Modern, clean dark-mode UI styling.
* **XTerm.js** — The same terminal emulator rendering engine powering VS Code.
* **Firebase Auth Client** — Handshakes with Google for JWT identity tokens.
* **Cloud Hosting**: Deployed globally via **Vercel** CDN.

### Backend (Execution Engine)
* **Node.js & Express** — Handles WebSocket upgrade routing.
* **WebSockets (`ws`)** — Bi-directional constant streaming tunnel between the browser and the compiler environment.
* **Firebase Admin SDK** — Verifies JWT tokens and strictly enforces user quota limits per day.
* **GCC Compiler** — Native GNU Compiler Collection dynamically invoked via Node's `child_process`.
* **Cloud Hosting**: Packaged via **Docker** (Ubuntu 22.04) and deployed securely on **Render** / **Google Cloud Run**.

## 🧠 How It Works Behind The Scenes
1. **Authentication:** The user logs in via Google Popup. Firebase provides a short-lived secure JWT, which the frontend passes to the backend to upgrade to a WebSocket connection.
2. **Rate Limiting:** The backend verifies the token locally without an extra database hop and confirms the user hasn't exceeded the daily compilation limit.
3. **Execution Isolation:** A unique temporary `/tmp` payload directory is generated for the incoming code pipeline.
4. **The Buffer By-pass Trick:** To ensure functions like `printf("Enter your name: ");` display on the webpage *before* `scanf` locks the process waiting for an answer, the Node.js server automatically injects a C-constructor macro (`setvbuf`) into the compiled environment. This forces `libc` to use ultra-fast Line/No-Buffering over raw pipes rather than Block-Buffering.
5. **Interactive Streaming:** `child_process.spawn` executes the compiled binary. Standard input, output, and error pipelines are bridged straight back through the WebSocket directly to the student's browser. 
6. **Graceful Cleanup:** Regardless of a successful exit, compilation failure, or an infinite loop timing out at 60 seconds, the server aggressively wipes the specific `/tmp` directory associated with the task keeping the Docker container completely stateless.

## 💻 Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/UditNathSingh/Ucompiler.git
   cd Ucompiler
   ```
2. **Install Dependencies:**
   ```bash
   npm install
   ```
3. **Set up Firebase Admin Credentials:**
   * Create a Firebase project and generate an Admin SDK Service Account JSON Key.
   * Drop the file in the root directory named as `serviceAccountKey.json`.
4. **Start the Server:**
   ```bash
   npm start
   ```
5. **Visit `http://localhost:3000`** in your browser!

---
*Built with ❤️ by [UditNath Singh](https://github.com/UditNathSingh)*
