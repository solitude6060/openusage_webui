export function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "success" | "muted";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}
