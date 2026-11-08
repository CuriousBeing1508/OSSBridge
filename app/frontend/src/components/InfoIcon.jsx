// Shows a small info sign that explains a term when the viewer points at it.
const InfoIcon = ({ text }) => (
  <span title={text} aria-label={text} className="cursor-help text-gray-500">ⓘ</span>
);

export const DEPENDENTS_INFO = "Dependents are projects on Maven Central that use this version of the library "
  + "directly in their codebase. Projects that use it only in their tests, never call it, or have no jar "
  + "we can analyze are left out.";

export default InfoIcon;
