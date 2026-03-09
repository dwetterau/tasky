"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CaptureList } from "@/components/CapturesPage";
import { SignIn } from "@/components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

export default function Home() {
  const router = useRouter();
  const { session, isPending } = useAuthSession();
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const updateIsDesktop = () => setIsDesktop(mediaQuery.matches);

    updateIsDesktop();
    mediaQuery.addEventListener("change", updateIsDesktop);

    return () => {
      mediaQuery.removeEventListener("change", updateIsDesktop);
    };
  }, []);

  useEffect(() => {
    if (!session || !isDesktop) return;
    router.replace("/tasks");
  }, [isDesktop, router, session]);

  if (isPending || (session && isDesktop === null) || (session && isDesktop)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return session ? <CaptureList /> : <SignIn />;
}
