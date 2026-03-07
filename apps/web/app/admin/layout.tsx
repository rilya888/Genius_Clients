import type { ReactNode } from "react";
import { SessionGate } from "./session-gate";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
