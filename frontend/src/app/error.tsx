"use client";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Misc";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Container className="grid min-h-[60vh] place-items-center py-24 text-center">
      <div>
        <h1 className="font-serif text-4xl font-light">Something went wrong.</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm text-mute">An unexpected error interrupted this page. Nothing was lost — please try again.</p>
        <div className="mt-9"><Button onClick={reset}>Try again</Button></div>
      </div>
    </Container>
  );
}
