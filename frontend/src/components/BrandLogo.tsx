import React, { useId } from 'react';

interface BrandLogoProps {
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'h-10 w-10' }) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `logo-bg-${uid}`;
  const glowId = `logo-glow-${uid}`;
  const paperId = `logo-paper-${uid}`;
  const foldId = `logo-fold-${uid}`;
  const checkId = `logo-check-${uid}`;
  const sparkId = `logo-spark-${uid}`;
  const shadowId = `logo-shadow-${uid}`;
  const badgeShadowId = `logo-bshadow-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="10" y1="6" x2="118" y2="122" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="50%" stopColor="#3730a3" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <radialGradient id={glowId} cx="24%" cy="16%" r="68%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={paperId} x1="28" y1="22" x2="94" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef2ff" />
        </linearGradient>
        <linearGradient id={foldId} x1="72" y1="22" x2="92" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c7d2fe" />
          <stop offset="100%" stopColor="#a5b4fc" />
        </linearGradient>
        <linearGradient id={checkId} x1="78" y1="74" x2="112" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id={sparkId} x1="90" y1="12" x2="114" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="52%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <filter id={shadowId} x="-14%" y="-10%" width="132%" height="132%">
          <feDropShadow dx="0" dy="5" stdDeviation="4.5" floodColor="#0f172a" floodOpacity="0.28" />
        </filter>
        <filter id={badgeShadowId} x="-20%" y="-20%" width="145%" height="145%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#0f172a" floodOpacity="0.32" />
        </filter>
      </defs>

      <rect x="4" y="4" width="120" height="120" rx="28" fill={`url(#${bgId})`} />
      <rect x="4" y="4" width="120" height="120" rx="28" fill={`url(#${glowId})`} />
      <rect
        x="5.5"
        y="5.5"
        width="117"
        height="117"
        rx="26.5"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="1.5"
      />

      <g transform="rotate(-7.5 54 68)" opacity="0.26">
        <rect x="21" y="28" width="60" height="78" rx="9" fill="#c7d2fe" />
      </g>

      <g filter={`url(#${shadowId})`}>
        <path
          d="M36 22 H73 L93 42 V94 C93 99.523 88.523 104 83 104 H36 C30.477 104 26 99.523 26 94 V32 C26 26.477 30.477 22 36 22 Z"
          fill={`url(#${paperId})`}
        />
        <path d="M73 22 V35 C73 38.866 76.134 42 80 42 H93 L73 22 Z" fill={`url(#${foldId})`} />
      </g>

      <rect x="35" y="34" width="26" height="5" rx="2.5" fill="#e11d48" opacity="0.9" />

      <g stroke="#4338ca" strokeWidth="2.1">
        <rect x="35" y="47" width="19" height="19" rx="3.5" fill="#ffffff" />
        <rect x="35" y="70" width="19" height="19" rx="3.5" fill="#ffffff" />
      </g>
      <g stroke="#a5b4fc" strokeWidth="1.3" strokeDasharray="2.4 2.4">
        <line x1="44.5" y1="49" x2="44.5" y2="64" />
        <line x1="37" y1="56.5" x2="52" y2="56.5" />
        <line x1="44.5" y1="72" x2="44.5" y2="87" />
        <line x1="37" y1="79.5" x2="52" y2="79.5" />
      </g>

      <rect x="61" y="49" width="22" height="4.5" rx="2.25" fill="#6366f1" opacity="0.85" />
      <rect x="61" y="59" width="18" height="4.5" rx="2.25" fill="#94a3b8" opacity="0.72" />
      <rect x="61" y="69" width="22" height="4.5" rx="2.25" fill="#94a3b8" opacity="0.58" />
      <rect x="61" y="79" width="13" height="4.5" rx="2.25" fill="#94a3b8" opacity="0.45" />

      <path
        d="M100 13 C101.2 21.5 103.5 23.8 112 25 C103.5 26.2 101.2 28.5 100 37 C98.8 28.5 96.5 26.2 88 25 C96.5 23.8 98.8 21.5 100 13 Z"
        fill={`url(#${sparkId})`}
      />
      <path
        d="M111 36 C111.6 39.6 112.4 40.4 116 41 C112.4 41.6 111.6 42.4 111 46 C110.4 42.4 109.6 41.6 106 41 C109.6 40.4 110.4 39.6 111 36 Z"
        fill="#fde68a"
      />

      <g filter={`url(#${badgeShadowId})`}>
        <circle cx="93" cy="92" r="18.5" fill="#ffffff" />
        <circle cx="93" cy="92" r="15.8" fill={`url(#${checkId})`} />
        <path
          d="M85.8 92.3 L90.8 97.3 L100.8 87"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};
