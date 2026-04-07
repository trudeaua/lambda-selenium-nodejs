#!/usr/bin/bash
set -e

# Chrome for Testing (115+ uses new download URLs)
# https://googlechromelabs.github.io/chrome-for-testing/
CHROME_VERSION="131.0.6778.204"
BASE_URL="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64"

CHROME_URL="${BASE_URL}/chrome-linux64.zip"
CHROME_DRIVER_URL="${BASE_URL}/chromedriver-linux64.zip"

# install chrome
mkdir -p "/opt/chrome"
curl -Lo "/tmp/chrome-linux64.zip" "$CHROME_URL"
unzip -q "/tmp/chrome-linux64.zip" -d "/opt/chrome"

# install chrome-driver
mkdir -p "/opt/chromedriver"
curl -Lo "/tmp/chromedriver-linux64.zip" "$CHROME_DRIVER_URL"
unzip -q "/tmp/chromedriver-linux64.zip" -d "/opt/chromedriver"
chmod +x "/opt/chromedriver/chromedriver-linux64/chromedriver"

# cleanup
rm -f "/tmp/chrome-linux64.zip" "/tmp/chromedriver-linux64.zip"
