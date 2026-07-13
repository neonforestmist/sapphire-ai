import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="SapphireAI home">
      <span className="brand-mark" aria-hidden="true" />
      {!compact && <span>SapphireAI</span>}
    </Link>
  );
}
