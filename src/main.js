const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, clipboard, nativeImage, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

let mainWindow;
let captureWindow;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  
  // Hide the window instead of closing it when the user clicks the close button
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
}

function createTray() {
  // Create a tray icon
  const iconPath = path.join(__dirname, '../assets/icon.icns');
  // For development, we can use a default icon if the custom one doesn't exist
  const trayIcon = fs.existsSync(iconPath) ? 
    nativeImage.createFromPath(iconPath) : 
    nativeImage.createFromPath(path.join(__dirname, '../assets/tray-icon.png'));
  
  // If we're on macOS, make the icon template so it works with dark mode
  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  }
  
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Screen Capture');
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Take Screenshot (⌥⇧3)', 
      click: () => { takeScreenshot(); } 
    },
    { 
      label: 'Open App', 
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      } 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // On macOS, click on the tray icon to show the app
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function createCaptureWindow() {
  // Get the primary display dimensions
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  captureWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  captureWindow.loadFile(path.join(__dirname, '../dist/capture.html'));
  // Don't use setFullScreen to avoid Mission Control issues
  // Instead, size the window to match the screen
}

// Function to initiate screenshot capture
function takeScreenshot() {
  // Check if mainWindow exists and is not destroyed
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    
    // Small delay to ensure the window is fully hidden
    setTimeout(() => {
      createCaptureWindow();
    }, 100);
  } else {
    // If mainWindow doesn't exist or is destroyed, create a new one
    createWindow();
    
    // Wait for the window to be ready before hiding it
    mainWindow.once('ready-to-show', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
          createCaptureWindow();
        }
      }, 500);
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register global shortcut (Option-Shift-3)
  globalShortcut.register('Alt+Shift+3', () => {
    takeScreenshot();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Unregister shortcuts when app is about to quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Keep the app running in the background when all windows are closed
app.on('window-all-closed', function () {
  // On macOS, keep the app running in the background
  if (process.platform !== 'darwin') {
    // On other platforms, quit the app
    app.quit();
  }
});

// Handle the screenshot capture request
ipcMain.on('capture-screen', () => {
  takeScreenshot();
});

// Handle the completed capture
ipcMain.on('capture-completed', (event, bounds) => {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  
  // Use desktopCapturer to get the screen content
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    .then(async sources => {
      const source = sources[0]; // Get the primary screen
      
      // Show the main window again if it exists and is not destroyed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        
        mainWindow.webContents.send('capture-image', {
          sourceId: source.id,
          bounds: bounds
        });
      } else {
        // If mainWindow doesn't exist or is destroyed, create a new one
        createWindow();
        
        // Wait for the window to be ready before sending the capture
        mainWindow.once('ready-to-show', () => {
          mainWindow.show();
          mainWindow.webContents.send('capture-image', {
            sourceId: source.id,
            bounds: bounds
          });
        });
      }
    });
});

// Handle capture cancellation
ipcMain.on('capture-cancelled', () => {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
  }
  
  // Show the main window again if it exists and is not destroyed
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

// Handle copying image to clipboard
ipcMain.on('copy-to-clipboard', (event, imageDataUrl) => {
  try {
    // Convert the data URL to a Buffer
    const imageBuffer = Buffer.from(imageDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    
    // Create a native image from the buffer
    const image = nativeImage.createFromBuffer(imageBuffer);
    
    // Copy the image to the clipboard
    clipboard.writeImage(image);
    
    // Send success status back to renderer if mainWindow exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-status', 'Image copied to clipboard');
    }
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-status', 'Failed to copy to clipboard');
    }
  }
});

// Handle image upload to your short domain service
ipcMain.on('upload-image', async (event, imageData) => {
  try {
    // Save image temporarily
    const tempPath = path.join(app.getPath('temp'), 'screenshot.png');
    fs.writeFileSync(tempPath, Buffer.from(imageData.replace(/^data:image\/png;base64,/, ''), 'base64'));
    
    // Upload to your short domain service - replace with your actual API endpoint
    const form = new FormData();
    form.append('image', fs.createReadStream(tempPath));
    
    const response = await axios.post('https://your-short-domain.com/api/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer YOUR_API_KEY' // Replace with your API key
      }
    });
    
    // Send the response URL back to the renderer if mainWindow exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-complete', response.data.url);
    }
    
    // Clean up temp file
    fs.unlinkSync(tempPath);
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-error', error.message);
    }
  }
}); 