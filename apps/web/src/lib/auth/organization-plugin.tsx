import { createAuthPlugin } from "@better-auth-ui/core";
import {
  organizationPlugin as coreOrganizationPlugin,
  type OrganizationLocalization,
  type OrganizationPluginOptions,
} from "@better-auth-ui/core/plugins/organization";

import { AcceptInvitation } from "@/components/auth/organization/accept-invitation";

export const organizationPlugin = createAuthPlugin(
  coreOrganizationPlugin.id,
  (options: OrganizationPluginOptions = {}) => {
    const core = coreOrganizationPlugin(options);

    return {
      ...core,
      localization: core.localization as OrganizationLocalization,
      views: {
        auth: { acceptInvitation: AcceptInvitation },
      },
    };
  },
);
