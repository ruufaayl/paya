import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./ds/ui";
import Landing from "./pages/Landing";
import WalletApp from "./wallet/WalletApp";

// Mission Control carries the graph engine and charts; load it only on the operations screen.
const Console = lazy(() => import("./console/Console"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<WalletApp />} />
      <Route path="/control/*" element={<Suspense fallback={<div className="grid h-full place-items-center bg-canvas"><Spinner /></div>}><Console /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
