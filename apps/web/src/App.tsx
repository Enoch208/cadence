import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Landing } from "@/components/landing/Landing";

const PlanPage = lazy(() =>
  import("@/pages/PlanPage").then((module) => ({ default: module.PlanPage })),
);
const PreviewPage = lazy(() =>
  import("@/pages/PreviewPage").then((module) => ({ default: module.PreviewPage })),
);
const IntentPage = lazy(() =>
  import("@/pages/IntentPage").then((module) => ({ default: module.IntentPage })),
);
const AuthorPage = lazy(() =>
  import("@/pages/AuthorPage").then((module) => ({ default: module.AuthorPage })),
);
const AccountPage = lazy(() =>
  import("@/pages/AccountPage").then((module) => ({ default: module.AccountPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

export function App() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-lavender" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/p/:publicId" element={<PlanPage />} />
        <Route path="/p/:publicId/preview" element={<PreviewPage />} />
        <Route path="/intents/:intentId" element={<IntentPage />} />
        <Route path="/author" element={<AuthorPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
