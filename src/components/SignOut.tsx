"use client";

export function SignOut() {
  return (
    <button
      className="hover:text-brand"
      onClick={async () => {
        await fetch("/api/logout", { method: "POST" }).catch(() => null);
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
