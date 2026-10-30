import React from "react";

const DependentsInfo = ({ data }) => {
  if (!data) return null;

  return (
    <div className="mt-8 p-4 border rounded shadow-md bg-gray-50 w-96 text-center">
      <h3 className="text-xl font-bold mb-2">
         {data.library} v{data.version}
      </h3>
      <p className="text-gray-700 mb-4">
        Total dependents:{" "}
        <span className="font-semibold text-blue-600">
          {data.dependentsCount}
        </span>
      </p>

      {/* {data.sample?.length > 0 && (
        <div className="text-left">
          <p className="font-semibold mb-2">Sample dependents:</p>
          <ul className="list-disc list-inside text-sm">
            {data.sample.map((d, i) => (
              <li key={i}>{JSON.stringify(d)}</li>
            ))}
          </ul>
        </div>
      )} */}
    </div>
  );
};

export default DependentsInfo;
