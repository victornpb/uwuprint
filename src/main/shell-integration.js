const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MAC_WORKFLOW_FILES = [
  path.join("Contents", "Info.plist"),
  path.join("Contents", "document.wflow"),
  path.join("Contents", "QuickLook", "Thumbnail.png"),
  path.join("Contents", "Resources", "background.color"),
];

function getIntegrationName(appName) {
  return process.platform === "darwin"
    ? `Print Images with ${appName}`
    : `Print with ${appName}`;
}

function getWorkflowPath(home, appName) {
  return path.join(home, "Library", "Services", `${getIntegrationName(appName)}.workflow`);
}

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(statePath, enabled) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ enabled, version: 2 }, null, 2));
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`;
}

function runMacTool(executable, args, errorMessage) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || errorMessage);
}

function extractMacWorkflow(templatePath, workflowPath) {
  // Electron can read individual files inside app.asar, but Node's recursive
  // copy does not traverse ASAR virtual directories.
  for (const relativePath of MAC_WORKFLOW_FILES) {
    const outputPath = path.join(workflowPath, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      fs.readFileSync(path.join(templatePath, relativePath)),
    );
  }
}

function setWindowsContextMenu(enabled, appName, executablePath) {
  const key = "HKCU\\Software\\Classes\\SystemFileAssociations\\image\\shell\\uwuprint-print";
  if (!enabled) {
    const result = spawnSync("reg.exe", ["delete", key, "/f"], { encoding: "utf8" });
    if (result.status !== 0 && !/unable to find/i.test(result.stderr || ""))
      throw new Error(result.stderr || "Could not remove the Explorer menu item.");
    return;
  }
  const command = `\"${executablePath}\" \"%1\"`;
  for (const [target, value] of [[key, `Print with ${appName}`], [`${key}\\command`, command]]) {
    const result = spawnSync("reg.exe", ["add", target, "/ve", "/d", value, "/f"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Could not add the Explorer menu item.");
  }
}

function createShellIntegration(app) {
  const appName = app.getName();
  const statePath = path.join(app.getPath("userData"), "shell-integration.json");
  const supported = process.platform === "darwin" || process.platform === "win32";

  function status() {
    const saved = readState(statePath);
    const workflowExists = process.platform !== "darwin" || fs.existsSync(
      getWorkflowPath(app.getPath("home"), appName),
    );
    return {
      supported,
      enabled: supported && saved.enabled === true && workflowExists,
      label: getIntegrationName(appName),
      platform: process.platform,
    };
  }

  function setEnabled(enabled) {
    if (!supported) return status();
    if (process.platform === "darwin") {
      const workflowPath = getWorkflowPath(app.getPath("home"), appName);
      if (enabled) {
        const templatePath = path.join(
          __dirname,
          "..",
          "assets",
          "macos",
          "print-images.workflow",
        );
        const command = app.isPackaged
          ? [process.execPath]
          : [process.execPath, app.getAppPath()];
        const script = `for file in \"$@\"; do\n  ${command.map(shellQuote).join(" ")} \"$file\"\ndone`;
        fs.rmSync(workflowPath, { recursive: true, force: true });
        extractMacWorkflow(templatePath, workflowPath);
        runMacTool(
          "/usr/bin/plutil",
          [
            "-replace",
            "NSServices.0.NSMenuItem.default",
            "-string",
            getIntegrationName(appName),
            path.join(workflowPath, "Contents", "Info.plist"),
          ],
          "Could not name the Finder Quick Action.",
        );
        runMacTool(
          "/usr/bin/plutil",
          [
            "-replace",
            "actions.0.action.ActionParameters.COMMAND_STRING",
            "-string",
            script,
            path.join(workflowPath, "Contents", "document.wflow"),
          ],
          "Could not configure the Finder Quick Action.",
        );
      } else {
        fs.rmSync(workflowPath, { recursive: true, force: true });
      }
      runMacTool(
        "/System/Library/CoreServices/pbs",
        ["-update"],
        "Could not refresh macOS Services.",
      );
    } else {
      setWindowsContextMenu(enabled, appName, process.execPath);
    }
    writeState(statePath, enabled === true);
    return status();
  }

  function refresh() {
    const saved = readState(statePath);
    if (saved.enabled === true && saved.version !== 2) return setEnabled(true);
    return status();
  }

  return { status, setEnabled, refresh };
}

module.exports = { createShellIntegration };
