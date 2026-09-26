import { describe, expect, it, vi } from "vitest";
import { createUpdateController } from "./updater";
import { UpdateCheckError } from "./updateDiagnostics";

function fixture() {
  const update = { version: "1.3.1", body: "Release notes", close: vi.fn(async () => {}), downloadAndInstall: vi.fn(async (onEvent?: (event: import("@tauri-apps/plugin-updater").DownloadEvent) => void) => {
    onEvent?.({ event: "Started", data: { contentLength: 100 } });
    onEvent?.({ event: "Progress", data: { chunkLength: 50 } });
    onEvent?.({ event: "Progress", data: { chunkLength: 50 } });
    onEvent?.({ event: "Finished" });
  }) };
  const deps = { enabled: () => true, version: vi.fn(async () => "1.3.0"), check: vi.fn(async () => update), restart: vi.fn(async () => {}) };
  return { update, deps, controller: createUpdateController(deps) };
}

describe("shared updater lifecycle", () => {
  it("honors the persisted startup preference without blocking manual checks", async () => {
    const { deps } = fixture();
    const controller = createUpdateController({ ...deps, startupEnabled: async () => false });
    await controller.start();
    expect(deps.check).not.toHaveBeenCalled();
    await controller.check(true);
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().automaticPrompt).toBe(false);
  });
  it("Don't show again persists opt-out, while Later only dismisses", async () => {
    const { deps } = fixture();
    const disableStartup = vi.fn(async () => {});
    const controller = createUpdateController({ ...deps, disableStartup });
    await controller.start(); controller.later();
    expect(disableStartup).not.toHaveBeenCalled();
    await controller.check(); await controller.dontShowAgain();
    expect(disableStartup).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().promptOpen).toBe(false);
  });
  it("keeps the prompt open if saving the opt-out fails", async () => {
    const { deps } = fixture();
    const controller = createUpdateController({ ...deps, disableStartup: async () => { throw new Error("storage"); } });
    await controller.start();
    await expect(controller.dontShowAgain()).rejects.toThrow("storage");
    expect(controller.getSnapshot().promptOpen).toBe(true);
  });
  it("keeps confirmed missing manifests distinct and no-update checks successful", async () => {
    const { deps } = fixture();
    const controller = createUpdateController({ ...deps, check: async () => null });
    await controller.check(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "current", error: undefined });
    const missing = createUpdateController({ ...deps, check: async () => { throw new UpdateCheckError("manifest-missing", "404"); } });
    await missing.check(true);
    expect(missing.getSnapshot()).toMatchObject({ phase: "error", checkCategory: "manifest-missing", promptOpen: false });
  });
  it("checks once at startup and never installs before confirmation", async () => {
    const { controller, deps, update } = fixture();
    await Promise.all([controller.start(), controller.start()]);
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ phase: "available", promptOpen: true, currentVersion: "1.3.0", availableVersion: "1.3.1" });
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });
  it("suppresses a postponed version automatically but allows manual rediscovery", async () => {
    const { controller } = fixture();
    await controller.check(); controller.later(); await controller.check();
    expect(controller.getSnapshot().promptOpen).toBe(false);
    await controller.check(true);
    expect(controller.getSnapshot().promptOpen).toBe(true);
  });
  it("deduplicates simultaneous manual checks", async () => {
    const { controller, deps } = fixture();
    await Promise.all([controller.check(true), controller.check(true), controller.check()]);
    expect(deps.check).toHaveBeenCalledTimes(1);
  });
  it("fails quietly automatically and reports manual failures without rejecting", async () => {
    const { controller, deps } = fixture();
    deps.check.mockRejectedValue(new Error("offline"));
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", promptOpen: false, error: undefined });
    await controller.check(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "check", promptOpen: false });
  });
  it("reports progress and restarts only after a confirmed successful install", async () => {
    const { controller, deps, update } = fixture();
    const states: string[] = [];
    controller.subscribe(() => states.push(controller.getSnapshot().phase));
    await controller.check();
    await Promise.all([controller.install(), controller.install()]);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(deps.restart).toHaveBeenCalledTimes(1);
    expect(states).toContain("installing");
    expect(controller.getSnapshot()).toMatchObject({ phase: "restarting", downloaded: 100, contentLength: 100 });
  });
  it("never restarts after an install/signature failure", async () => {
    const { controller, deps, update } = fixture();
    update.downloadAndInstall.mockRejectedValue(new Error("signature mismatch"));
    await controller.check(); await controller.install();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "install", promptOpen: true });
    expect(deps.restart).not.toHaveBeenCalled();
  });
  it("retries a failed restart without downloading or installing again", async () => {
    const { controller, deps, update } = fixture();
    deps.restart.mockRejectedValueOnce(new Error("restart failed"));
    await controller.check(); await controller.install(); await controller.install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(deps.restart).toHaveBeenCalledTimes(2);
  });
  it("supports repeated manual checks outside Tauri without getting stuck", async () => {
    const { deps } = fixture();
    const controller = createUpdateController({ ...deps, enabled: () => false });
    await controller.check(true); await controller.check(true);
    expect(controller.getSnapshot().error).toBe("check");
    expect(deps.check).not.toHaveBeenCalled();
  });
});
