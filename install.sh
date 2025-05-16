#!/bin/bash

# Create service directory if it doesn't exist
sudo mkdir -p /opt/shutdown-daemon

# Copy executable and env file
sudo cp dist/shutdown-daemon-linux /opt/shutdown-daemon/
sudo cp .env /opt/shutdown-daemon/

# Create systemd service file
cat << EOF | sudo tee /etc/systemd/system/shutdown-daemon.service
[Unit]
Description=System Shutdown Daemon
After=network.target

[Service]
ExecStart=/opt/shutdown-daemon/shutdown-daemon-linux
WorkingDirectory=/opt/shutdown-daemon
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable shutdown-daemon
sudo systemctl start shutdown-daemon

echo "Installation complete! Service status:"
sudo systemctl status shutdown-daemon