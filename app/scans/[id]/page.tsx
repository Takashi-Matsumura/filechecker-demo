import { Suspense } from "react";
import { ScanView } from "@/components/scan-view";

export default function ScanPage({ params }: PageProps<"/scans/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-stone-400">読み込み中…</p>}>
      <ScanView params={params} />
    </Suspense>
  );
}
