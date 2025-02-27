import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
const { ipcRenderer, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const remote = require('@electron/remote');

// Add logging functionality
function logToRenderer(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [RENDERER] [${type}] ${message}`;
  
  // Log to console
  console.log(logMessage);
  
  // Try to log to file if possible
  try {
    const userData = remote.app.getPath('userData');
    if (userData) {
      const logFile = path.join(userData, 'renderer.log');
      fs.appendFileSync(logFile, logMessage + '\n');
    }
  } catch (error) {
    console.error(`Failed to write to renderer log file: ${error.message}`);
  }
}

logToRenderer('Renderer process starting');

function App() {
  const [image, setImage] = useState(null);
  const [tool, setTool] = useState('select'); // select, text, arrow, rectangle
  const [color, setColor] = useState('#FF0000'); // Default to red
  const [elements, setElements] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);
  const [textInput, setTextInput] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [clipboardStatus, setClipboardStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  
  // Listen for captured image
  useEffect(() => {
    logToRenderer('Setting up IPC event listeners');
    
    // Check for screen capture permissions
    async function checkScreenCapturePermission() {
      try {
        logToRenderer('Checking screen capture permissions');
        const sources = await remote.desktopCapturer.getSources({ types: ['screen'] });
        if (sources && sources.length > 0) {
          logToRenderer('Screen capture permission available');
          return true;
        } else {
          logToRenderer('No screen sources available', 'WARNING');
          return false;
        }
      } catch (error) {
        logToRenderer(`Screen capture permission check failed: ${error.message}`, 'ERROR');
        return false;
      }
    }
    
    // Run the permission check
    checkScreenCapturePermission();
    
    ipcRenderer.on('capture-image', async (event, data) => {
      logToRenderer(`Received capture-image event with bounds: ${JSON.stringify(data.bounds)}`);
      try {
        // Create canvas to capture the specific area
        const canvas = document.createElement('canvas');
        
        // Check if we have pre-captured fullScreenImage data (preferred method)
        if (data.fullScreenImage) {
          logToRenderer('Using pre-captured fullScreenImage data (clean screenshot without overlay)');
          
          // Set canvas size to the bounds
          canvas.width = data.bounds.width;
          canvas.height = data.bounds.height;
          
          logToRenderer(`Canvas size set to ${data.bounds.width}x${data.bounds.height}`);
          
          // Get the native image from the fullScreenImage
          const nativeImg = data.fullScreenImage;
          
          // Convert the native image to a data URL
          const fullImageDataUrl = nativeImg.toDataURL();
          
          // Create an image from the data URL
          const img = new Image();
          img.onload = () => {
            logToRenderer('Pre-captured fullScreenImage loaded');
            
            // Draw the specific region from the pre-captured image
            const ctx = canvas.getContext('2d');
            ctx.drawImage(
              img, 
              data.bounds.x, data.bounds.y, data.bounds.width, data.bounds.height,
              0, 0, data.bounds.width, data.bounds.height
            );
            
            logToRenderer('Image drawn to canvas from pre-captured fullScreenImage');
            
            // Get image data
            const imageData = canvas.toDataURL('image/png');
            logToRenderer(`Image data URL created, length: ${imageData.length}`);
            setImage(imageData);
            
            // Copy to clipboard
            try {
              // Send to main process to handle clipboard copy
              logToRenderer('Sending image to main process for clipboard copy');
              ipcRenderer.send('copy-to-clipboard', imageData);
              setClipboardStatus('Image copied to clipboard');
              setTimeout(() => setClipboardStatus(''), 3000); // Clear status after 3 seconds
            } catch (clipboardError) {
              logToRenderer(`Error copying to clipboard: ${clipboardError.message}`, 'ERROR');
              setClipboardStatus('Failed to copy to clipboard');
            }
          };
          
          img.onerror = (err) => {
            logToRenderer(`Error loading pre-captured fullScreenImage: ${err}`, 'ERROR');
            // Fall back to thumbnail if available
            if (data.thumbnail) {
              logToRenderer('Falling back to thumbnail data');
              useThumbnailData(data, canvas);
            } else {
              // Fall back to the original method
              captureUsingMediaStream(data);
            }
          };
          
          // Set the source to the full image data URL
          img.src = fullImageDataUrl;
        }
        // Check if we have pre-captured thumbnail data (fallback method)
        else if (data.thumbnail) {
          logToRenderer('Using pre-captured thumbnail data');
          useThumbnailData(data, canvas);
        } else {
          // Fall back to the original method using media stream
          logToRenderer('No pre-captured data available, using media stream');
          captureUsingMediaStream(data);
        }
      } catch (e) {
        logToRenderer(`Error in capture-image handler: ${e.message}`, 'ERROR');
      }
    });
    
    ipcRenderer.on('upload-complete', (event, url) => {
      logToRenderer(`Upload complete, received URL: ${url}`);
      setShareUrl(url);
    });
    
    ipcRenderer.on('upload-error', (event, error) => {
      logToRenderer(`Upload error: ${error}`, 'ERROR');
      alert(`Error uploading: ${error}`);
    });
    
    ipcRenderer.on('clipboard-status', (event, status) => {
      logToRenderer(`Clipboard status: ${status}`);
      setClipboardStatus(status);
      setTimeout(() => setClipboardStatus(''), 3000); // Clear status after 3 seconds
    });
    
    return () => {
      logToRenderer('Cleaning up IPC event listeners');
      ipcRenderer.removeAllListeners('capture-image');
      ipcRenderer.removeAllListeners('upload-complete');
      ipcRenderer.removeAllListeners('upload-error');
      ipcRenderer.removeAllListeners('clipboard-status');
    };
  }, []);
  
  // Add keyboard shortcut for copy (Cmd+C / Ctrl+C)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if Cmd+C (Mac) or Ctrl+C (Windows/Linux) is pressed
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (image) {
          copyCurrentImageToClipboard();
        }
      }
      
      // Add Delete/Backspace key to delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement !== null) {
        deleteSelectedElement();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, elements, selectedElement]); // Re-add event listener when image, elements, or selectedElement change
  
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    
    // Draw the base image
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Draw all elements
      drawElements();
    };
    img.src = image;
    imageRef.current = img;
  }, [image]);
  
  // Redraw whenever elements change
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    drawElements();
  }, [elements, selectedElement]);
  
  const drawElements = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Clear and redraw base image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);
    
    // Draw all elements
    elements.forEach((element, index) => {
      const isSelected = selectedElement === index;
      
      ctx.strokeStyle = element.color;
      ctx.fillStyle = element.color;
      ctx.lineWidth = 2;
      
      switch(element.type) {
        case 'text':
          ctx.font = '16px Arial';
          ctx.fillText(element.text, element.x, element.y);
          
          // Draw selection box if selected
          if (isSelected) {
            const metrics = ctx.measureText(element.text);
            ctx.strokeStyle = '#0000FF';
            ctx.strokeRect(
              element.x - 2, 
              element.y - 16 - 2,
              metrics.width + 4,
              20
            );
          }
          break;
          
        case 'arrow':
          // Draw arrow line
          ctx.beginPath();
          ctx.moveTo(element.startX, element.startY);
          ctx.lineTo(element.endX, element.endY);
          ctx.stroke();
          
          // Draw arrow head
          const angle = Math.atan2(element.endY - element.startY, element.endX - element.startX);
          ctx.beginPath();
          ctx.moveTo(element.endX, element.endY);
          ctx.lineTo(
            element.endX - 15 * Math.cos(angle - Math.PI / 6),
            element.endY - 15 * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            element.endX - 15 * Math.cos(angle + Math.PI / 6),
            element.endY - 15 * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
          
          // Draw selection indication if selected
          if (isSelected) {
            ctx.strokeStyle = '#0000FF';
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(element.startX, element.startY);
            ctx.lineTo(element.endX, element.endY);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          break;
          
        case 'rectangle':
          ctx.strokeStyle = element.color;
          ctx.lineWidth = 3;
          ctx.strokeRect(
            element.startX,
            element.startY,
            element.width,
            element.height
          );
          
          // Draw selection handles if selected
          if (isSelected) {
            ctx.fillStyle = '#0000FF';
            const handleSize = 6;
            // Draw handles at each corner
            [
              {x: element.startX, y: element.startY},
              {x: element.startX + element.width, y: element.startY},
              {x: element.startX, y: element.startY + element.height},
              {x: element.startX + element.width, y: element.startY + element.height}
            ].forEach(handle => {
              ctx.fillRect(
                handle.x - handleSize/2,
                handle.y - handleSize/2,
                handleSize,
                handleSize
              );
            });
          }
          break;
      }
    });
  };
  
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (tool === 'select') {
      // Check if clicking on any element to select it
      for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i];
        
        // Simple hit testing based on element type
        if (element.type === 'text') {
          const ctx = canvas.getContext('2d');
          ctx.font = '16px Arial';
          const metrics = ctx.measureText(element.text);
          
          if (
            x >= element.x && 
            x <= element.x + metrics.width &&
            y >= element.y - 16 &&
            y <= element.y
          ) {
            setSelectedElement(i);
            // Set up for dragging
            setIsDragging(true);
            setDragOffset({ x: x - element.x, y: y - element.y });
            return;
          }
        } else if (element.type === 'arrow') {
          // Simple line hit test (not perfect)
          const dx = element.endX - element.startX;
          const dy = element.endY - element.startY;
          const length = Math.sqrt(dx * dx + dy * dy);
          
          const dot = ((x - element.startX) * dx + (y - element.startY) * dy) / length;
          const projX = element.startX + (dot * dx) / length;
          const projY = element.startY + (dot * dy) / length;
          
          const distance = Math.sqrt((x - projX) * (x - projX) + (y - projY) * (y - projY));
          
          if (
            distance < 5 &&
            dot >= 0 &&
            dot <= length
          ) {
            setSelectedElement(i);
            // Set up for dragging
            setIsDragging(true);
            // Calculate offset from start point
            setDragOffset({ 
              x: x - element.startX, 
              y: y - element.startY 
            });
            return;
          }
        } else if (element.type === 'rectangle') {
          // Rectangle border hit test
          const nearBorder = (
            (Math.abs(x - element.startX) < 5 || Math.abs(x - (element.startX + element.width)) < 5) &&
            y >= element.startY && y <= element.startY + element.height
          ) || (
            (Math.abs(y - element.startY) < 5 || Math.abs(y - (element.startY + element.height)) < 5) &&
            x >= element.startX && x <= element.startX + element.width
          );
          
          // Also check if inside rectangle for dragging
          const insideRect = (
            x >= element.startX && 
            x <= element.startX + element.width &&
            y >= element.startY && 
            y <= element.startY + element.height
          );
          
          if (nearBorder || insideRect) {
            setSelectedElement(i);
            // Set up for dragging
            setIsDragging(true);
            setDragOffset({ 
              x: x - element.startX, 
              y: y - element.startY 
            });
            return;
          }
        }
      }
      
      // If we got here, didn't hit any element
      setSelectedElement(null);
      setIsDragging(false);
    } else {
      // Starting to draw a new element
      setIsDrawing(true);
      setStartPos({ x, y });
      
      if (tool === 'text') {
        const text = prompt('Enter text:');
        if (text) {
          setElements([...elements, {
            type: 'text',
            x,
            y,
            text,
            color
          }]);
        }
        setIsDrawing(false);
      } else if (tool === 'arrow') {
        // Will be completed on mouse up
        setElements([...elements, {
          type: 'arrow',
          startX: x,
          startY: y,
          endX: x,
          endY: y,
          color
        }]);
      } else if (tool === 'rectangle') {
        // Will be completed on mouse up
        setElements([...elements, {
          type: 'rectangle',
          startX: x,
          startY: y,
          width: 0,
          height: 0,
          color
        }]);
      }
    }
  };
  
  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (isDrawing) {
      const newElements = [...elements];
      const currentElement = newElements[newElements.length - 1];
      
      if (tool === 'arrow') {
        currentElement.endX = x;
        currentElement.endY = y;
      } else if (tool === 'rectangle') {
        currentElement.width = x - currentElement.startX;
        currentElement.height = y - currentElement.startY;
      }
      
      setElements(newElements);
    } else if (isDragging && selectedElement !== null) {
      // Move the selected element
      const newElements = [...elements];
      const element = newElements[selectedElement];
      
      if (element.type === 'text') {
        element.x = x - dragOffset.x;
        element.y = y - dragOffset.y;
      } else if (element.type === 'arrow') {
        // Calculate the movement delta
        const dx = x - dragOffset.x - element.startX;
        const dy = y - dragOffset.y - element.startY;
        
        // Move both start and end points
        element.startX += dx;
        element.startY += dy;
        element.endX += dx;
        element.endY += dy;
      } else if (element.type === 'rectangle') {
        element.startX = x - dragOffset.x;
        element.startY = y - dragOffset.y;
      }
      
      setElements(newElements);
    }
  };
  
  const handleMouseUp = () => {
    setIsDrawing(false);
    setIsDragging(false);
  };
  
  const handleTakeScreenshot = () => {
    ipcRenderer.send('capture-screen');
  };
  
  const handleShare = () => {
    if (!canvasRef.current) return;
    
    const dataUrl = canvasRef.current.toDataURL('image/png');
    ipcRenderer.send('upload-image', dataUrl);
  };
  
  // Function to copy the current edited image to clipboard
  const copyCurrentImageToClipboard = () => {
    if (!canvasRef.current) return;
    
    const dataUrl = canvasRef.current.toDataURL('image/png');
    ipcRenderer.send('copy-to-clipboard', dataUrl);
  };
  
  // Function to delete the selected element
  const deleteSelectedElement = () => {
    if (selectedElement === null) return;
    
    const newElements = [...elements];
    newElements.splice(selectedElement, 1);
    setElements(newElements);
    setSelectedElement(null);
  };
  
  // Function to change the color of the selected element
  const changeSelectedElementColor = (newColor) => {
    if (selectedElement === null) return;
    
    const newElements = [...elements];
    newElements[selectedElement].color = newColor;
    setElements(newElements);
  };

  // Function to capture using media stream (original method)
  async function captureUsingMediaStream(data) {
    logToRenderer('Capturing using media stream');
    try {
      const canvas = document.createElement('canvas');
      const video = document.createElement('video');
      
      logToRenderer('Requesting screen capture media');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: data.sourceId,
            }
          }
        });
        
        logToRenderer('Media stream obtained successfully');
        video.srcObject = stream;
        
        // Add error handler for video
        video.onerror = (err) => {
          logToRenderer(`Video error: ${err.message}`, 'ERROR');
        };
        
        try {
          await video.play();
          logToRenderer('Video playing');
          
          // Set canvas size to the bounds
          canvas.width = data.bounds.width;
          canvas.height = data.bounds.height;
          
          logToRenderer(`Canvas size set to ${data.bounds.width}x${data.bounds.height}`);
          
          // Draw the specific region
          const ctx = canvas.getContext('2d');
          ctx.drawImage(
            video, 
            data.bounds.x, data.bounds.y, data.bounds.width, data.bounds.height,
            0, 0, data.bounds.width, data.bounds.height
          );
          
          logToRenderer('Image drawn to canvas');
          
          // Get image data
          const imageData = canvas.toDataURL('image/png');
          logToRenderer(`Image data URL created, length: ${imageData.length}`);
          setImage(imageData);
          
          // Copy to clipboard
          try {
            // Send to main process to handle clipboard copy
            logToRenderer('Sending image to main process for clipboard copy');
            ipcRenderer.send('copy-to-clipboard', imageData);
            setClipboardStatus('Image copied to clipboard');
            setTimeout(() => setClipboardStatus(''), 3000); // Clear status after 3 seconds
          } catch (clipboardError) {
            logToRenderer(`Error copying to clipboard: ${clipboardError.message}`, 'ERROR');
            setClipboardStatus('Failed to copy to clipboard');
          }
          
          // Stop the video stream
          logToRenderer('Stopping media stream');
          stream.getTracks().forEach(track => track.stop());
        } catch (videoError) {
          logToRenderer(`Error playing video: ${videoError.message}`, 'ERROR');
        }
      } catch (mediaError) {
        logToRenderer(`Error getting media: ${mediaError.message}`, 'ERROR');
      }
    } catch (e) {
      logToRenderer(`Error in captureUsingMediaStream: ${e.message}`, 'ERROR');
    }
  }

  // Helper function to use thumbnail data
  function useThumbnailData(data, canvas) {
    // Create an image from the thumbnail
    const img = new Image();
    img.onload = () => {
      logToRenderer('Pre-captured thumbnail image loaded');
      
      // Set canvas size to the bounds
      canvas.width = data.bounds.width;
      canvas.height = data.bounds.height;
      
      logToRenderer(`Canvas size set to ${data.bounds.width}x${data.bounds.height}`);
      
      // Draw the specific region from the pre-captured image
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img, 
        data.bounds.x, data.bounds.y, data.bounds.width, data.bounds.height,
        0, 0, data.bounds.width, data.bounds.height
      );
      
      logToRenderer('Image drawn to canvas from pre-captured thumbnail data');
      
      // Get image data
      const imageData = canvas.toDataURL('image/png');
      logToRenderer(`Image data URL created, length: ${imageData.length}`);
      setImage(imageData);
      
      // Copy to clipboard
      try {
        // Send to main process to handle clipboard copy
        logToRenderer('Sending image to main process for clipboard copy');
        ipcRenderer.send('copy-to-clipboard', imageData);
        setClipboardStatus('Image copied to clipboard');
        setTimeout(() => setClipboardStatus(''), 3000); // Clear status after 3 seconds
      } catch (clipboardError) {
        logToRenderer(`Error copying to clipboard: ${clipboardError.message}`, 'ERROR');
        setClipboardStatus('Failed to copy to clipboard');
      }
    };
    
    img.onerror = (err) => {
      logToRenderer(`Error loading pre-captured image: ${err}`, 'ERROR');
      // Fall back to the original method
      captureUsingMediaStream(data);
    };
    
    // Set the source to the thumbnail data URL
    img.src = data.thumbnail;
  }

  return (
    <div className="app-container">
      <div className="toolbar">
        <button onClick={handleTakeScreenshot}>Take Screenshot</button>
        
        <div className="tool-group">
          <button 
            className={tool === 'select' ? 'active' : ''} 
            onClick={() => setTool('select')}
          >
            Select
          </button>
          <button 
            className={tool === 'text' ? 'active' : ''} 
            onClick={() => setTool('text')}
          >
            Text
          </button>
          <button 
            className={tool === 'arrow' ? 'active' : ''} 
            onClick={() => setTool('arrow')}
          >
            Arrow
          </button>
          <button 
            className={tool === 'rectangle' ? 'active' : ''} 
            onClick={() => setTool('rectangle')}
          >
            Rectangle
          </button>
        </div>
        
        <div className="color-picker">
          <label>Color:</label>
          <input 
            type="color" 
            value={color} 
            onChange={(e) => {
              setColor(e.target.value);
              // If an element is selected, also update its color
              if (selectedElement !== null && tool === 'select') {
                changeSelectedElementColor(e.target.value);
              }
            }} 
          />
        </div>
        
        {selectedElement !== null && tool === 'select' && (
          <button 
            className="delete-button"
            onClick={deleteSelectedElement}
          >
            Delete Element
          </button>
        )}
      </div>
      
      {clipboardStatus && (
        <div className="status-message">
          {clipboardStatus}
        </div>
      )}
      
      <div className="canvas-container">
        {image ? (
          <canvas 
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        ) : (
          <div className="placeholder">
            Click "Take Screenshot" to begin
          </div>
        )}
      </div>
      
      {image && (
        <div className="share-container">
          <div className="button-group">
            <button onClick={copyCurrentImageToClipboard}>
              Copy to Clipboard (⌘C)
            </button>
            <button onClick={handleShare}>Share via Your Short Domain</button>
          </div>
          {shareUrl && (
            <div className="share-url">
              <p>Your screenshot is available at:</p>
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                {shareUrl}
              </a>
            </div>
          )}
        </div>
      )}
      
      {selectedElement !== null && tool === 'select' && (
        <div className="element-info">
          <p>Element selected: {elements[selectedElement].type}</p>
          <p>Use Delete key to remove | Change color with color picker | Drag to move</p>
        </div>
      )}
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('app')); 