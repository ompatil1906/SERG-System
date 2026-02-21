# Running SERG Locally

Here are the step-by-step instructions to run the Smart Emergency Response System (SERG) locally on your machine.

### Prerequisites
1. Node.js installed on your machine.
2. A Firebase account with a Firestore database created. (See `/docs/deploy.md` for Firebase Setup)
3. A Google Maps API Key.

---

### Step 1: Start the Backend Server

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```
2. **Setup your environment variables:**
   Duplicate the `.env.example` file and rename it to `.env`. Fill in at least your Firebase credentials.
   ```bash
   cp .env.example .env
   ```
3. **Start the server:**
   ```bash
   node server.js
   ```
   *The server should now be running on `http://localhost:3000`.*

---

### Step 2: Start the Frontend Dashboard

1. **Open a new terminal window/tab.**
2. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```
3. **Setup your environment variables:**
   Duplicate the `.env.local.example` file, rename it to `.env.local`, and paste in your Firebase configuration keys and Google Maps API key.
   ```bash
   cp .env.local.example .env.local
   ```
4. **Start the development server:**
   ```bash
   npm run dev
   ```
   *The Next.js dashboard will be accessible at `http://localhost:3001` (or whichever port it allocates).*

---

### Step 3: Send Test Telemetry Data

Now that the backend and frontend are running, you can simulate ESP32 hardware sending data.

1. **Open a third terminal window/tab.**
2. **Navigate to the tests directory:**
   ```bash
   cd tests
   ```
3. **Run the mock data generator script:**
   ```bash
   node gen_mock_data.js
   ```

### Step 4: View the Real-Time Dashboard
Open your browser and navigate to the frontend URL (usually `http://localhost:3001`). As the mock script runs, you will see devices popping up on the map. Every 10 seconds, an accident will be simulated, triggering a red alert on the dashboard!
