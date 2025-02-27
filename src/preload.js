// Preload script
const { contextBridge, ipcRenderer } = require('electron');
const remote = require('@electron/remote');

// Log any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  // Try to log to file if possible
  try {
    const fs = require('fs');
    const path = require('path');
    const userData = remote.app.getPath('userData');
    const logFile = path.join(userData, 'uncaught-exceptions.log');
    
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [UNCAUGHT] ${error.stack || error.message}`;
    
    fs.appendFileSync(logFile, logMessage + '\n');
  } catch (logError) {
    console.error('Failed to log uncaught exception:', logError);
  }
});

// Initialize any required modules
console.log('Preload script executed'); 