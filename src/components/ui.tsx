import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/* ---------------- Button ---------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children,
  variant = 'secondary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white hover:bg-accent/90 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]',
    secondary: 'bg-ink-800 text-txt border border-ink-700 hover:bg-ink-700/70',
    ghost: 'text-txt-muted hover:text-txt hover:bg-ink-800/60',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-600',
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/* ---------------- Card ---------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-ink-900 border border-ink-700 rounded-xl ${className}`}>{children}</div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div>
        <h3 className="text-sm font-semibold text-txt">{title}</h3>
        {subtitle && <p className="text-xs text-txt-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Form controls ---------------- */

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-txt-muted mb-1.5">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-[11px] text-txt-dim mt-1">{hint}</span>}
      {error && <span className="block text-[11px] text-rose-400 mt-1">{error}</span>}
    </label>
  );
}

const inputCls =
  'w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2.5 text-sm text-txt placeholder:text-txt-dim focus:border-accent focus:outline-none transition-colors';

export function Input({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputCls} ${className}`} {...rest}>{children}</select>;
}

export function Textarea({ className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputCls} min-h-[80px] ${className}`} {...rest} />;
}

/* ---------------- Badges ---------------- */

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'demo';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-800 text-txt-muted border-ink-700',
    accent: 'bg-accent-soft text-accent border-accent/30',
    positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    negative: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    demo: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={`relative bg-ink-900 border border-ink-700 rounded-t-2xl sm:rounded-2xl w-full ${width} max-h-[92vh] sm:max-h-[85vh] flex flex-col animate-fadeUp`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-ink-700">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-txt-muted hover:text-txt hover:bg-ink-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="border-t border-ink-700 px-5 py-3.5 flex justify-end gap-2 bg-ink-850 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Empty state ---------------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      <div className="w-14 h-14 rounded-2xl bg-ink-800 border border-ink-700 flex items-center justify-center text-txt-muted mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-txt">{title}</h3>
      <p className="text-sm text-txt-muted mt-1.5 max-w-sm leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------- Skeleton ---------------- */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-800 rounded-lg animate-pulse ${className}`} />;
}
