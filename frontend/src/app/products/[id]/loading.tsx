import { Container, Skeleton } from "@/components/ui/Misc";

export default function Loading() {
  return (
    <Container className="py-12">
      <Skeleton className="mb-8 h-3 w-56" />
      <div className="grid gap-16 lg:grid-cols-[1.15fr_1fr]">
        <Skeleton className="aspect-[4/5]" />
        <div className="space-y-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="mt-10 h-32 w-full" />
        </div>
      </div>
    </Container>
  );
}
