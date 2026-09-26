import { invoke, isTauri } from "@tauri-apps/api/core";
import { loadSettings, saveSetting } from "./settings";

const punctuation: Record<string, string> = { Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };
type KeyInput = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;
export function captureShortcut(event: KeyInput): string | undefined {
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
  if (event.metaKey || (modifiers.length < 1 || !(/^Key[A-Z]$|^Digit[0-9]$/.test(event.code) || event.code in punctuation))) return;
  return [...modifiers, event.code].join("+");
}
export function isRevealShortcut(shortcut: string): boolean {
  if (shortcut === "") return true;
  const parts = shortcut.split("+");
  const code = parts.pop()!;
  return captureShortcut({code,ctrlKey:parts.includes("Ctrl"),altKey:parts.includes("Alt"),shiftKey:parts.includes("Shift"),metaKey:false}) === shortcut;
}
export function shortcutLabel(shortcut: string) {
  return shortcut.split("+").map(part => punctuation[part] ?? part.replace(/^Key|^Digit/, "")).join(" + ");
}
/** Capture at the window level so button blur does not interrupt recording. */
export function listenForShortcut(onCapture: (shortcut: string) => void, onCancel: () => void, target: Window = window) {
  const stop = () => target.removeEventListener("keydown", keydown, { capture: true });
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === "Tab") { stop(); onCancel(); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { stop(); onCancel(); return; }
    const next = captureShortcut(event);
    if (next) { stop(); onCapture(next); }
  };
  target.addEventListener("keydown", keydown, { capture: true });
  return stop;
}
let registrationFailure = "";
let activeShortcut: string | undefined;
const registrationListeners = new Set<() => void>();
export const shortcutRegistration = {
  getSnapshot: () => registrationFailure,
  subscribe: (listener: () => void) => { registrationListeners.add(listener); return () => { registrationListeners.delete(listener); }; },
};
function reportRegistration(failure: string) { registrationFailure = failure; registrationListeners.forEach(listener => listener()); }
let operation = Promise.resolve();
/** Serialize startup and recorder changes; persist only a registered combination. */
export function registerRevealShortcut(shortcut: string, persist: boolean | (() => Promise<void>) = false) {
  const next = operation.catch(() => undefined).then(async () => {
    if (!isRevealShortcut(shortcut)) throw new Error("Invalid reveal shortcut.");
    if (!isTauri()) throw new Error("Global shortcuts require the desktop app.");
    const previous = (await loadSettings()).popoutRevealShortcut;
    if (shortcut && await invoke<boolean>("reveal_shortcut_available") === false) throw new Error("Global reveal shortcuts are unavailable on this device.");
    if (activeShortcut !== shortcut) await invoke("set_reveal_shortcut", { shortcut });
    activeShortcut = shortcut;
    if (persist) {
      try { await (typeof persist === "function" ? persist() : saveSetting("popoutRevealShortcut", shortcut)); }
      catch (error) {
        try { await invoke("set_reveal_shortcut", { shortcut: previous }); activeShortcut = previous; }
        catch (rollbackError) { activeShortcut = undefined; throw new AggregateError([error, rollbackError], "Shortcut rollback failed."); }
        throw error;
      }
    }
  });
  const reported = next.then(() => { reportRegistration(""); }, error => { reportRegistration(activeShortcut === undefined ? String(error) : ""); throw error; });
  operation = reported;
  return reported;
}
