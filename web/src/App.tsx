import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";
import Landing from "./pages/Landing";
import PhoneApp from "./pages/app/PhoneApp";

// Mission Control carries the graph engine; load it only on the big screen.
const MissionControl = lazy(() => import("./pages/control/MissionControl"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<PhoneApp />} />
      <Route path="/control" element={<Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}><MissionControl /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
