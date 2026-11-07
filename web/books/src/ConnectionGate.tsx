import type { ReactNode } from "react";
import { useConnection } from "@vantage-ui/client/react";

// Before the first connection, and when the server refuses this page for good.

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-chrome-light">
      <div className="w-96 rounded-lg border border-chrome bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 h-1 w-24 overflow-hidden rounded bg-chrome">
          <div className="h-full w-1/3 animate-[shimmer_1.1s_linear_infinite] bg-accent" />
        </div>
        <h1 className="font-semibold text-brand">{title}</h1>
        {children && <p className="mt-1 text-sm text-ink-soft">{children}</p>}
      </div>
    </div>
  );
}

export function ConnectionGate({ children }: { children?: ReactNode }) {
  const { status, error } = useConnection();
  if (status === "refused") return <Screen title="The books refused this connection">{error}</Screen>;
  if (status === "protocol_mismatch") {
    return <Screen title="This page is out of date"><button className="text-accent underline" onClick={() => location.reload()}>Reload</button> to get the new version.</Screen>;
  }
  return children ?? <Screen title="Opening the books…" />;
}
