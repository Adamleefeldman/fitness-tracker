import { Suspense } from "react";

import { PageLoading } from "@/components/PageStub";
import { parseRange } from "@/lib/range";
import { LoadView } from "@/views/Load";

async function Load({ searchParams }: Pick<PageProps<"/load">, "searchParams">) {
  return <LoadView range={parseRange((await searchParams).range)} />;
}

export default function LoadPage({ searchParams }: PageProps<"/load">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Load searchParams={searchParams} />
    </Suspense>
  );
}
