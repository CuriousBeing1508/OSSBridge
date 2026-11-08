import React, { useRef, useState } from "react";

const WIDTH = 288;

// Shows a small info sign that explains a term on hover, focus or tap.
// The explanation is placed on the screen itself, so tables that scroll do not cut it off.
const InfoIcon = ({ text }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const show = () => {
    const r = ref.current.getBoundingClientRect();
    const half = WIDTH / 2 + 8;
    const left = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half);
    const below = r.top < 140;
    setPos({ left, top: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      tabIndex={0}
      role="button"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => {
        e.stopPropagation();
        if (pos) hide(); else show();
      }}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-xs font-bold leading-none align-middle cursor-help select-none normal-case hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      i
      {pos && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: WIDTH,
            transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
          }}
          className="z-50 rounded-md bg-gray-900 px-3 py-2 text-xs font-normal leading-snug text-left text-white shadow-lg whitespace-normal normal-case tracking-normal pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
};

export const DEPENDENTS_INFO = "Dependents are projects on Maven Central that use this version of the library "
  + "directly in their codebase. Projects that use it only in their tests, never call it, or have no jar "
  + "we can analyze are left out.";

export default InfoIcon;
