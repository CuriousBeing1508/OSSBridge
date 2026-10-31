import React from "react";
import { useNavigate } from "react-router-dom";
import { useLibrary } from "../context/LibraryContext";
import { pageUrl } from "../utils/pageUrl";

const Header = ({ currentPage = "home" }) => {
  const navigate = useNavigate();
  const { library, version } = useLibrary();

  const handleNavigation = (path) => {
    if (path === "/analysisV2/maintainer-summary" || path === "/analysisV2") {
      if (!library || !version) {
        alert("Please select a library and version from the home page first!");
        navigate("/");
        return;
      }
      navigate(pageUrl(path, { library, version }), { state: { library, version } });
    } else {
      navigate(path);
    }
  };

  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div
            onClick={() => navigate("/")}
            className="flex items-center cursor-pointer hover:opacity-80 transition"
          >
            <div className="bg-green-600 text-white font-bold text-xl px-3 py-1 rounded">
              OSSBridge
            </div>
            <span className="ml-2 text-xl font-semibold text-gray-800">
              API Usage Analytics
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex space-x-1">
            {currentPage !== "home" && (
              <>
                <button
                  onClick={() => handleNavigation("/analysisV2/maintainer-summary")}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    currentPage === "maintainer"
                      ? "bg-green-100 text-green-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                  disabled={!library || !version}
                >
                  Maintainer Summary
                </button>
                <button
                  onClick={() => handleNavigation("/analysisV2")}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    currentPage === "user"
                      ? "bg-green-100 text-green-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                  disabled={!library || !version}
                >
                  User Summary
                </button>
              </>
            )}
            <button
              onClick={() => navigate("/about")}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                currentPage === "about"
                  ? "bg-green-100 text-green-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              About
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;