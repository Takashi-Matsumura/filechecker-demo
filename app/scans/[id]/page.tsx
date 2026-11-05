import { Suspense } from "react";
import { ScanDashboard } from "@/components/scan-dashboard";

export default function ScanPage({ params }: PageProps<"/scans/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-stone-400">読み込み中…</p>}>
      <ScanDashboard params={params} />
    </Suspense>
  );
}
