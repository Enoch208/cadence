import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "@/components/landing/Landing";
import "@/styles/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("The page has no #root element to render into");
}

createRoot(root).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
