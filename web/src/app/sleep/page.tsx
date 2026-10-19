import { Suspense } from "react";

import { PageLoading, PageStub } from "@/components/PageStub";

export default function SleepPage({ searchParams }: PageProps<"/sleep">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PageStub href="/sleep" searchParams={searchParams} />
    </Suspense>
  );
}
