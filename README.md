# Screen Capture Tool

A macOS application for capturing, annotating, and sharing screenshots.

## Features

- Capture screenshots with Option+Shift+3 keyboard shortcut
- Add text, arrows, and rectangles to annotate screenshots
- Select, move, delete, and change colors of annotations
- Copy to clipboard with Cmd+C
- Share via custom domain (requires configuration)
- Menu bar (tray) icon for easy access even when the main window is closed

## Usage

1. Launch the application
2. Use Option+Shift+3 to capture a screenshot, or click the menu bar icon and select "Take Screenshot"
3. Draw a selection rectangle around the area you want to capture
4. Use the annotation tools to add text, arrows, or rectangles
5. Press Cmd+C or click the "Copy to Clipboard" button to copy the edited image
6. Close the main window to keep the app running in the background (accessible via the menu bar icon)

## Development

### Prerequisites

- Node.js (v14 or later)
- npm or yarn
- Xcode (for macOS app building)
- Apple Developer account (for TestFlight distribution)

### Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Build the app:
   ```
   npm run build
   ```
4. Start the app in development mode:
   ```
   npm start
   ```

## Building for macOS

### Standard macOS App

To build a standard macOS app:

```
npm run dist:mac
```

This will create a `.dmg` file in the `release-builds` folder.

### TestFlight Distribution

To prepare the app for TestFlight distribution:

1. Update the `build/entitlements.mas.plist` and `build/entitlements.mas.inherit.plist` files with your Apple Team ID.

2. Create a provisioning profile in your Apple Developer account for the app.

3. Place the provisioning profile in the `build` folder as `embedded.provisionprofile`.

4. Build the app for Mac App Store:
   ```
   npm run dist:mac
   ```

5. Use Xcode to create an archive and upload to TestFlight:
   - Open Xcode
   - Go to "Open Developer Tool" > "Application Loader"
   - Sign in with your Apple ID
   - Choose the `.pkg` file from the `dist` folder
   - Follow the upload process

## Customization

- Update the app icon by replacing `assets/icon.icns`
- Configure the upload service in `src/main.js` by updating the API endpoint and authentication
- Customize the tray icon by replacing `assets/tray-icon.png`

## License

MIT 