import React from "react";
import InfoIcon from "./InfoIcon";

// Marks a library that few widely used projects depend on. Hovering the sign tells what it means.
// popular is the number of dependent projects that other projects depend on.
const FewDependentsBadge = ({ popular }) => (
  <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
    Few dependents
    <InfoIcon
      text={`Only ${Number(popular || 0).toLocaleString()} widely used projects depend on it. `
        + "Results that come from so few projects may not show how the library is used in general."}
    />
  </span>
);

export default FewDependentsBadge;
