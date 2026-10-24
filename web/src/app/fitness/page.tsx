import { Suspense } from "react";

import { PageLoading } from "@/components/PageStub";
import { parseRange } from "@/lib/range";
import { FitnessView } from "@/views/Fitness";

async function Fitness({ searchParams }: Pick<PageProps<"/fitness">, "searchParams">) {
  return <FitnessView range={parseRange((await searchParams).range)} />;
}

export default function FitnessPage({ searchParams }: PageProps<"/fitness">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Fitness searchParams={searchParams} />
    </Suspense>
  );
}
