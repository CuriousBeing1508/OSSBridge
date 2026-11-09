import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288;

// Shows a small info sign that explains a term on hover, focus or tap.
// The explanation is drawn at the top level of the page, so cards and tables that scroll or grow do not cut it off.
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
        e.preventDefault();
        if (pos) hide(); else show();
      }}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-xs font-bold leading-none align-middle cursor-help select-none normal-case hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      i
      {pos && createPortal(
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
        </span>,
        document.body,
      )}
    </span>
  );
};

export const USED_BY_INFO = "These projects list this version as a dependency. Test dependencies are not counted.";

export const DEPENDENTS_INFO = "We checked the code of every project that lists this version. Only these projects "
  + "call the library. The others list it but never call it, or their code is not on Maven Central.";

export default InfoIcon;
