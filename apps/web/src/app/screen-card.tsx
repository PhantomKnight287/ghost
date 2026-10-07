import Image from "next/image";

export function ScreenCard({
  src,
  alt,
  anchor,
  title,
  body,
}: {
  src: string;
  alt: string;
  /** Which edge of the screenshot stays in view; the other edge bleeds off the card. */
  anchor: "left" | "right";
  title: string;
  body: string;
}) {
  return (
    <figure className="group flex min-w-0 flex-1 flex-col gap-4.5">
      <div className="relative h-[420px] overflow-hidden rounded-2xl border bg-accent">
        <Image
          src={src}
          alt={alt}
          width={2296}
          height={1640}
          sizes="800px"
          className={`absolute top-10 w-[800px] max-w-none border shadow-[0_20px_40px_-20px_oklch(0_0_0/0.28)] transition-transform duration-200 ease-out group-hover:-translate-y-2 ${
            anchor === "right"
              ? "right-10 rounded-tr-xl border-l-0"
              : "left-10 rounded-tl-xl border-r-0"
          }`}
        />
      </div>
      <figcaption className="flex flex-col gap-1">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-[15px] text-muted-foreground">{body}</span>
      </figcaption>
    </figure>
  );
}
