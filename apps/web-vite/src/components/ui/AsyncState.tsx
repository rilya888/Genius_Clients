import type { ReactNode } from "react";

export function LoadingState({ text }: { text: string }) {
  return <p className="status-muted">{text}</p>;
}

export function ErrorState({ text }: { text: string }) {
  return <p className="status-error">{text}</p>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state card-hover">
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
