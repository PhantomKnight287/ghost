import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const SyncIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M2.5 5.5h10L10 3M13.5 10.5h-10L6 13" />
  </svg>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </svg>
);

export const ArrowRightIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M8 2.5 14 13H2L8 2.5Z" />
    <path d="M8 6.5v2.5M8 11h.01" />
  </svg>
);

export const ExternalIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M7 3.5H3.5v9h9V9M9.5 2.5h4v4M13.5 2.5l-6 6" />
  </svg>
);

export const PlusIcon = (props: IconProps) => (
  <svg {...stroke} {...props}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
