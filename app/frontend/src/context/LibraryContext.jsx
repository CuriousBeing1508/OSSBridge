import React, { createContext, useContext, useState } from "react";

const LibraryContext = createContext();

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibrary must be used within LibraryProvider");
  }
  return context;
};

export const LibraryProvider = ({ children }) => {
  const [library, setLibrary] = useState("");
  const [version, setVersion] = useState("");

  return (
    <LibraryContext.Provider
      value={{
        library,
        version,
        setLibrary,
        setVersion,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
};