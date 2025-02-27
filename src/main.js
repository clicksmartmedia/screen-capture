const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, clipboard, nativeImage, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const remoteMain = require('@electron/remote/main');

// Initialize remote module
remoteMain.initialize();

// Add logging functionality
const logFile = path.join(app.getPath('userData'), 'app.log');

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type}] ${message}`;
  
  // Log to console
  console.log(logMessage);
  
  // Log to file
  try {
    fs.appendFileSync(logFile, logMessage + '\n');
  } catch (error) {
    console.error(`Failed to write to log file: ${error.message}`);
  }
}

// Log app start
log(`App starting. Version: ${app.getVersion()}, Platform: ${process.platform}`);

let mainWindow;
let captureWindow;
let tray = null;

function createWindow() {
  log('Creating main window');
  try {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: path.join(__dirname, 'preload.js')
      },
    });

    // Enable remote module for this window
    remoteMain.enable(mainWindow.webContents);

    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    
    // Hide the window instead of closing it when the user clicks the close button
    mainWindow.on('close', (event) => {
      log('Main window close event triggered');
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        log('Main window hidden instead of closed');
        return false;
      }
      log('Main window closing');
      return true;
    });
    
    mainWindow.webContents.on('did-finish-load', () => {
      log('Main window loaded successfully');
    });
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log(`Main window failed to load: ${errorDescription}`, 'ERROR');
    });
  } catch (error) {
    log(`Error creating main window: ${error.message}`, 'ERROR');
  }
}

function createTray() {
  log('Creating tray icon');
  try {
    // Try multiple possible icon paths to handle both development and production builds
    const possibleIconPaths = [
      path.join(__dirname, '../assets/tray-icon.png'),  // Development path
      path.join(process.resourcesPath, 'assets/tray-icon.png'),  // Production path (electron-builder)
      path.join(app.getAppPath(), 'assets/tray-icon.png'),  // Alternative path
      path.join(__dirname, '../assets/icon.icns')  // Try the app icon as fallback
    ];
    
    let iconPath = null;
    for (const testPath of possibleIconPaths) {
      log(`Testing icon path: ${testPath}`);
      if (fs.existsSync(testPath)) {
        iconPath = testPath;
        log(`Found icon at: ${iconPath}`);
        break;
      }
    }
    
    if (!iconPath) {
      log('No icon file found, creating empty icon', 'WARNING');
      // Create a simple 16x16 icon as fallback
      const emptyIcon = nativeImage.createEmpty();
      tray = new Tray(emptyIcon);
    } else {
      // Create the icon and resize it properly for the menubar
      const trayIcon = nativeImage.createFromPath(iconPath);
      
      // For macOS, we need a small icon (16x16 or 18x18 is ideal)
      const resizedIcon = trayIcon.resize({ 
        width: 16, 
        height: 16 
      });
      
      // For macOS, set as template image for proper dark/light mode handling
      if (process.platform === 'darwin') {
        resizedIcon.setTemplateImage(true);
      }
      
      // Create the tray with the properly sized icon
      tray = new Tray(resizedIcon);
    }
    
    tray.setToolTip('Screen Capture');
    
    // Create a simple menu
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'Take Screenshot (⌥⇧3)', 
        click: () => { 
          log('Screenshot requested from tray menu');
          takeScreenshot(); 
        } 
      },
      { 
        label: 'Open App', 
        click: () => {
          log('Open app requested from tray menu');
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            log('Main window shown and focused');
          } else {
            log('Main window does not exist, creating new one');
            createWindow();
          }
        } 
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => {
          log('Quit requested from tray menu');
          quitApp();
        } 
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    log('Tray context menu set');
    
    // On macOS, click on the tray icon to show the app
    tray.on('click', () => {
      log('Tray icon clicked');
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        log('Main window shown and focused from tray click');
      } else {
        log('Main window does not exist, creating new one from tray click');
        createWindow();
      }
    });
    
    log('Tray created successfully');
  } catch (error) {
    log(`Error creating tray: ${error.message}`, 'ERROR');
  }
}

function createCaptureWindow() {
  log('Creating capture window');
  try {
    // Get the primary display dimensions
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    log(`Screen dimensions: ${width}x${height}`);
    
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
        preload: path.join(__dirname, 'preload.js')
      },
    });

    // Enable remote module for this window
    remoteMain.enable(captureWindow.webContents);

    const captureHtmlPath = path.join(__dirname, '../dist/capture.html');
    log(`Loading capture HTML from: ${captureHtmlPath}`);
    
    captureWindow.loadFile(captureHtmlPath);
    
    captureWindow.webContents.on('did-finish-load', () => {
      log('Capture window loaded successfully');
    });
    
    captureWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log(`Capture window failed to load: ${errorDescription}`, 'ERROR');
    });
  } catch (error) {
    log(`Error creating capture window: ${error.message}`, 'ERROR');
  }
}

// Function to initiate screenshot capture
function takeScreenshot() {
  log('Taking screenshot');
  try {
    // Check if mainWindow exists and is not destroyed
    if (mainWindow && !mainWindow.isDestroyed()) {
      log('Hiding main window before capture');
      mainWindow.hide();
      
      // Small delay to ensure the window is fully hidden
      setTimeout(() => {
        log('Creating capture window after delay');
        createCaptureWindow();
      }, 100);
    } else {
      // If mainWindow doesn't exist or is destroyed, create a new one
      log('Main window does not exist or is destroyed, creating new one');
      createWindow();
      
      // Wait for the window to be ready before hiding it
      mainWindow.once('ready-to-show', () => {
        log('Main window ready, preparing for capture');
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            log('Hiding main window and creating capture window');
            mainWindow.hide();
            createCaptureWindow();
          } else {
            log('Main window was destroyed during delay', 'WARNING');
          }
        }, 500);
      });
    }
  } catch (error) {
    log(`Error taking screenshot: ${error.message}`, 'ERROR');
  }
}

// Function to check screen capture permissions
async function checkScreenCapturePermissions() {
  log('Checking screen capture permissions');
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    if (sources && sources.length > 0) {
      log(`Found ${sources.length} screen sources, permissions OK`);
      return true;
    } else {
      log('No screen sources found, may need permissions', 'WARNING');
      return false;
    }
  } catch (error) {
    log(`Error checking screen capture permissions: ${error.message}`, 'ERROR');
    return false;
  }
}

// Function to show a dialog about screen recording permissions on macOS
function showScreenRecordingPermissionDialog() {
  log('Showing screen recording permission dialog');
  dialog.showMessageBox({
    type: 'info',
    title: 'Screen Recording Permission Required',
    message: 'Screen Capture Tool needs screen recording permission',
    detail: 'Please grant screen recording permission in System Preferences > Security & Privacy > Privacy > Screen Recording.\n\nAfter granting permission, you may need to restart the app.',
    buttons: ['Open System Preferences', 'OK'],
    defaultId: 0
  }).then(result => {
    if (result.response === 0) {
      // Open System Preferences to the Screen Recording section
      const command = 'open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
      require('child_process').exec(command);
      log('Opened System Preferences to Screen Recording section');
    }
  }).catch(err => {
    log(`Error showing permission dialog: ${err.message}`, 'ERROR');
  });
}

app.whenReady().then(async () => {
  log('App is ready');
  
  // Check screen capture permissions
  const hasPermissions = await checkScreenCapturePermissions();
  if (!hasPermissions) {
    log('Screen capture permissions may be missing', 'WARNING');
    // On macOS, we might need to request screen recording permission
    if (process.platform === 'darwin') {
      log('On macOS, screen recording permission may need to be granted');
      showScreenRecordingPermissionDialog();
    }
  }
  
  createWindow();
  createTray();

  // Register global shortcut (Option-Shift-3)
  try {
    // On macOS, use Option+Shift+3, on other platforms use Alt+Shift+3
    const shortcutKey = process.platform === 'darwin' ? 'Option+Shift+3' : 'Alt+Shift+3';
    log(`Registering global shortcut: ${shortcutKey}`);
    
    const registered = globalShortcut.register(shortcutKey, () => {
      log(`Screenshot shortcut (${shortcutKey}) triggered`);
      takeScreenshot();
    });
    
    if (registered) {
      log('Global shortcut registered successfully');
    } else {
      log('Failed to register global shortcut', 'ERROR');
      
      // Try alternative shortcut if the first one fails
      const altShortcutKey = 'CommandOrControl+Shift+3';
      log(`Trying alternative shortcut: ${altShortcutKey}`);
      
      const altRegistered = globalShortcut.register(altShortcutKey, () => {
        log(`Alternative screenshot shortcut (${altShortcutKey}) triggered`);
        takeScreenshot();
      });
      
      if (altRegistered) {
        log('Alternative global shortcut registered successfully');
      } else {
        log('Failed to register alternative shortcut', 'ERROR');
      }
    }
  } catch (error) {
    log(`Error registering shortcut: ${error.message}`, 'ERROR');
  }

  app.on('activate', function () {
    log('App activated');
    if (BrowserWindow.getAllWindows().length === 0) {
      log('No windows found, creating main window');
      createWindow();
    }
  });
}).catch(error => {
  log(`Error during app initialization: ${error.message}`, 'ERROR');
});

// Add a before-quit handler to ensure proper cleanup
app.on('before-quit', () => {
  log('App before-quit event triggered');
  app.isQuitting = true;
});

// Unregister shortcuts when app is about to quit
app.on('will-quit', () => {
  log('App will quit, cleaning up');
  globalShortcut.unregisterAll();
  
  // Destroy tray if it exists
  if (tray) {
    log('Destroying tray on quit');
    tray.destroy();
    tray = null;
  }
});

// Keep the app running in the background when all windows are closed
app.on('window-all-closed', function () {
  log('All windows closed');
  // On macOS, keep the app running in the background
  if (process.platform !== 'darwin') {
    // On other platforms, quit the app
    log('Not on macOS, quitting app');
    app.quit();
  } else {
    log('On macOS, keeping app running in background');
  }
});

// Handle the screenshot capture request
ipcMain.on('capture-screen', () => {
  log('Capture screen request received from renderer');
  takeScreenshot();
});

// Handle the completed capture
ipcMain.on('capture-completed', (event, bounds) => {
  log(`Capture completed with bounds: ${JSON.stringify(bounds)}`);
  
  if (captureWindow && !captureWindow.isDestroyed()) {
    log('Closing capture window');
    captureWindow.close();
  } else {
    log('Capture window already closed or destroyed', 'WARNING');
  }
  
  // Use desktopCapturer to get the screen content
  log('Getting screen sources');
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    .then(async sources => {
      log(`Found ${sources.length} screen sources`);
      if (sources.length === 0) {
        log('No screen sources found', 'ERROR');
        return;
      }
      
      const source = sources[0]; // Get the primary screen
      log(`Using source: ${source.id}`);
      
      // Show the main window again if it exists and is not destroyed
      if (mainWindow && !mainWindow.isDestroyed()) {
        log('Showing main window and sending capture data');
        mainWindow.show();
        
        mainWindow.webContents.send('capture-image', {
          sourceId: source.id,
          bounds: bounds
        });
      } else {
        // If mainWindow doesn't exist or is destroyed, create a new one
        log('Main window does not exist or is destroyed, creating new one');
        createWindow();
        
        // Wait for the window to be ready before sending the capture
        mainWindow.once('ready-to-show', () => {
          log('Main window ready, showing and sending capture data');
          mainWindow.show();
          mainWindow.webContents.send('capture-image', {
            sourceId: source.id,
            bounds: bounds
          });
        });
      }
    })
    .catch(error => {
      log(`Error getting screen sources: ${error.message}`, 'ERROR');
    });
});

// Handle capture cancellation
ipcMain.on('capture-cancelled', () => {
  log('Capture cancelled');
  
  if (captureWindow && !captureWindow.isDestroyed()) {
    log('Closing capture window');
    captureWindow.close();
  } else {
    log('Capture window already closed or destroyed', 'WARNING');
  }
  
  // Show the main window again if it exists and is not destroyed
  if (mainWindow && !mainWindow.isDestroyed()) {
    log('Showing main window');
    mainWindow.show();
  } else {
    log('Main window does not exist or is destroyed, creating new one');
    createWindow();
  }
});

// Handle copying image to clipboard
ipcMain.on('copy-to-clipboard', (event, imageDataUrl) => {
  log('Copy to clipboard request received');
  try {
    // Convert the data URL to a Buffer
    const imageBuffer = Buffer.from(imageDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    
    // Create a native image from the buffer
    const image = nativeImage.createFromBuffer(imageBuffer);
    
    // Copy the image to the clipboard
    clipboard.writeImage(image);
    log('Image copied to clipboard successfully');
    
    // Send success status back to renderer if mainWindow exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-status', 'Image copied to clipboard');
    }
  } catch (error) {
    log(`Error copying to clipboard: ${error.message}`, 'ERROR');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-status', 'Failed to copy to clipboard');
    }
  }
});

// Handle image upload to your short domain service
ipcMain.on('upload-image', async (event, imageData) => {
  log('Upload image request received');
  try {
    // Save image temporarily
    const tempPath = path.join(app.getPath('temp'), 'screenshot.png');
    log(`Saving temporary image to: ${tempPath}`);
    fs.writeFileSync(tempPath, Buffer.from(imageData.replace(/^data:image\/png;base64,/, ''), 'base64'));
    
    // Upload to your short domain service - replace with your actual API endpoint
    const form = new FormData();
    form.append('image', fs.createReadStream(tempPath));
    
    log('Uploading image to API');
    const response = await axios.post('https://your-short-domain.com/api/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer YOUR_API_KEY' // Replace with your API key
      }
    });
    
    log(`Upload successful, received URL: ${response.data.url}`);
    
    // Send the response URL back to the renderer if mainWindow exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-complete', response.data.url);
    }
    
    // Clean up temp file
    fs.unlinkSync(tempPath);
    log('Temporary file cleaned up');
  } catch (error) {
    log(`Error uploading image: ${error.message}`, 'ERROR');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('upload-error', error.message);
    }
  }
});

// Add a proper app quit function
function quitApp() {
  log('Quitting app');
  app.isQuitting = true;
  
  // Destroy tray before quitting
  if (tray) {
    log('Destroying tray');
    tray.destroy();
    tray = null;
  }
  
  // Close all windows
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  
  // Finally quit the app
  app.quit();
} 