# Shutdown Daemon

## Building
```bash
# Install dependencies
npm install

# Build for both platforms
npm run build

# Or build for specific platform
npm run build:linux
npm run build:windows
```

## Installation

### Linux
1. Build the daemon:
   ```bash
   npm run build:linux
   ```
2. Run the installer:
   ```bash
   sudo ./install-linux.sh
   ```
3. Check service status:
   ```bash
   sudo systemctl status shutdown-daemon
   ```

### Windows
1. Build the daemon:
   ```bash
   npm run build:windows
   ```
2. Open PowerShell as Administrator
3. Run the installer:
   ```powershell
   .\install-windows.ps1
   ```
4. Check service status:
   ```powershell
   Get-Service ShutdownDaemon
   ```

## Configuration
1. Create `.env` file with Firebase credentials
2. Place `.env` in:
   - Linux: `/opt/shutdown-daemon/`
   - Windows: `C:\Program Files\ShutdownDaemon\`