import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** An account's avatar image, falling back to the first two letters of its name. */
export function ProfileAvatar({
  name,
  image,
  className,
  fallbackClassName,
}: {
  name: string;
  image?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className={fallbackClassName}>
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
