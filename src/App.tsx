import { TimerProvider } from "./hooks/TimerContext";
import { reconcileAutoHideSetting, revealTimerFromShortcut } from "./native";
import { registerRevealShortcut } from "./shortcuts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TimerPage } from "./components/TimerPage";
import { PopoutTimer } from "./components/PopoutTimer";
import { PopoutMenu } from "./components/PopoutMenu";
import { AutoHideTab } from "./components/AutoHideTab";
import { AcademicYearsPage, HistoryPage, SubjectsPage } from "./components/ManagementPages";
import { ImportExportPage } from "./components/ImportExportPage";
import { SettingsPage } from "./components/SettingsPage";
import { UpdatePrompt } from "./components/Updater";
import { ToastHost } from "./components/ToastHost";
import { useSettings } from "./hooks/useSettings";
import i18n from "./i18n";
import { useTranslation } from "react-i18next";
import { hasActiveTimer } from "./settings";
import { usePopoutLifecycle } from "./hooks/usePopoutLifecycle";

const AnalyticsPage = lazy(() => import("./components/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [page, setPage] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get("analyticsDemo") === "1" ? "Analytics" : "Timer");
  const isPopoutMenu = window.location.hash.includes("popout-menu");
  const isAutoHideTab = window.location.hash.includes("auto-hide-tab");
  const isPopout = window.location.hash.includes("popout") || isAutoHideTab;
  usePopoutLifecycle(!isPopout);
  const { settings, loaded } = useSettings();
  const { t } = useTranslation();
  const [closeWarning, setCloseWarning] = useState(false);
  const [secondInstanceWarning, setSecondInstanceWarning] = useState(false);
  const initialWindowStateApplied = useRef(false);

  useEffect(() => {
    if (!isTauri() || isPopout) return;
    // Analytics needs room for five metrics and its fixed weekday/time grid.
    void invoke("set_main_minimum_width", { width: page === "Analytics" ? 1040 : 420 }).catch(console.error);
  }, [page, isPopout]);

  useEffect(() => {
    if (isTauri() && !isPopout && loaded) void registerRevealShortcut(settings.popoutRevealShortcut).catch(() => undefined);
  }, [isPopout, loaded, settings.popoutRevealShortcut]);

  useEffect(() => {
    if (!isPopout && loaded) void reconcileAutoHideSetting().catch(console.error);
  }, [isPopout, loaded, settings.popoutDockAutoHide]);
  useEffect(() => {
    if (!isTauri() || isPopout) return;
    const subscription = listen("focus://reveal-shortcut", () => { void revealTimerFromShortcut().catch(console.error); });
    return () => { void subscription.then(stop => stop()); };
  }, [isPopout]);

  useEffect(() => { void i18n.changeLanguage(settings.language); }, [settings.language]);
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.theme = settings.theme;
    try { localStorage.setItem("focus.theme", settings.theme); } catch { /* The database remains authoritative. */ }
  }, [loaded, settings.theme]);

  useEffect(() => {
    if (!isTauri() || isPopout || !loaded || initialWindowStateApplied.current) return;
    initialWindowStateApplied.current = true;
    const window = getCurrentWindow();
    void (settings.startMaximized ? window.maximize() : window.unmaximize()).catch(() => undefined);
  }, [isPopout, loaded, settings.startMaximized]);

  useEffect(() => {
    if (!isTauri() || isPopout) return;
    let stopClose: (() => void) | undefined; let stopSecond: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      if (hasActiveTimer()) setCloseWarning(true);
      else void invoke("close_main_window");
    }).then((stop) => { stopClose = stop; });
    void listen("focus://second-instance", () => setSecondInstanceWarning(true)).then((stop) => { stopSecond = stop; });
    return () => { stopClose?.(); stopSecond?.(); };
  }, [isPopout]);

  if (isPopoutMenu) return <PopoutMenu />;
  if (isAutoHideTab) return <AutoHideTab />;
  if (isPopout) return <PopoutTimer />;

  return (
    <TimerProvider><div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`} data-accent={settings.accentColour} data-theme={settings.theme} data-scale={settings.uiScale}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} active={page} onNavigate={setPage} />
      <UpdatePrompt ready={loaded} />
      <ToastHost />
      {page === "Timer" && <TimerPage />}
      {page === "Analytics" && <Suspense fallback={<main className="page"><div className="analytics-loading">{t("Loading analytics...")}</div></main>}><AnalyticsPage /></Suspense>}
      {page === "Academic Years" && <AcademicYearsPage />}
      {page === "Subjects" && <SubjectsPage />}
      {page === "History" && <HistoryPage />}
      {page === "Import / Export" && <ImportExportPage onNavigate={setPage} />}
      {page === "Settings" && <SettingsPage onNavigate={setPage} />}
      {!['Timer', 'Analytics', 'Academic Years', 'Subjects', 'History', 'Import / Export', 'Settings'].includes(page) && <main className="page"><div className="empty-state"><h1>{t(page)}</h1><p>{t("Coming in a later milestone.")}</p></div></main>}
      {closeWarning && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><h2>{t("Close Focus while a timer is active?")}</h2><p>{t("The timer will be recovered the next time Focus opens. No Session will be finalized by closing the app.")}</p><div className="modal-actions"><button onClick={() => setCloseWarning(false)}>{t("Cancel")}</button><button className="danger-action" onClick={() => void invoke("close_main_window")}>{t("Close Focus")}</button></div></section></div>}
      {secondInstanceWarning && <div className="modal-backdrop"><section className="modal" role="alertdialog" aria-modal="true"><h2>{t("Focus is already running")}</h2><p>{t("The existing Focus window has been brought to the front.")}</p><div className="modal-actions"><button className="primary-action" onClick={() => setSecondInstanceWarning(false)}>{t("OK")}</button></div></section></div>}
    </div></TimerProvider>
  );
}
