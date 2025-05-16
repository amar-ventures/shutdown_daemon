# Run as Administrator
$ServiceName = "ShutdownDaemon"
$BinPath = "$env:ProgramFiles\ShutdownDaemon"

# Create installation directory
New-Item -ItemType Directory -Force -Path $BinPath

# Copy files
Copy-Item "dist\shutdown-daemon-win.exe" -Destination $BinPath
Copy-Item ".env" -Destination $BinPath

# Create and start Windows service
New-Service -Name $ServiceName `
    -DisplayName "System Shutdown Daemon" `
    -Description "Remote system shutdown service" `
    -BinaryPathName "$BinPath\shutdown-daemon-win.exe" `
    -StartupType Automatic

Start-Service -Name $ServiceName

Write-Host "Installation complete! Service status:"
Get-Service -Name $ServiceName