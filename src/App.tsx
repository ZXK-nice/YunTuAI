import { useEffect, useState, type ReactNode } from "react";
import { AppFrame } from "./components/layout/AppFrame";
import { AppShell } from "./components/layout/AppShell";
import { BootScreen } from "./components/ui/BootScreen";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ServiceReadinessScreen } from "./components/openclaw/ServiceReadinessScreen";
import { useOpenClawProvision } from "./hooks/useOpenClawProvision";
import { useOpenClawEnvSetup } from "./hooks/useOpenClawEnvSetup";
import { useStartupConnectGate } from "./hooks/useStartupConnectGate";
import { useAuthStore } from "./stores/authStore";
import { useLicenseStore } from "./stores/licenseStore";
import { useGatewayStore } from "./stores/gatewayStore";
import { ensureGatewayLifecycleListener } from "./lib/openclaw/gateway-lifecycle";
import { isApiKeyMissingConnectError } from "./lib/openclaw/api-key-policy";
import {
  resolvePreparingDetail,
  resolveStartupShellPhase,
} from "./lib/startup/startup-shell-phase";
import { isTauriRuntime } from "./lib/tauri-env";
import { cliGatewaySupervisorRestart } from "./lib/openclaw/cli-bridge";
import { isDesktopConnectInFlight } from "./lib/openclaw/desktop-connect-scheduler";
import {
  ensureBackgroundConnecting,
  isConnectOrchestrationInFlight,
  releaseConnectPipelineUiPhase,
  resetConnectPipelineUiSuppression,
} from "./lib/connect-with-feedback";
import { lazy, Suspense } from "react";

const LoginScreen = lazy(() =>
  import("./components/auth/LoginScreen").then((m) => ({ default: m.LoginScreen })),
);
const LicenseScreen = lazy(() =>
  import("./components/auth/LicenseScreen").then((m) => ({ default: m.LicenseScreen })),
);
const ApiKeySetupScreen = lazy(() =>
  import("./components/openclaw/ApiKeySetupScreen").then((m) => ({
    default: m.ApiKeySetupScreen,
  })),
);

function App() {
  const { isLoggedIn, isInitialized: authReady, initError: authInitError } = useAuthStore();
  const { licensed, isInitialized: licenseReady } = useLicenseStore();
  const connState = useGatewayStore((s) => s.connState);
  const [ready, setReady] = useState(false);
  const [reachedMain, setReachedMain] = useState(false);
  const { checking: provisionChecking, snapshot, blocking, retry } =
    useOpenClawProvision();
  const postLogin = ready && licenseReady && licensed && isLoggedIn;
  const {
    initialized: envSetupReady,
    status: envStatus,
    blocking: envBlocking,
    checkPending: envCheckPending,
    busy: envBusy,
    saveKeys: saveEnvKeys,
    refresh: refreshEnv,
  } = useOpenClawEnvSetup(postLogin);
  const startupConnect = useStartupConnectGate(
    postLogin && envSetupReady && !envBlocking,
    { provisionRetry: () => void retry() },
  );
  const apiKeyErrorFromGate = isApiKeyMissingConnectError(startupConnect.error);
  const allowOfflineMain = startupConnect.allowOfflineMain || reachedMain;

  const devAuthBooting =
    import.meta.env.DEV &&
    isTauriRuntime() &&
    ready &&
    licenseReady &&
    licensed &&
    !authReady &&
    !authInitError;

  const shellPhase = devAuthBooting
    ? "preparing"
    : resolveStartupShellPhase({
    ready,
    licenseReady,
    licensed,
    isLoggedIn,
    envSetupReady,
    envCheckPending,
    envBlocking,
    apiKeyErrorFromGate,
    hasEnvStatus: Boolean(envStatus),
    startupConnectActive: startupConnect.active,
    allowOfflineMain,
    connConnected: connState === "connected",
    isTauri: isTauriRuntime(),
  });

  const preparingDetail = resolvePreparingDetail({
    authReady: ready,
    licenseReady,
    provisionChecking,
    provisionSnapshot: snapshot,
    envCheckPending: envCheckPending || !envSetupReady,
    envSetupReady,
    connectLabel: devAuthBooting
      ? "开发版自动登录中（无需输入密码）…"
      : startupConnect.active
        ? startupConnect.label
        : null,
  });

  const preparingLiveProgress =
    postLogin && envSetupReady && !envBlocking && (startupConnect.active || connState !== "connected");

  useEffect(() => {
    if (isTauriRuntime()) ensureGatewayLifecycleListener();
    void Promise.all([
      useAuthStore.getState().initialize(),
      useLicenseStore.getState().initialize(),
    ]).then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (shellPhase === "main") {
      setReachedMain(true);
      releaseConnectPipelineUiPhase();
      if (isDesktopConnectInFlight() || isConnectOrchestrationInFlight()) {
        ensureBackgroundConnecting();
      }
    }
  }, [shellPhase]);

  useEffect(() => {
    if (!isLoggedIn) {
      setReachedMain(false);
      resetConnectPipelineUiSuppression();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!postLogin) return;
    if (!isApiKeyMissingConnectError(startupConnect.error)) return;
    void refreshEnv();
  }, [postLogin, startupConnect.error, refreshEnv]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const refreshLicense = () => {
      if (useLicenseStore.getState().isInitialized) {
        void useLicenseStore.getState().refresh();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshLicense();
    };
    window.addEventListener("focus", refreshLicense);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(refreshLicense, 10 * 60 * 1000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshLicense);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  let content: ReactNode;
  switch (shellPhase) {
    case "preparing":
      content =
        startupConnect.active &&
        startupConnect.mode === "provision" &&
        startupConnect.provisionSnapshot
          ? (
              <ServiceReadinessScreen
                mode="provision"
                snapshot={startupConnect.provisionSnapshot}
                onRetry={startupConnect.onRetry}
                canEnterOffline={startupConnect.canEnterOffline}
                onEnterOffline={startupConnect.onEnterOffline}
              />
            )
          : (
              <ServiceReadinessScreen
                mode="startup"
                detail={preparingDetail}
                error={startupConnect.error}
                onRetry={
                  startupConnect.error
                    ? startupConnect.onRetry
                    : blocking
                      ? () => void retry()
                      : undefined
                }
                liveProgress={preparingLiveProgress}
                canEnterOffline={startupConnect.canEnterOffline}
                onEnterOffline={startupConnect.onEnterOffline}
              />
            );
      break;
    case "license":
      content = (
        <Suspense fallback={<BootScreen label="正在加载…" busy />}>
          <LicenseScreen />
        </Suspense>
      );
      break;
    case "login":
      content = (
        <Suspense fallback={<BootScreen label="正在加载…" busy />}>
          <LoginScreen />
        </Suspense>
      );
      break;
    case "api_key":
      content = (
        <Suspense fallback={<BootScreen label="正在加载…" busy />}>
          <ApiKeySetupScreen
            keys={envStatus!.keys}
            envPath={envStatus!.envPath}
            busy={envBusy}
            onSave={async (values) => {
              if (Object.keys(values).length === 0) {
                await refreshEnv();
                await cliGatewaySupervisorRestart().catch(() => null);
                return;
              }
              const snap = await saveEnvKeys(values);
              if (!snap) throw new Error("保存失败，请重试");
              await cliGatewaySupervisorRestart().catch(() => null);
            }}
          />
        </Suspense>
      );
      break;
    default:
      content = (
        <ErrorBoundary section="主界面">
          <AppShell />
        </ErrorBoundary>
      );
      break;
  }

  return <AppFrame>{content}</AppFrame>;
}

export default App;
