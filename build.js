const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// Run webpack to build the React app
console.log('Building React application...');
execSync('npx webpack --config webpack.config.js', { stdio: 'inherit' });

// Copy HTML and CSS files to dist
console.log('Copying static files...');
fs.copyFileSync(path.join(__dirname, 'src/styles/styles.css'), path.join(__dirname, 'dist/styles.css'));

// Create index.html in dist
const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screen Capture Tool</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="renderer.bundle.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'dist/index.html'), indexHtml);

// Create capture.html in dist
const captureHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Capture Screen</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      cursor: crosshair;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    /* Full screen overlay - this is the key part */
    body {
      background-color: rgba(128, 128, 128, 0.3); /* Light gray with 30% opacity */
    }
    
    #selection {
      position: absolute;
      border: 2px dashed #fff;
      background: rgba(67, 97, 238, 0.1);
      display: none;
      box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.5);
      z-index: 2;
    }
    
    /* Add a subtle animation to the selection */
    @keyframes pulse {
      0% { border-color: #fff; }
      50% { border-color: #4361ee; }
      100% { border-color: #fff; }
    }
    
    #selection.active {
      animation: pulse 2s infinite;
    }
    
    /* Add a small hint text */
    .hint {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      pointer-events: none;
      opacity: 0.9;
      z-index: 3;
    }
    
    /* Add crosshair guidelines */
    .crosshair-h, .crosshair-v {
      position: fixed;
      background: rgba(255, 255, 255, 0.5);
      pointer-events: none;
      z-index: 2;
    }
    
    .crosshair-h {
      height: 1px;
      width: 100%;
      left: 0;
    }
    
    .crosshair-v {
      width: 1px;
      height: 100%;
      top: 0;
    }
  </style>
</head>
<body>
  <div id="selection"></div>
  <div class="hint">Click and drag to select an area. Press ESC to cancel.</div>
  <div class="crosshair-h" id="crosshair-h"></div>
  <div class="crosshair-v" id="crosshair-v"></div>
  <script>
    const { ipcRenderer } = require('electron');
    
    let isSelecting = false;
    let startX = 0, startY = 0;
    const selection = document.getElementById('selection');
    const crosshairH = document.getElementById('crosshair-h');
    const crosshairV = document.getElementById('crosshair-v');
    
    // Show crosshair guidelines
    document.addEventListener('mousemove', (e) => {
      crosshairH.style.top = \`\${e.clientY}px\`;
      crosshairV.style.left = \`\${e.clientX}px\`;
      
      if (!isSelecting) {
        crosshairH.style.display = 'block';
        crosshairV.style.display = 'block';
      }
    });
    
    document.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      selection.style.left = \`\${startX}px\`;
      selection.style.top = \`\${startY}px\`;
      selection.style.width = '0';
      selection.style.height = '0';
      selection.style.display = 'block';
      selection.classList.add('active');
      
      // Hide crosshair guidelines during selection
      crosshairH.style.display = 'none';
      crosshairV.style.display = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      
      const currentX = e.clientX;
      const currentY = e.clientY;
      
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      
      selection.style.left = \`\${Math.min(startX, currentX)}px\`;
      selection.style.top = \`\${Math.min(startY, currentY)}px\`;
      selection.style.width = \`\${width}px\`;
      selection.style.height = \`\${height}px\`;
    });
    
    document.addEventListener('mouseup', (e) => {
      if (!isSelecting) return;
      isSelecting = false;
      selection.classList.remove('active');
      
      // Hide crosshair guidelines
      crosshairH.style.display = 'none';
      crosshairV.style.display = 'none';
      
      const bounds = {
        x: parseInt(selection.style.left),
        y: parseInt(selection.style.top),
        width: parseInt(selection.style.width),
        height: parseInt(selection.style.height)
      };
      
      // Only capture if the selection has some size
      if (bounds.width > 5 && bounds.height > 5) {
        // Send the bounds back to main process
        ipcRenderer.send('capture-completed', bounds);
      } else {
        // If selection is too small, cancel
        ipcRenderer.send('capture-cancelled');
      }
    });
    
    // Cancel on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ipcRenderer.send('capture-cancelled');
      }
    });
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'dist/capture.html'), captureHtml);

console.log('Build completed successfully!'); 