import Form from "next/form";
import { Search } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

export function SearchForm({
  action,
  placeholder,
  query = "",
  type = null,
  autoFocus,
  className,
}: {
  action: string;
  placeholder: string;
  query?: string;
  type?: string | null;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <Form action={action} className={className}>
      {type && <input type="hidden" name="type" value={type} />}
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          key={query}
          type="search"
          name="q"
          required
          defaultValue={query}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
        />
      </InputGroup>
    </Form>
  );
}
