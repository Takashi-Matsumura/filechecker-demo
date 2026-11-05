import { Suspense } from "react";
import { FileDetail } from "@/components/file-detail";

export default function FilePage({ params }: PageProps<"/scans/[id]/files/[fileId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-stone-400">読み込み中…</p>}>
      <FileDetail params={params} />
    </Suspense>
  );
}
