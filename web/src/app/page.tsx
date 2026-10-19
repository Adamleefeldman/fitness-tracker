import { Suspense } from "react";

import { PageLoading, PageStub } from "@/components/PageStub";

export default function TodayPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PageStub href="/" searchParams={searchParams} />
    </Suspense>
  );
}
