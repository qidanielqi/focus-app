import { createContext, useContext, type ReactNode } from "react";
import { useTimer } from "./useTimer";
const TimerContext = createContext<ReturnType<typeof useTimer> | null>(null);
export function TimerProvider({ children }: { children: ReactNode }) {
  const timer = useTimer();
  return <TimerContext.Provider value={timer}>{children}</TimerContext.Provider>;
}
export function useMainTimer() {
  const timer = useContext(TimerContext);
  if (!timer) throw new Error("Main timer provider missing");
  return timer;
}
