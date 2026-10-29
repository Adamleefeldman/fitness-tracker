import { Suspense } from "react";

import { PageLoading } from "@/components/widgets";
import { PlanView } from "@/views/Plan";

export default function PlanPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PlanView />
    </Suspense>
  );
}
