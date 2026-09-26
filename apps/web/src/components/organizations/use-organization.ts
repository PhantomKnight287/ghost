"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

/** The organization behind `slug`, with members, invitations and teams, plus a way to change it that refreshes every organization query afterwards. */
export function useOrganization(slug: string) {
  const queryClient = useQueryClient();
  // Under "auth" with Better Auth UI's own queries, so one invalidation refreshes both.
  const query = useQuery({
    queryKey: ["auth", "organization", slug],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization(
        { query: { organizationSlug: slug } },
      );
      if (error) throw new Error(error.message ?? "Organization not found");
      return data;
    },
  });

  const change = useMutation({
    mutationFn: async ({
      run,
    }: {
      run: () => Promise<{ error?: { message?: string } | null }>;
      done: string;
    }) => {
      const { error } = await run();
      if (error) throw new Error(error.message ?? "Something went wrong");
    },
    onSuccess: async (_, { done }) => {
      toast.success(done);
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    organization: query.data ?? null,
    isPending: query.isPending,
    busy: change.isPending,
    /** Runs one Better Auth organization call, toasts how it went, and resolves to whether it worked. */
    change: (
      run: () => Promise<{ error?: { message?: string } | null }>,
      done: string,
    ) =>
      change.mutateAsync({ run, done }).then(
        () => true,
        () => false,
      ),
  };
}
