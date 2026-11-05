import type { ReactNode } from "react";
import { WindowTitleBar } from "./WindowTitleBar";

type Props = {
  children: ReactNode;
};

export function AppFrame({ children }: Props) {
  return (
    <div className="app-frame flex h-full min-h-0 flex-col">
      <WindowTitleBar />
      <div className="app-frame__body min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
