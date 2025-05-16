require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken, signInWithCredential, GoogleAuthProvider } = require('firebase/auth');
const { getDatabase, ref, onValue, set, serverTimestamp, get } = require('firebase/database');
const { exec } = require('child_process');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios'); // New import

// Constants
const CUSTOM_TOKEN_FILE = path.join(__dirname, '.customtoken');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'shutdown-daemon');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const PERMISSIONS = 0o600; // Read/write for owner only
const DEVICE_ID = os.hostname(); // Use hostname as device ID
const MIN_UPTIME_BEFORE_SHUTDOWN = 60000; // 1 minute in ms
const STATUS_UPDATE_INTERVAL = 60000; // 1 minute in ms
const SHUTDOWN_DELAY = 5000; // 5 second delay before shutdown
const TOKEN_REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
const MAX_RETRIES = 3;
let tokenRefreshInterval;

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let statusInterval;

// Function to ensure config directory exists
async function ensureConfigDir() {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
        return true;
    } catch (error) {
        console.error('Failed to create config directory:', error);
        throw error;
    }
}

// Function to store tokens securely
async function storeTokens(tokens) {
    try {
        await ensureConfigDir();
        await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), { 
            mode: PERMISSIONS 
        });
        console.log('Tokens stored securely');
    } catch (error) {
        console.error('Failed to store tokens:', error);
        throw error;
    }
}

// Function to read custom token from file
async function readCustomTokenFromFile() {
    try {
        const token = await fs.readFile(CUSTOM_TOKEN_FILE, 'utf8');
        const trimmedToken = token.trim();
        console.log('Successfully read custom token from file');
        
        // Optionally remove the file after reading to prevent reuse
        try {
            await fs.unlink(CUSTOM_TOKEN_FILE);
            console.log('Removed custom token file for security');
        } catch (removeError) {
            console.warn('Could not remove custom token file:', removeError.message);
        }
        
        return trimmedToken;
    } catch (error) {
        console.error('Failed to read custom token file:', error.message);
        throw new Error('Custom token file not found or invalid. Please create a customtoken.txt file with your token.');
    }
}

// Function to get the current user's UID
function getCurrentUID() {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
        console.error('User not authenticated or UID is missing.');
        return null;
    }
    return currentUser.uid;
}

// Function to update device status
async function updateDeviceStatus() {
    const uid = getCurrentUID();
    if (!uid) {
        console.error('Cannot update device status: No user ID found.');
        process.exit(1);
        return;
    }

    console.log(`Updating status for user: ${uid}, device: ${DEVICE_ID}`);
    const deviceRef = ref(database, `users/${uid}/devices/${DEVICE_ID}`);
    
    try {
        // First check if device exists
        const snapshot = await get(deviceRef);
        const existingData = snapshot.val();

        await set(deviceRef, {
            name: os.hostname(),
            status: 'on',
            last_seen: serverTimestamp(),
            // Only set first_online_at if it doesn't exist
            first_online_at: existingData?.first_online_at || Date.now()
        });
    } catch (error) {
        console.error(`Failed to update device status for ${uid}/${DEVICE_ID}:`, error);
    }
}

// Function to mark shutdown status
async function markShutdownStatus(status) {
    const uid = getCurrentUID();
    if (!uid) {
        console.error('Cannot mark shutdown status: No user ID found.');
        process.exit(1);
        return;
    }

    console.log(`Marking shutdown status as '${status}' for user: ${uid}, device: ${DEVICE_ID}`);
    const statusRef = ref(database, `users/${uid}/devices/${DEVICE_ID}/shutdown_requested`);
    try {
        await set(statusRef, {
            status: status,
            updated_at: serverTimestamp()
        });
    } catch (error) {
        console.error(`Failed to mark shutdown status for ${uid}/${DEVICE_ID}:`, error);
    }
}

// Function to shutdown the system
async function shutdownSystem() {
    console.log('Preparing for shutdown...');
    await markShutdownStatus('done');
    
    setTimeout(() => {
        console.log('Executing shutdown...');
        exec(process.env.SHUTDOWN_CMD || 'shutdown now', (error) => {
            if (error) {
                console.error('Error shutting down:', error);
            }
        });
    }, SHUTDOWN_DELAY);
}

// Function to start listening for shutdown requests
async function listenForShutdown() {
    const uid = getCurrentUID();
    if (!uid) {
        console.error('Cannot listen for shutdown requests: No user ID found.');
        process.exit(1);
        return;
    }

    console.log(`Listening for shutdown requests for user: ${uid}, device: ${DEVICE_ID}`);
    const shutdownRef = ref(database, `users/${uid}/devices/${DEVICE_ID}/shutdown_requested`);
    onValue(shutdownRef, async (snapshot) => {
        const request = snapshot.val();
        
        if (!request || request.status !== 'pending') {
            return;
        }

        if (request.expires_at && Date.now() > request.expires_at) {
            console.log(`Shutdown request expired for ${uid}/${DEVICE_ID}`);
            await markShutdownStatus('expired');
            return;
        }
        
        const deviceNodeRef = ref(database, `users/${uid}/devices/${DEVICE_ID}`);
        const deviceSnapshot = await get(deviceNodeRef);
        const deviceData = deviceSnapshot.val();

        if (deviceData && deviceData.first_online_at && (Date.now() - deviceData.first_online_at < MIN_UPTIME_BEFORE_SHUTDOWN)) {
            console.log(`System ${DEVICE_ID} for user ${uid} recently booted, skipping shutdown`);
            return;
        }

        console.log(`Valid shutdown request received for ${uid}/${DEVICE_ID}!`);
        await shutdownSystem();
    });
}

// Function to exchange custom token for ID and refresh tokens
async function exchangeCustomToken(customToken) {
    try {
        const response = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`,
            {
                token: customToken,
                returnSecureToken: true
            }
        );

        return {
            customToken,
            idToken: response.data.idToken,
            refreshToken: response.data.refreshToken,
            expiresAt: Date.now() + (parseInt(response.data.expiresIn) * 1000)
        };
    } catch (error) {
        console.error('Failed to exchange custom token:', error.response?.data || error.message);
        throw error;
    }
}

// Update the token refresh function
async function refreshIdToken(refreshToken) {
    try {
        const response = await axios.post(
            `https://securetoken.googleapis.com/v1/token?key=${process.env.FIREBASE_API_KEY}`,
            {
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }
        );

        // Important: Return both the new ID token and the refresh token
        return {
            customToken: null, // We don't need custom token anymore after initial auth
            idToken: response.data.id_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (parseInt(response.data.expires_in) * 1000)
        };
    } catch (error) {
        console.error('Failed to refresh token:', error.response?.data || error.message);
        throw error;
    }
}

// Update the startApp function's authentication flow
async function startApp() {
    try {
        let tokens;
        try {
            // Try to read existing tokens from secure storage
            await ensureConfigDir();
            const tokenData = await fs.readFile(TOKEN_FILE, 'utf8');
            tokens = JSON.parse(tokenData);
            console.log('Found stored tokens, attempting refresh...');
            
            // Refresh tokens if they're about to expire
            if (Date.now() > tokens.expiresAt - (5 * 60 * 1000)) {
                console.log('Tokens expired or expiring soon, refreshing...');
                tokens = await refreshIdToken(tokens.refreshToken);
                await storeTokens(tokens);
            }

            // Sign in with appropriate token
            if (tokens.customToken) {
                await signInWithCustomToken(auth, tokens.customToken);
            } else {
                const credential = GoogleAuthProvider.credential(null, tokens.idToken);
                await signInWithCredential(auth, credential);
            }
        } catch (error) {
            // If refresh fails or no tokens found, read from custom token file
            console.log('No valid stored tokens found. Reading from customtoken.txt...');
            
            try {
                const customToken = await readCustomTokenFromFile();
                
                // Sign in with custom token
                await signInWithCustomToken(auth, customToken);
                console.log('Successfully authenticated with custom token');
                
                // Exchange for ID/refresh tokens
                tokens = await exchangeCustomToken(customToken);
                await storeTokens(tokens);
            } catch (tokenError) {
                console.error('Authentication failed:', tokenError.message);
                console.log('Please create a customtoken.txt file with your custom token.');
                process.exit(1);
            }
        }

        console.log('Successfully authenticated!');

        // Setup token refresh interval
        tokenRefreshInterval = setInterval(async () => {
            try {
                if (Date.now() > tokens.expiresAt - (5 * 60 * 1000)) {
                    console.log('Refreshing tokens...');
                    tokens = await refreshIdToken(tokens.refreshToken);
                    await storeTokens(tokens);
                    
                    // Sign in with new ID token
                    const credential = GoogleAuthProvider.credential(null, tokens.idToken);
                    await signInWithCredential(auth, credential);
                    console.log('Tokens refreshed successfully');
                }
            } catch (error) {
                console.error('Token refresh failed:', error);
                process.exit(1);
            }
        }, 60000);

        // Start the rest of the application
        const uid = getCurrentUID();
        if (!uid) {
            throw new Error("No UID found after authentication");
        }
        console.log(`Authenticated as user: ${uid}`);

        await updateDeviceStatus();
        statusInterval = setInterval(updateDeviceStatus, STATUS_UPDATE_INTERVAL);
        listenForShutdown();

    } catch (error) {
        console.error('Startup error:', error);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log('\nGracefully shutting down daemon...');
    if (statusInterval) clearInterval(statusInterval);
    if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
    
    const uid = getCurrentUID();
    if (uid) {
        try {
            const deviceRef = ref(database, `users/${uid}/devices/${DEVICE_ID}`);
            await set(ref(database, `users/${uid}/devices/${DEVICE_ID}/status`), 'off');
            await set(ref(database, `users/${uid}/devices/${DEVICE_ID}/last_seen`), serverTimestamp());
            console.log(`Device status for ${uid}/${DEVICE_ID} updated to offline.`);
        } catch (error) {
            console.error('Error updating device status during shutdown:', error);
        }
    }
    process.exit(0);
});

startApp();