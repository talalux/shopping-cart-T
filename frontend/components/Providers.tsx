"use client";
import { AuthProvider, type User } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { ToastProvider } from "@/components/Toast";

export function Providers({ initialUser, children }: { initialUser: User; children: React.ReactNode }) {
  return (
    <AuthProvider initialUser={initialUser}>
      <ToastProvider>
        <CartProvider>{children}</CartProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
