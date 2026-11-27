"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function AdminDirectoryRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin");
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center bg-[#F8FAFC]">
      <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
    </div>
  );
}
