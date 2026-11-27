import { LinkButton } from "@/components/ui/Button";
import { Container } from "@/components/ui/Misc";

export default function NotFound() {
  return (
    <Container className="grid min-h-[60vh] place-items-center py-24 text-center">
      <div>
        <p className="font-serif text-[8rem] font-light leading-none text-gold/40">404</p>
        <h1 className="mt-4 font-serif text-4xl font-light">This page has moved on.</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm text-mute">The piece or page you&apos;re looking for isn&apos;t here any more.</p>
        <div className="mt-9"><LinkButton href="/products">Back to the collection</LinkButton></div>
      </div>
    </Container>
  );
}
