import { Suspense } from "react";
import CallbackContent from "./CallbackContent";

export default function AuthCallbackPage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center"
      style={{ background: "#0e0e0e" }}
    >
      <Suspense fallback={<Spinner />}>
        <CallbackContent />
      </Suspense>
    </main>
  );
}

function Spinner() {
  return (
    <div className="text-center space-y-4">
      <div
        className="w-8 h-8 border-2 rounded-full animate-spin mx-auto"
        style={{ borderColor: "#444748", borderTopColor: "#ffffff" }}
      />
      <p className="text-sm" style={{ color: "#c4c7c8" }}>
        Completing sign in…
      </p>
    </div>
  );
}
