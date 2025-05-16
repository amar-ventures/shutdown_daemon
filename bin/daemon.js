#!/usr/bin/env node

// Windows-specific shutdown command
if (process.platform === 'win32') {
    process.env.SHUTDOWN_CMD = 'shutdown /s /f /t 0';
} else {
    process.env.SHUTDOWN_CMD = 'shutdown now';
}

require('../app2.js');