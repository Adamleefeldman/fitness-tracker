import { Suspense } from "react";

import { PageLoading, PageStub } from "@/components/PageStub";

export default function LoadPage({ searchParams }: PageProps<"/load">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PageStub href="/load" searchParams={searchParams} />
    </Suspense>
  );
}
