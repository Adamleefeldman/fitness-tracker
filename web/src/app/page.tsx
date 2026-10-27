import { Suspense } from "react";

import { PageLoading } from "@/components/widgets";
import { parseRange } from "@/lib/range";
import { TodayView } from "@/views/Today";

async function Today({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  return <TodayView range={parseRange((await searchParams).range)} />;
}

export default function TodayPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}
