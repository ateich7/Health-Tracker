const { app, BrowserWindow, session } = require("electron");
const path = require("path");

// Creates the main app window
function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 800,
    icon: path.join(__dirname, "assets", "icon.icns"),
    webPreferences: {
      nodeIntegration: false, // keep renderer isolated from Node APIs
      contextIsolation: true
    }
  });
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  // Allow the renderer page to request geolocation (used for weather)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "geolocation");
  });
  createWindow();
});

// On macOS the app stays active until Cmd+Q; on other platforms quit when all windows close
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Re-open a window when the dock icon is clicked on macOS
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.setName("Health Tracker");
