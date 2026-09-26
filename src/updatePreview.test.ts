import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ enabled: true }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
import { updatePreview } from "./updatePreview";
import { createUpdateController } from "./updater";
afterEach(() => { updatePreview.close(); native.enabled = true; vi.unstubAllEnvs(); });
it("previews and dismisses sample notes without changing real updater state or calling transports", () => {
  vi.stubEnv("DEV", true);
  const check = vi.fn(), restart = vi.fn(), version = vi.fn();
  const real = createUpdateController({ enabled: () => true, check, restart, version });
  const before = real.getSnapshot();
  updatePreview.open("2.2.0");
  expect(updatePreview.getSnapshot()).toMatchObject({ currentVersion: "2.2.0", availableVersion: "2.2.1", phase: "available", promptOpen: true, automaticPrompt: false });
  expect(updatePreview.getSnapshot()?.notes).toContain("##");
  updatePreview.close();
  expect(updatePreview.getSnapshot()).toBeNull();
  expect(real.getSnapshot()).toBe(before);
  expect(check).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled(); expect(version).not.toHaveBeenCalled();
});
it("does not open outside native development builds", () => {
  vi.stubEnv("DEV", false);
  updatePreview.open("2.2.0");
  expect(updatePreview.getSnapshot()).toBeNull();
  vi.stubEnv("DEV", true); native.enabled = false;
  updatePreview.open("2.2.0");
  expect(updatePreview.getSnapshot()).toBeNull();
});
