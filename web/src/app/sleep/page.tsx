import { Suspense } from "react";

import { PageLoading } from "@/components/widgets";
import { parseRange } from "@/lib/range";
import { SleepView } from "@/views/Sleep";

async function Sleep({ searchParams }: Pick<PageProps<"/sleep">, "searchParams">) {
  return <SleepView range={parseRange((await searchParams).range)} />;
}

export default function SleepPage({ searchParams }: PageProps<"/sleep">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Sleep searchParams={searchParams} />
    </Suspense>
  );
}
