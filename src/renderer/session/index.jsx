import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "../shared/ErrorBoundary.jsx";
import "../shared/theme.css";
import "./session.css";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
