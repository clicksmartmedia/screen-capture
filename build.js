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
  <title>Screenshot Tool</title>
  <link rel="stylesheet" href="styles.css">
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
  <title>Capture Screen</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.05);
      cursor: crosshair;
    }
    #selection {
      position: absolute;
      border: 2px dashed #fff;
      background: rgba(0, 0, 255, 0.1);
      display: none;
    }
  </style>
</head>
<body>
  <div id="selection"></div>
  <script>
    const { ipcRenderer } = require('electron');
    
    let isSelecting = false;
    let startX = 0, startY = 0;
    const selection = document.getElementById('selection');
    
    document.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      selection.style.left = \`\${startX}px\`;
      selection.style.top = \`\${startY}px\`;
      selection.style.width = '0';
      selection.style.height = '0';
      selection.style.display = 'block';
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
      
      const bounds = {
        x: parseInt(selection.style.left),
        y: parseInt(selection.style.top),
        width: parseInt(selection.style.width),
        height: parseInt(selection.style.height)
      };
      
      // Send the bounds back to main process
      ipcRenderer.send('capture-completed', bounds);
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