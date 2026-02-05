#!/bin/bash

# x402 Cover Letter Generator - Run Script
# This script ensures the server runs on the correct port

echo "Starting x402 Cover Letter Generator..."
echo "=================================="

# Set the port (override any existing PORT env var)
export PORT=3456

# Check if TypeScript is available
if command -v tsx &> /dev/null; then
    echo "Running with tsx (TypeScript)..."
    tsx index.ts
else
    echo "Running with Node.js..."
    node server.js
fi