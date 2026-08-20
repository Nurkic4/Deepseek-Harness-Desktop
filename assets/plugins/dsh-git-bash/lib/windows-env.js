import { delimiter, join, normalize } from "node:path";

function envValue(env, name) {
  const entry = Object.entries(env).find(([key, value]) => (
    key.toUpperCase() === name.toUpperCase() && typeof value === "string" && value
  ));
  return entry?.[1] || "";
}

function windowsSystemPathEntries(env = process.env) {
  const root = envValue(env, "SystemRoot") || envValue(env, "windir") || "C:\\Windows";
  return [
    join(root, "System32"),
    root,
    join(root, "System32", "Wbem"),
    join(root, "System32", "WindowsPowerShell", "v1.0"),
    join(root, "System32", "OpenSSH"),
  ];
}

function withWindowsSystemPath(source = process.env, prepend = [], platform = process.platform) {
  const env = { ...source };
  if (platform !== "win32") return env;
  const inherited = Object.entries(env)
    .filter(([key]) => key.toUpperCase() === "PATH")
    .flatMap(([, value]) => String(value || "").split(delimiter));
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") delete env[key];
  }
  const seen = new Set();
  const entries = [...prepend, ...windowsSystemPathEntries(env), ...inherited]
    .map((entry) => String(entry || "").trim().replace(/^"|"$/g, ""))
    .filter((entry) => {
      if (!entry) return false;
      const key = normalize(entry).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  env.PATH = entries.join(delimiter);
  return env;
}

export { windowsSystemPathEntries, withWindowsSystemPath };
