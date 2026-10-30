import React, { useState } from "react";

const SearchBox = ({ onSearch }) => {
  const [query, setQuery] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSearch(query.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center mt-6">
      <input
        type="text"
        placeholder="🔍 Enter a library name (e.g., jackson)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border p-2 rounded w-64 mb-3 text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button
        type="submit"
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
      >
        Search
      </button>
    </form>
  );
};

export default SearchBox;
