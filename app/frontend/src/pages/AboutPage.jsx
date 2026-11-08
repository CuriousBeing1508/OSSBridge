import React from "react";
import Header from "../components/Header";

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentPage="about" />
      
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-gray-800 mb-6">
          About API Usage Analytics
        </h1>
        
        <div className="bg-white rounded-lg shadow p-8 space-y-6">
          <section>
            <h2 className="text-2xl font-semibold text-gray-700 mb-3">
              What is this tool?
            </h2>
            <p className="text-gray-600 leading-relaxed">
              API Usage Analytics helps library maintainers and developers understand
              how their libraries are being used in the wild. We analyze thousands of
              dependent projects to provide insights about API usage patterns, popular
              methods, and integration strategies.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-700 mb-3">
              Features
            </h2>
            <ul className="list-disc list-inside text-gray-600 space-y-2">
              <li>Track which APIs are most popular across dependents</li>
              <li>Understand usage intensity and integration depth</li>
              <li>Identify breaking change impact before releasing</li>
              <li>Discover package and class usage patterns</li>
              <li>Monitor version adoption across the ecosystem</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-700 mb-3">
              For Maintainers
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Use the Maintainer Summary to get a bird's-eye view of how your library
              is being used. Make informed decisions about deprecations, understand
              which features matter most, and prioritize your roadmap based on real
              usage data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-700 mb-3">
              For Users
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Open the What dependents use tab to see every analyzed project. Click a
              project to see which packages, classes and methods of the library it uses.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-700 mb-3">
              Contact us
            </h2>
            <p className="text-gray-600 leading-relaxed">
              To contact the lab, use the contact page at{" "}
              <a href="https://realiselab.github.io/contact" target="_blank" rel="noopener noreferrer"
                 className="text-blue-600 underline hover:no-underline">https://realiselab.github.io/contact</a>.
              To report a problem or ask for a feature, open an issue at{" "}
              <a href="https://github.com/CuriousBeing1508/OSSBridge/issues" target="_blank" rel="noopener noreferrer"
                 className="text-blue-600 underline hover:no-underline">https://github.com/CuriousBeing1508/OSSBridge/issues</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;