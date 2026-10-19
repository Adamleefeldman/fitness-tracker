import { Suspense } from "react";

import { PageLoading, PageStub } from "@/components/PageStub";

export default function FitnessPage({ searchParams }: PageProps<"/fitness">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PageStub href="/fitness" searchParams={searchParams} />
    </Suspense>
  );
}
