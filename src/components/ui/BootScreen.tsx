import { SplashScreen } from "./SplashScreen";

type Props = {
  label?: string;
  busy?: boolean;
  provision?: {
    phase: string;
    percent: number;
    message: string;
  } | null;
};

/** 引导阶段加载屏，与主应用 Splash 视觉一致。 */
export function BootScreen(props: Props) {
  return <SplashScreen {...props} />;
}
