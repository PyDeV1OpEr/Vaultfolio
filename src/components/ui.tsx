import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X, XCircle, type LucideIcon } from 'lucide-react';

/* ═══════════════════════════════════════════
   BUTTON
═══════════════════════════════════════════ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-120 disabled:opacity-50 disabled:cursor-not-allowed select-none';

const BTN_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-2xs rounded-md gap-1.5',
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-9 px-4 text-sm rounded-lg gap-2',
  lg: 'h-11 px-5 text-base rounded-xl gap-2.5',
};

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:scale-[0.97] shadow-btn-primary hover:shadow-btn-primary-hover',
  secondary:
    'bg-ink-800 text-txt border border-ink-700 hover:bg-ink-750 hover:border-ink-650 active:scale-[0.97]',
  ghost:
    'text-txt-muted hover:text-txt hover:bg-ink-800/70 active:bg-ink-800',
  danger:
    'bg-negative-soft text-negative border border-negative-border hover:bg-negative/20 active:scale-[0.97]',
  outline:
    'text-accent border border-accent-border hover:bg-accent-soft active:scale-[0.97]',
};

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={`${BTN_BASE} ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════
   ICON BUTTON (compact square/round button)
═══════════════════════════════════════════ */

export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  className = '',
  ...rest
}: {
  icon: ReactNode;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz = { xs: 'w-7 h-7 rounded-md', sm: 'w-8 h-8 rounded-lg', md: 'w-9 h-9 rounded-lg' }[size];
  const v = variant === 'secondary'
    ? 'bg-ink-800 border border-ink-700 hover:bg-ink-750 text-txt-muted hover:text-txt'
    : 'text-txt-muted hover:text-txt hover:bg-ink-800/70';
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center transition-all duration-120 disabled:opacity-50 ${sz} ${v} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
}

/* ═══════════════════════════════════════════
   CARD
═══════════════════════════════════════════ */

export function Card({
  children,
  className = '',
  elevated = false,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={`
        bg-ink-900 border border-ink-700 rounded-xl overflow-hidden
        ${elevated ? 'shadow-elev-2' : ''}
        ${interactive ? 'card-lift cursor-pointer hover:border-ink-650' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  compact = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${compact ? 'px-4 pt-3.5 pb-2.5' : 'px-5 pt-4 pb-3'}`}>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-txt leading-tight">{title}</h3>
        {subtitle && (
          <p className="text-xs text-txt-muted mt-0.5 leading-relaxed">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardDivider() {
  return <div className="border-t border-ink-700/60 mx-5" />;
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-5 ${className}`}>{children}</div>;
}

/* ═══════════════════════════════════════════
   DIVIDER
═══════════════════════════════════════════ */

export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-t border-ink-700/70 ${className}`} />;
}

/* ═══════════════════════════════════════════
   FORM FIELD
═══════════════════════════════════════════ */

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
      <span className="block text-xs font-medium text-txt-muted mb-1.5 leading-none">
        {label}
        {required && <span className="text-accent ml-0.5">*</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="block text-2xs text-txt-dim mt-1 leading-relaxed">{hint}</span>
      )}
      {error && (
        <span className="flex items-center gap-1 text-2xs text-negative mt-1">
          <AlertCircle size={10} />
          {error}
        </span>
      )}
    </label>
  );
}

/* ═══════════════════════════════════════════
   INPUTS
═══════════════════════════════════════════ */

const INPUT_BASE =
  'w-full bg-ink-800 border border-ink-700 rounded-lg px-3 text-sm text-txt placeholder:text-txt-faint focus:border-accent focus:outline-none transition-colors duration-120 h-9';

export function Input({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT_BASE} ${className}`} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${INPUT_BASE} ${className} cursor-pointer`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${INPUT_BASE} py-2.5 h-auto min-h-[80px] resize-y ${className}`}
      {...rest}
    />
  );
}

/* ═══════════════════════════════════════════
   BADGES / CHIPS
═══════════════════════════════════════════ */

type BadgeTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'demo';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-800 text-txt-muted border-ink-700',
  accent: 'bg-accent-soft text-accent border-accent-border',
  positive: 'bg-positive-soft text-positive border-positive-border',
  negative: 'bg-negative-soft text-negative border-negative-border',
  warning: 'bg-warning-soft text-warning border-warning-border',
  demo: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ═══════════════════════════════════════════
   MODAL
═══════════════════════════════════════════ */

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 modal-backdrop"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 animate-fadeIn"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={ref}
        className={`
          relative bg-ink-900 border border-ink-700 shadow-elev-4
          rounded-t-2xl sm:rounded-2xl w-full ${width}
          max-h-[92vh] sm:max-h-[88vh] flex flex-col
          animate-scaleIn
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-ink-700/80">
          <h2 className="text-base font-semibold text-txt leading-tight">{title}</h2>
          <IconButton
            icon={<X size={15} />}
            label="Close"
            size="sm"
            onClick={onClose}
          />
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-ink-700/80 px-5 py-3.5 flex justify-end gap-2 bg-ink-875 rounded-b-2xl shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CONFIRMATION DIALOG (specialized modal)
═══════════════════════════════════════════ */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md">
      <p className="text-sm text-txt-muted leading-relaxed">{description}</p>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant={variant} size="sm" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════ */

export function EmptyState({
  icon,
  title,
  body,
  action,
  size = 'md',
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const py = { sm: 'py-10', md: 'py-14', lg: 'py-20' }[size];
  return (
    <div className={`flex flex-col items-center text-center px-6 ${py}`}>
      <div className="w-14 h-14 rounded-2xl bg-ink-800/80 border border-ink-700 flex items-center justify-center text-txt-muted mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-txt leading-tight">{title}</h3>
      <p className="text-sm text-txt-muted mt-2 max-w-sm leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SKELETON
═══════════════════════════════════════════ */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-shimmer rounded-lg ${className}`} aria-hidden="true" />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card className="p-4 space-y-3">
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </Card>
  );
}

/* ═══════════════════════════════════════════
   STAT CARD  (reusable KPI card)
═══════════════════════════════════════════ */

export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative';
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
}) {
  const valueColor =
    tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-txt';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-txt-muted leading-none">{label}</p>
        {icon && (
          <span className="w-7 h-7 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center text-txt-dim">
            {icon}
          </span>
        )}
      </div>
      <p
        className={`text-xl font-semibold tnum value-display leading-none tracking-tight ${valueColor}`}
      >
        {value || <span className="text-txt-dim font-normal text-base">—</span>}
      </p>
      {sub && (
        <p className="text-2xs text-txt-dim mt-2 leading-relaxed">{sub}</p>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════
   SECTION HEADER
═══════════════════════════════════════════ */

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3">
      <p className="text-2xs font-semibold uppercase tracking-wider text-txt-dim">{title}</p>
      {action}
    </div>
  );
}

/* ═══════════════════════════════════════════
   INLINE ALERT (small banners inside cards)
═══════════════════════════════════════════ */

type AlertKind = 'info' | 'warning' | 'error' | 'success';

const ALERT_STYLES: Record<AlertKind, string> = {
  info: 'bg-accent-soft border-accent-border text-accent',
  warning: 'bg-warning-soft border-warning-border text-warning',
  error: 'bg-negative-soft border-negative-border text-negative',
  success: 'bg-positive-soft border-positive-border text-positive',
};

const ALERT_ICONS: Record<AlertKind, LucideIcon> = {
  info: Info,
  warning: AlertCircle,
  error: XCircle,
  success: CheckCircle2,
};

export function InlineAlert({
  kind = 'info',
  children,
}: {
  kind?: AlertKind;
  children: ReactNode;
}) {
  const Icon = ALERT_ICONS[kind];
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 flex items-start gap-2.5 text-xs ${ALERT_STYLES[kind]}`}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════
   PROGRESS BAR
═══════════════════════════════════════════ */

export function ProgressBar({
  value,
  max = 100,
  className = '',
  tone = 'accent',
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: 'accent' | 'positive' | 'warning' | 'negative';
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const colors = {
    accent: 'bg-accent',
    positive: 'bg-positive',
    warning: 'bg-warning',
    negative: 'bg-negative',
  };
  return (
    <div className={`h-1.5 rounded-full bg-ink-800 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-350 ${colors[tone]}`}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════
   TABS
═══════════════════════════════════════════ */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-0.5 bg-ink-800/60 rounded-lg p-0.5 border border-ink-700" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`
            flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-120
            ${active === t.id
              ? 'bg-ink-900 text-txt border border-ink-700 shadow-elev-1'
              : 'text-txt-muted hover:text-txt'}
          `}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TOOLTIP (simple hover tooltip)
═══════════════════════════════════════════ */

export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="
        pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
        bg-ink-800 border border-ink-700 text-txt text-2xs rounded-md px-2 py-1
        whitespace-nowrap opacity-0 group-hover:opacity-100
        transition-opacity duration-120 z-50 shadow-elev-2
      ">
        {content}
      </span>
    </span>
  );
}

/* ═══════════════════════════════════════════
   PILL (category filter chip)
═══════════════════════════════════════════ */

export function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`
        shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5
        text-xs font-medium transition-all duration-120
        ${active
          ? 'bg-accent-soft border-accent-border text-accent'
          : 'bg-ink-900 border-ink-700 text-txt-muted hover:text-txt hover:border-ink-600 hover:bg-ink-800/50'}
      `}
    >
      {children}
    </button>
  );
}
