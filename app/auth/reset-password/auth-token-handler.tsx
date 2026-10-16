"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function AuthTokenHandler({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function handle() {
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      const supabase = createClient();

      if (tokenHash && type === "recovery") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (!cancelled) {
          if (error) {
            const msg = encodeURIComponent(
              error.message ||
                "El enlace de recuperación expiró o no es válido. Solicita uno nuevo."
            );
            router.replace(`/auth/forgot-password?error=${msg}`);
          } else {
            setReady(true);
            router.replace("/auth/reset-password");
          }
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) {
        if (session) {
          setReady(true);
        } else {
          const msg = encodeURIComponent(
            "El enlace de recuperación expiró o no es válido. Solicita uno nuevo."
          );
          router.replace(`/auth/forgot-password?error=${msg}`);
        }
      }
    }

    handle();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  if (!ready) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
