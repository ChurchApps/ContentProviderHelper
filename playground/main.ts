import { hello, VERSION } from "../src";

const outputEl = document.getElementById("output");

if (outputEl) {
  outputEl.innerHTML = `
    <p><strong>Version:</strong> ${VERSION}</p>
    <p><strong>hello():</strong> ${hello()}</p>
  `;
}

// Log to console for debugging
console.log("Content Provider Helper loaded");
console.log("Version:", VERSION);
console.log("hello():", hello());
