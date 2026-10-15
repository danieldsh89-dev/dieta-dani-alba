import type { ReactNode, SVGProps } from 'react';

/** Iconos propios de trazo (24×24, trazo 1.75, extremos redondeados) para la navegación y el cromo de la app. */
export type IconName =
  | 'hoy'
  | 'plan'
  | 'generar'
  | 'casa'
  | 'favoritos'
  | 'mas'
  | 'mic'
  | 'search'
  | 'cloud'
  | 'sync'
  | 'alert'
  | 'offline'
  | 'back'
  | 'chevron'
  | 'leaf'
  | 'trend'
  | 'cart'
  | 'users'
  | 'scale'
  | 'pot'
  | 'history'
  | 'archive'
  | 'close'
  | 'plus'
  | 'flame';

const PATHS: Record<IconName, ReactNode> = {
  // plato con cubiertos
  hoy: (
    <>
      <circle cx="13" cy="12" r="6.5" />
      <circle cx="13" cy="12" r="3" />
      <path d="M3.5 4v5.5M2 4v3.5a1.5 1.5 0 0 0 3 0V4M3.5 9.5V20" />
    </>
  ),
  plan: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" strokeWidth="2.4" />
    </>
  ),
  // chispa: generar combinación
  generar: (
    <>
      <path d="M12 3.5l1.9 4.9a2 2 0 0 0 1.2 1.2L20 11.5l-4.9 1.9a2 2 0 0 0-1.2 1.2L12 19.5l-1.9-4.9a2 2 0 0 0-1.2-1.2L4 11.5l4.9-1.9a2 2 0 0 0 1.2-1.2z" />
      <path d="M19 3v3M17.5 4.5h3" />
    </>
  ),
  // tarro de despensa
  casa: (
    <>
      <path d="M7 6.5h10" />
      <rect x="7.5" y="3" width="9" height="3.5" rx="1" />
      <path d="M6.5 6.5h11a1.5 1.5 0 0 1 1.5 1.5v10.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18.5V8a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M5 12h14" />
    </>
  ),
  favoritos: <path d="M12 4l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77z" />,
  mas: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z" />,
  sync: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5" />
      <path d="M17.8 3.5v3.7h-3.7M6.2 20.5v-3.7h3.7" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3L2.9 17.2A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 16.8h.01" />
    </>
  ),
  offline: (
    <>
      <path d="M7 18.5h10.5M18.6 10.6A6 6 0 0 0 9.3 6.3M6.6 9.6A4.5 4.5 0 0 0 7 18.5" />
      <path d="M3.5 3.5l17 17" />
    </>
  ),
  back: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevron: <path d="M9.5 6l6 6-6 6" />,
  leaf: (
    <>
      <path d="M5 19c0-8 5-13.5 14-14-.4 9-6 14-14 14z" />
      <path d="M5 19l7-7" />
    </>
  ),
  trend: (
    <>
      <path d="M3.5 17l5.5-5.5 4 4 7.5-7.5" />
      <path d="M15 8h5.5v5.5" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.2l2.1 10.2a1.8 1.8 0 0 0 1.8 1.4h7.8a1.8 1.8 0 0 0 1.7-1.3L20.5 8H6.1" />
      <circle cx="9.5" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.8 19.5a6.3 6.3 0 0 1 12.4 0" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.8 14a6.3 6.3 0 0 1 3.4 5.5" />
    </>
  ),
  scale: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="4" />
      <path d="M8.5 9.5a5 5 0 0 1 7 0L13.3 12a1.8 1.8 0 0 0-2.6 0z" />
    </>
  ),
  pot: (
    <>
      <path d="M4.5 10h15v6.5a3.5 3.5 0 0 1-3.5 3.5H8a3.5 3.5 0 0 1-3.5-3.5z" />
      <path d="M2.5 10h19M9 6.5c0-1.2 1-1.2 1-2.4M14 6.5c0-1.2 1-1.2 1-2.4" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.2l3 1.8" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.5" />
      <path d="M5 8.5v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  flame: <path d="M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-.8 2-2 3-3 3.5C11 7 10.5 5 11 3 7.5 5 6 9.5 6 15a6 6 0 0 0 6 6z" />,
};

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
