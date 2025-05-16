# Firebase-Powered Device Management Architecture

## 🏗️ Architecture Overview

* Devices (clients) run a background daemon that connects to Firebase Realtime Database.
* Each device is registered with a unique token that maps to its entry in the database.
* Daemon updates status, listens for shutdown requests, and acts on them.
* Web frontend interacts directly with Firebase to send shutdown commands and check device status.

---

## 🔐 Authentication

* One API route in backend: `generate-token`

  * When setting up the daemon for the first time, token is requested and stored locally.
  * This token uniquely identifies and authenticates the daemon with Firebase.

---

## 🌐 Database Structure (Firebase Realtime DB)

```json
/devices/{device_id}:
  token: string
  name: string
  last_seen: timestamp
  status: "on" | "off" | "unknown"
  shutdown_requested:
    status: "pending" | "done" | "expired"
    requested_at: timestamp (from server)
    expires_at: timestamp
```

---

## 📡 Daemon Behavior

* Runs on startup (as systemd or background service)
* Fetches stored token from file (or requests it if not found)
* Registers device and pushes online status + `last_seen`
* Subscribes to changes in `/devices/{device_id}/shutdown_requested`

  * When `status == "pending"` and `Date.now() < expires_at`, it initiates shutdown
  * Marks status as `done` before actual shutdown (use delay)
* Updates `last_seen` every minute

---

## 🖥️ Frontend Features

* Show list of registered devices
* Show color-coded status:

  * Green = `on` + active (last seen < 1 min ago)
  * Yellow = `on` but idle (last seen > 5 min ago)
  * Red = `off`
* Send shutdown request only if no `pending` request exists

  * Sets: `status: pending`, `requested_at: now`, `expires_at: now + grace_period`
* Listen to shutdown request updates to show UI feedback (e.g., progress, cancelled)

---

## ⚠️ Edge Case Handling

### 1. Device Already Off When Shutdown Requested

* Grace period field `expires_at` ensures shutdown is ignored if daemon boots too late
* Daemon checks: `Date.now() > expires_at` → mark `expired`, skip shutdown

### 2. Duplicate Requests from Frontend

* Frontend checks if status is already `pending` before allowing new request
* Disable shutdown button during grace period

### 3. Device Turns On Just Before Grace Period Ends

* Add delay buffer before executing shutdown
* Use device-local `first_online_at`, and only shutdown if uptime > 1 min

### 4. Daemon Doesn’t Mark Status as Done

* Always mark `status = done` *before* initiating shutdown with `setTimeout`

### 5. Daemon Offline or Unreachable

* Use `last_seen` to track device liveness
* UI updates accordingly

### 6. Token Errors or Device Unregistered

* Store token in file and retry with backoff if invalid

### 7. Clock Skew

* Use server timestamp from Firebase to create `requested_at` and `expires_at`
* Add tolerance buffer on client (e.g., ±5s)

---

## ✅ Summary of Design Improvements

* Only one backend API endpoint: `generate-token`
* Daemon handles status updates + listening to shutdown
* Frontend only sends requests and visualizes status
* All communication and triggers are event-driven using Firebase's Realtime DB
* Grace periods, duplicate protections, and client-side guards added to reduce risk
