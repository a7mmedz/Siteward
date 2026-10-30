import { ShieldCheckIcon } from './icons';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <ShieldCheckIcon size={22} className="text-primary" strokeWidth={2.25} />
      <span className="text-lg font-bold tracking-tight text-ink">Siteward</span>
    </span>
  );
}
