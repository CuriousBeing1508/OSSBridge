import React from "react";

const VersionSelector = ({ versions, selectedVersion, onSelect }) => {
  if (!versions.length) return null;

  return (
    <div className="mt-5">
      <label className="block text-lg font-semibold mb-2">
        Select version:
      </label>
      <select
        className="border p-2 rounded w-64 text-center"
        value={selectedVersion}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">-- Select Version --</option>
        {versions.map((v, i) => (
          <option key={i} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
};

export default VersionSelector;
